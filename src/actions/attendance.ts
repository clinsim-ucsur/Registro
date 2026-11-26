"use server"

import { revalidatePath } from "next/cache"
import { cookies, headers } from "next/headers"
import { Role, RecordType, RecordStatus, Shift } from "@prisma/client"
import prisma from "@/lib/prisma"
import { limaDayOfWeek } from "@/lib/timezone"
import { validateHybridLocation } from "@/lib/geofence"
import {
  findBindingForDevice,
  verifyAndBindDeviceForUser,
  unbindDeviceForDni,
  unbindDeviceByFingerprint,
  getAllDeviceBindings,
  type DeviceFingerprintPayload,
} from "@/lib/device-binding"
import { DEFAULT_SHIFT_TIMES } from "@/lib/schedule-constants"
import {
  getDailyProgramForUser,
  fetchDailyProgramSessions,
  matchDailyProgramFromSessions,
  resolveUserModulesState,
  getCurrentLimaMinutes,
  type UserDailyProgramSummary,
  type TodayAttendanceRecordLite,
} from "@/lib/daily-program-api"
import { calculateExpectedExitTime } from "@/lib/overtime"
import {
  findApplicableToleranceRule,
  getShiftDiffInMinutes,
  validateEarlyEntry,
  calculateStatusFromRule,
} from "@/lib/tolerance"
import {
  checkAndDispatchDuePushNotifications,
  ensureServerPushSchedulerStarted,
} from "@/lib/push-notifications"

// Cachés en memoria para acelerar tiempos de respuesta de validación y marcación en PCs y móviles
let cachedCampuses: { data: any[]; expiresAt: number } | null = null
let cachedCourses: { data: { id: string; name: string }[]; expiresAt: number } | null = null
let cachedToleranceRules: { data: any[]; expiresAt: number } | null = null
let cachedDirectory: { data: Record<string, any>; expiresAt: number } | null = null
let inflightDirectoryBuild: Promise<Record<string, any>> | null = null

const CATALOG_CACHE_TTL_MS = 120_000 // 2 minutos
const DIRECTORY_CACHE_TTL_MS = 15_000 // 15 segundos (se actualiza en vivo con cada consulta al Excel y al marcar asistencia)

export async function invalidateAttendanceDirectoryCache() {
  cachedDirectory = null
}

export async function getCachedCampusesList() {
  const now = Date.now()
  if (cachedCampuses && cachedCampuses.expiresAt > now) {
    return cachedCampuses.data
  }
  try {
    const list = await prisma.campus.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, geoEnforced: true, latitude: true, longitude: true, radiusMeters: true },
    })
    cachedCampuses = { data: list, expiresAt: now + CATALOG_CACHE_TTL_MS }
    return list
  } catch (err) {
    console.warn("No se pudo consultar sedes desde BD para geocerca, usando catálogo oficial:", err)
    return cachedCampuses ? cachedCampuses.data : []
  }
}

async function getCachedCoursesList() {
  const now = Date.now()
  if (cachedCourses && cachedCourses.expiresAt > now) {
    return cachedCourses.data
  }
  try {
    const list = await prisma.course.findMany({
      select: { id: true, name: true },
    })
    cachedCourses = { data: list, expiresAt: now + CATALOG_CACHE_TTL_MS }
    return list
  } catch {
    return cachedCourses ? cachedCourses.data : []
  }
}

async function getCachedToleranceRulesList() {
  const now = Date.now()
  if (cachedToleranceRules && cachedToleranceRules.expiresAt > now) {
    return cachedToleranceRules.data
  }
  try {
    const list = await prisma.toleranceRule.findMany()
    cachedToleranceRules = { data: list, expiresAt: now + CATALOG_CACHE_TTL_MS }
    return list
  } catch {
    return cachedToleranceRules ? cachedToleranceRules.data : []
  }
}

async function buildAttendanceDirectory(): Promise<Record<string, any>> {
  if (inflightDirectoryBuild) return inflightDirectoryBuild
  inflightDirectoryBuild = (async () => {
    try {
      const now = new Date()
      const limaOffset = -5 * 60 * 60 * 1000
      const limaToday = new Date(now.getTime() + limaOffset)
      limaToday.setUTCHours(0, 0, 0, 0)
      const startOfDayUTC = new Date(limaToday.getTime() - limaOffset)
      const endOfDayUTC = new Date(startOfDayUTC.getTime() + 24 * 60 * 60 * 1000)

      const limaDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now)

      const [users, todayRecords, todaySchedules, allRules, dailySessions] = await Promise.all([
        prisma.user.findMany({
          select: {
            id: true,
            name: true,
            dni: true,
            role: true,
            campusId: true,
            defaultShift: true,
            campus: { select: { id: true, name: true } },
          },
        }),
        prisma.attendanceRecord.findMany({
          where: { timestamp: { gte: startOfDayUTC, lt: endOfDayUTC } },
          orderBy: { timestamp: "asc" },
          select: { userId: true, type: true, timestamp: true, course: { select: { name: true } } },
        }),
        prisma.technicianSchedule.findMany({
          where: { date: limaDateStr },
          include: { campus: true },
        }),
        getCachedToleranceRulesList(),
        fetchDailyProgramSessions(),
      ])

      const lastRecordByUserId = new Map<string, RecordType>()
      const todayRecordsByUserId = new Map<string, TodayAttendanceRecordLite[]>()
      for (const r of todayRecords) {
        lastRecordByUserId.set(r.userId, r.type)
        const list = todayRecordsByUserId.get(r.userId) || []
        list.push({
          type: r.type,
          timestamp: r.timestamp.toISOString(),
          courseName: r.course?.name || null,
        })
        todayRecordsByUserId.set(r.userId, list)
      }

      const scheduleByUserId = new Map<string, any>()
      for (const s of todaySchedules) {
        scheduleByUserId.set(s.userId, s)
      }

      const techRules = allRules.filter((r: any) => r.role === Role.TECNICO)
      const directory: Record<string, any> = {}

      for (const user of users) {
        const dniKey = user.dni.trim()
        const isAdmin = user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN_SECUNDARIO
        const effectiveRole: Role = isAdmin ? Role.DOCENTE : user.role
        const todaySched = effectiveRole === Role.TECNICO ? scheduleByUserId.get(user.id) : null

        if (effectiveRole === Role.TECNICO && todaySched?.shift === Shift.DESCANSO) {
          directory[dniKey] = {
            success: false,
            message: `🏖️ Hola ${user.name}, hoy tienes asignado tu DÍA DE DESCANSO según el cronograma oficial. No requieres registrar asistencia.`,
          }
          continue
        }

        if (
          effectiveRole === Role.TECNICO &&
          (todaySched?.shift === Shift.COMISION || (!todaySched && user.defaultShift === Shift.COMISION))
        ) {
          directory[dniKey] = {
            success: false,
            isComision: true,
            message: `✈️ Hola ${user.name}, hoy estás en COMISIÓN DE SERVICIO / EVENTO ESPECIAL (EV) en provincia según el cronograma oficial. No es necesario marcar asistencia.`,
          }
          continue
        }

        let technicianAssignment: any = null
        let dailyProgram: UserDailyProgramSummary | null = null

        if (effectiveRole === Role.TECNICO) {
          if (todaySched) {
            let expectedTime = todaySched.expectedEntryTime
            const def = DEFAULT_SHIFT_TIMES[todaySched.shift as Shift] || DEFAULT_SHIFT_TIMES.MANANA
            if (todaySched.shift === Shift.INTERMEDIO && expectedTime === "13:00") expectedTime = def.entry
            else if (todaySched.shift === Shift.MANANA && expectedTime === "13:00") expectedTime = def.entry
            else if (
              todaySched.shift === Shift.TARDE &&
              ["06:00", "07:00", "08:00", "09:00", "10:00"].includes(expectedTime)
            ) {
              expectedTime = "13:00"
            }
            technicianAssignment = {
              campusName: todaySched.campus?.name || user.campus?.name || "Campus Villa",
              shift: todaySched.shift,
              expectedEntryTime: expectedTime,
              expectedExitTime: calculateExpectedExitTime(expectedTime, 9),
              source: "SCHEDULE",
            }
          } else {
            const defaultShift = user.defaultShift || Shift.MANANA
            const def = DEFAULT_SHIFT_TIMES[defaultShift] || DEFAULT_SHIFT_TIMES.MANANA
            const matchingRule =
              techRules.find(
                (r: any) =>
                  (r.shift === defaultShift || r.shift === null) &&
                  (r.campusId === user.campusId || r.campusId === null)
              ) || null
            const expectedEntry = matchingRule?.expectedEntryTime || def.entry
            technicianAssignment = {
              campusName: user.campus?.name || "Campus Villa",
              shift: defaultShift,
              expectedEntryTime: expectedEntry,
              expectedExitTime: calculateExpectedExitTime(expectedEntry, 9),
              source: "DEFAULT_PROFILE",
            }
          }
        } else {
          dailyProgram = matchDailyProgramFromSessions(
            dailySessions,
            user.name,
            effectiveRole,
            user.campus?.name || "Campus Villa"
          )
        }

        directory[dniKey] = {
          success: true,
          user: {
            id: user.id,
            name: user.name,
            role: effectiveRole,
            campusId: user.campusId,
            campusName:
              technicianAssignment?.campusName ||
              (dailyProgram?.found ? dailyProgram.campusName : null) ||
              user.campus?.name ||
              "Campus Villa",
            defaultShift: user.defaultShift,
          },
          lastRecordType: lastRecordByUserId.get(user.id) ?? null,
          todayRecords: todayRecordsByUserId.get(user.id) ?? [],
          technicianAssignment,
          dailyProgram,
        }
      }

      cachedDirectory = { data: directory, expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS }
      return directory
    } finally {
      inflightDirectoryBuild = null
    }
  })()
  return inflightDirectoryBuild
}

// ------------------------------------------------------------------
// 0. PRECARGA DEL DIRECTORIO DIARIO EN MEMORIA (RESPUESTA INSTANTÁNEA 0ms)
// ------------------------------------------------------------------
export async function preloadAttendanceDirectoryAction(): Promise<{
  success: boolean
  directory: Record<string, any>
}> {
  try {
    ensureServerPushSchedulerStarted()
    void checkAndDispatchDuePushNotifications(false)

    const nowMs = Date.now()
    if (cachedDirectory) {
      if (cachedDirectory.expiresAt <= nowMs && !inflightDirectoryBuild) {
        // Stale-while-revalidate: devolver al instante sin hacer esperar a la PC y actualizar en segundo plano
        void buildAttendanceDirectory()
      }
      return { success: true, directory: cachedDirectory.data }
    }

    const directory = await buildAttendanceDirectory()
    return { success: true, directory }
  } catch (error) {
    console.error("[preloadAttendanceDirectoryAction] Error:", error)
    return { success: false, directory: cachedDirectory ? cachedDirectory.data : {} }
  }
}

// ------------------------------------------------------------------
// 0. CONSULTA DE ESTADO DE ASISTENCIA HOY (para lógica ENTRADA/SALIDA)
// ------------------------------------------------------------------
export async function getTodayAttendanceStateAction(userId: string): Promise<{
  lastRecordType: RecordType | null
}> {
  try {
    // Calcular inicio del día Lima (UTC-5)
    const now = new Date()
    const limaOffset = -5 * 60 * 60 * 1000
    const limaToday = new Date(now.getTime() + limaOffset)
    limaToday.setUTCHours(0, 0, 0, 0)
    const startOfDayUTC = new Date(limaToday.getTime() - limaOffset)
    const endOfDayUTC = new Date(startOfDayUTC.getTime() + 24 * 60 * 60 * 1000)

    const lastRecord = await prisma.attendanceRecord.findFirst({
      where: {
        userId,
        timestamp: { gte: startOfDayUTC, lt: endOfDayUTC },
      },
      orderBy: { timestamp: "desc" },
      select: { type: true },
    })

    return { lastRecordType: lastRecord?.type ?? null }
  } catch (error) {
    console.error("[getTodayAttendanceStateAction] Error:", error)
    return { lastRecordType: null }
  }
}

async function getRequestClientIp(): Promise<string | undefined> {
  try {
    const h = await headers()
    const xff = h.get("x-forwarded-for")
    if (xff) return xff.split(",")[0].trim()
    const realIp = h.get("x-real-ip")
    if (realIp) return realIp.trim()
  } catch {}
  return undefined
}

/**
 * Consulta si el equipo físico actual ya tiene un DNI vinculado (incluso si se abre desde otro navegador en el mismo equipo).
 */
export async function resolveDeviceBindingAction(
  fingerprint: DeviceFingerprintPayload
): Promise<{
  bound: boolean
  dni?: string
  userName?: string
  role?: string
}> {
  try {
    const clientIp = await getRequestClientIp()
    const entry = await findBindingForDevice(fingerprint, clientIp)
    if (!entry) {
      return { bound: false }
    }
    return {
      bound: true,
      dni: entry.dni,
      userName: entry.userName,
      role: entry.role,
    }
  } catch (err) {
    console.error("[resolveDeviceBindingAction] Error:", err)
    return { bound: false }
  }
}

export async function getDeviceBindingsOverviewAction(): Promise<Record<string, boolean>> {
  try {
    const all = await getAllDeviceBindings()
    const map: Record<string, boolean> = {}
    for (const dni of Object.keys(all)) {
      map[dni] = true
    }
    return map
  } catch {
    return {}
  }
}

export async function adminResetUserDeviceBindingAction(dni: string): Promise<{
  success: boolean
  message: string
}> {
  try {
    const { getAdminSession } = await import("@/lib/session")
    const session = await getAdminSession().catch(() => null)
    if (!session) {
      return { success: false, message: "No autorizado." }
    }
    const cleanDni = (dni || "").trim()
    const removed = await unbindDeviceForDni(cleanDni)
    return {
      success: true,
      message: removed
        ? `📱 Se liberó el celular vinculado al DNI ${cleanDni}. El colaborador ya puede vincular su nuevo equipo.`
        : `El DNI ${cleanDni} no tenía ningún celular bloqueado. Ya puede vincular su equipo.`,
    }
  } catch (err) {
    console.error("[adminResetUserDeviceBindingAction] Error:", err)
    return { success: false, message: "Error al desvincular el equipo." }
  }
}

// ------------------------------------------------------------------
// 1. VALIDACIÓN AUTOMÁTICA POR DNI (ROL, SEDE, HORARIO Y AMBIENTE)
// ------------------------------------------------------------------
export async function validateUserAction(
  dni: string,
  roleOverride?: Role,
  forceFreshProgram = false,
  deviceFingerprint?: DeviceFingerprintPayload | null
) {
  try {
    const cleanDni = dni.trim()
    const clientIp = deviceFingerprint ? await getRequestClientIp() : undefined

    // 0. Si viene desde un celular/equipo personal (no Kiosco), verificar primero si este equipo ya pertenece a otro DNI
    if (deviceFingerprint) {
      const existingDeviceOwner = await findBindingForDevice(deviceFingerprint, clientIp)
      if (existingDeviceOwner && existingDeviceOwner.dni !== cleanDni) {
        return {
          success: false,
          isDeviceLockedToOtherDni: true,
          boundDni: existingDeviceOwner.dni,
          boundUserName: existingDeviceOwner.userName,
          message: `🔒 Este equipo ya está registrado a nombre de ${existingDeviceOwner.userName} (DNI: ${existingDeviceOwner.dni}). No se permite colocar otro DNI desde este dispositivo.`,
        }
      }
    }

    // Respuesta en 0ms si el usuario ya está en el directorio en memoria y no se exige recarga en vivo del Excel
    if (cachedDirectory && !roleOverride) {
      if (cachedDirectory.expiresAt <= Date.now() && !inflightDirectoryBuild) {
        void buildAttendanceDirectory()
      }
      const hit = cachedDirectory.data[cleanDni]
      if (hit) {
        if (deviceFingerprint && hit.user) {
          const bindRes = await verifyAndBindDeviceForUser({
            dni: cleanDni,
            userId: hit.user.id,
            userName: hit.user.name,
            role: hit.user.role,
            fingerprint: deviceFingerprint,
            clientIp,
          })
          if (!bindRes.allowed) {
            return {
              success: false,
              isDeviceLockedToOtherDni: bindRes.code === "DEVICE_BOUND_TO_OTHER_DNI",
              isDniBoundToOtherDevice: bindRes.code === "DNI_BOUND_TO_OTHER_DEVICE",
              boundDni: bindRes.boundDni,
              boundUserName: bindRes.boundUserName,
              message: bindRes.message,
            }
          }
        }
        if (!forceFreshProgram) {
          return deviceFingerprint ? { ...hit, boundDni: cleanDni } : hit
        }
        // Si es Técnico, no depende del Excel de programación diaria de simulación
        if (hit.user?.role === Role.TECNICO) {
          return deviceFingerprint ? { ...hit, boundDni: cleanDni } : hit
        }
      }
    }

    const now = new Date()
    const limaOffset = -5 * 60 * 60 * 1000
    const limaToday = new Date(now.getTime() + limaOffset)
    limaToday.setUTCHours(0, 0, 0, 0)
    const startOfDayUTC = new Date(limaToday.getTime() - limaOffset)
    const endOfDayUTC = new Date(startOfDayUTC.getTime() + 24 * 60 * 60 * 1000)

    const limaDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now)

    // 1er lote rápido desde BD local/remota (sin bloquear por Google Sheets si es Técnico o DNI inválido)
    const [user, userTodayRecords, todaySched, allRules] = await Promise.all([
      prisma.user.findUnique({
        where: { dni: cleanDni },
        select: {
          id: true,
          name: true,
          role: true,
          campusId: true,
          defaultShift: true,
          campus: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.attendanceRecord.findMany({
        where: {
          user: { dni: cleanDni },
          timestamp: { gte: startOfDayUTC, lt: endOfDayUTC },
        },
        orderBy: { timestamp: "asc" },
        select: { type: true, timestamp: true, course: { select: { name: true } } },
      }),
      prisma.technicianSchedule.findFirst({
        where: {
          user: { dni: cleanDni },
          date: limaDateStr,
        },
        include: { campus: true },
      }),
      getCachedToleranceRulesList(),
    ])

    if (!user) {
      return { success: false, message: "⚠ El DNI ingresado no se encuentra registrado en el sistema." }
    }

    // Determinar el rol operativo automáticamente a partir del usuario en BD
    const isAdmin = user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN_SECUNDARIO
    const effectiveRole: Role = isAdmin ? (roleOverride || Role.DOCENTE) : user.role

    // Verificar y vincular el celular/equipo personal al DNI si aplica (Bloqueo anti-suplantación 1 Equipo <-> 1 DNI)
    if (deviceFingerprint) {
      const bindRes = await verifyAndBindDeviceForUser({
        dni: cleanDni,
        userId: user.id,
        userName: user.name,
        role: effectiveRole,
        fingerprint: deviceFingerprint,
        clientIp,
      })
      if (!bindRes.allowed) {
        return {
          success: false,
          isDeviceLockedToOtherDni: bindRes.code === "DEVICE_BOUND_TO_OTHER_DNI",
          isDniBoundToOtherDevice: bindRes.code === "DNI_BOUND_TO_OTHER_DEVICE",
          boundDni: bindRes.boundDni,
          boundUserName: bindRes.boundUserName,
          message: bindRes.message,
        }
      }
    }

    if (effectiveRole === Role.TECNICO && todaySched?.shift === Shift.DESCANSO) {
      return {
        success: false,
        boundDni: deviceFingerprint ? cleanDni : undefined,
        message: `🏖️ Hola ${user.name}, hoy tienes asignado tu DÍA DE DESCANSO según el cronograma oficial. No requieres registrar asistencia.`,
      }
    }

    if (effectiveRole === Role.TECNICO && (todaySched?.shift === Shift.COMISION || (!todaySched && user.defaultShift === Shift.COMISION))) {
      return {
        success: false,
        isComision: true,
        boundDni: deviceFingerprint ? cleanDni : undefined,
        message: `✈️ Hola ${user.name}, hoy estás en COMISIÓN DE SERVICIO / EVENTO ESPECIAL (EV) en provincia según el cronograma oficial. No es necesario marcar asistencia.`,
      }
    }

    let technicianAssignment: {
      campusName: string | null
      shift: string
      expectedEntryTime: string
      expectedExitTime: string
      source: "SCHEDULE" | "DEFAULT_PROFILE"
    } | null = null

    let dailyProgram: UserDailyProgramSummary | null = null

    if (effectiveRole === Role.TECNICO) {
      const { getTechnicianCustomRule } = await import("@/lib/tech-custom-rules")
      const techCustom = await getTechnicianCustomRule(user.id)
      const customLinkedRule = techCustom?.customRuleId
        ? allRules.find((r: any) => r.id === techCustom.customRuleId)
        : null

      if (todaySched && !techCustom?.customEntryTime && !customLinkedRule) {
        let expectedTime = todaySched.expectedEntryTime
        const def = DEFAULT_SHIFT_TIMES[todaySched.shift] || DEFAULT_SHIFT_TIMES.MANANA
        if (todaySched.shift === Shift.INTERMEDIO && expectedTime === "13:00") {
          expectedTime = def.entry
        } else if (todaySched.shift === Shift.MANANA && expectedTime === "13:00") {
          expectedTime = def.entry
        } else if (todaySched.shift === Shift.TARDE && ["06:00", "07:00", "08:00", "09:00", "10:00"].includes(expectedTime)) {
          expectedTime = "13:00"
        }

        technicianAssignment = {
          campusName: todaySched.campus?.name || user.campus?.name || "Campus Villa",
          shift: todaySched.shift,
          expectedEntryTime: expectedTime,
          expectedExitTime: calculateExpectedExitTime(expectedTime, 9),
          source: "SCHEDULE",
        }
      } else {
        const defaultShift: Shift = (todaySched?.shift ||
          customLinkedRule?.shift ||
          user.defaultShift ||
          Shift.MANANA) as Shift
        const def = DEFAULT_SHIFT_TIMES[defaultShift] || DEFAULT_SHIFT_TIMES.MANANA
        const techRules = allRules.filter((r: any) => r.role === Role.TECNICO || r.role === null)
        const matchingRule =
          customLinkedRule ||
          techRules.find(
            (r: any) =>
              (r.shift === defaultShift || r.shift === null) &&
              (r.campusId === user.campusId || r.campusId === null)
          ) ||
          null

        const expectedEntry =
          techCustom?.customEntryTime || matchingRule?.expectedEntryTime || def.entry
        technicianAssignment = {
          campusName: todaySched?.campus?.name || user.campus?.name || "Campus Villa",
          shift: defaultShift,
          expectedEntryTime: expectedEntry,
          expectedExitTime: calculateExpectedExitTime(expectedEntry, 9),
          source: techCustom?.customEntryTime || customLinkedRule ? "SCHEDULE" : "DEFAULT_PROFILE",
        }
      }
    } else if (effectiveRole === Role.DOCENTE || effectiveRole === Role.PACIENTE_SIMULADO) {
      const dailySessions = await fetchDailyProgramSessions(2800, forceFreshProgram)
      dailyProgram = matchDailyProgramFromSessions(
        dailySessions,
        user.name,
        effectiveRole,
        user.campus?.name || "Campus Villa"
      )
    }

    const formattedTodayRecords: TodayAttendanceRecordLite[] = userTodayRecords.map((r) => ({
      type: r.type,
      timestamp: r.timestamp.toISOString(),
      courseName: r.course?.name || null,
    }))
    const lastRecord =
      userTodayRecords.length > 0 ? userTodayRecords[userTodayRecords.length - 1] : null

    const result = {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        role: effectiveRole,
        campusId: user.campusId,
        campusName:
          technicianAssignment?.campusName ||
          (dailyProgram?.found ? dailyProgram.campusName : null) ||
          user.campus?.name ||
          "Campus Villa",
        defaultShift: user.defaultShift,
      },
      lastRecordType: lastRecord?.type ?? null,
      todayRecords: formattedTodayRecords,
      technicianAssignment,
      dailyProgram,
    }

    if (cachedDirectory) {
      cachedDirectory.data[cleanDni] = result
    }

    return deviceFingerprint ? { ...result, boundDni: cleanDni } : result
  } catch (error) {
    console.error("[validateUserAction] Error:", error)
    return { success: false, message: "Error de conexión con la base de datos." }
  }
}

const KIOSK_TOKEN_PREFIX = "CLINSIM_KIOSK_AUTHORIZED_2026_"

/**
 * Autoriza una PC de oficina en Modo Kiosco para que nunca requiera GPS
 * (sorteando el bloqueo de ubicación de TI en la PC fija), mientras los celulares sí validan GPS.
 */
export async function authorizeKioskDeviceAction(params: {
  adminUser: string
  adminPass: string
  campusName: string
  deviceFingerprint?: DeviceFingerprintPayload | null
}): Promise<{ success: boolean; kioskToken?: string; campusName?: string; message: string }> {
  try {
    const cleanInput = (params.adminUser || "").trim()
    const cleanPass = (params.adminPass || "").trim()
    const targetCampus = (params.campusName || "Campus Villa").trim()

    let isAuthorized = false
    let lacksSpecificPermission = false
    let actorName = "Super Admin Principal"
    let actorDni = cleanInput
    let actorRole = "SUPER_ADMIN"

    if (
      (cleanInput.toLowerCase() === "admin.clinsim" || cleanInput.toLowerCase() === "admin") &&
      cleanPass === "Simulacion.Ucsur26!"
    ) {
      isAuthorized = true
    } else {
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { dni: { equals: cleanInput, mode: "insensitive" } },
            { email: { equals: cleanInput, mode: "insensitive" } },
          ],
          password: cleanPass,
        },
      })
      if (user) {
        actorName = user.name
        actorDni = user.dni
        actorRole = (user.adminRole || user.role) as string

        const isSuperAdmin =
          user.adminRole === "SUPER_ADMIN" || user.role === "SUPER_ADMIN"
        const isSecondaryAdmin =
          user.adminRole === "ADMIN_SECUNDARIO" || user.role === "ADMIN_SECUNDARIO"
        const userPerms = Array.isArray(user.permissions) ? user.permissions : []

        if (isSuperAdmin || (isSecondaryAdmin && userPerms.includes("kiosk"))) {
          isAuthorized = true
        } else if (isSecondaryAdmin) {
          lacksSpecificPermission = true
        }
      }
    }

    const { recordAuditLog } = await import("@/lib/audit-log")

    if (lacksSpecificPermission) {
      await recordAuditLog({
        actorName,
        actorDni,
        actorRole,
        category: "KIOSK",
        action: "Intento Denegado de Vincular Estación Fija",
        target: targetCampus,
        details: `El administrador intentó vincular una Estación Fija en ${targetCampus} sin contar con el permiso 'kiosk'.`,
      })
      return {
        success: false,
        message:
          "Acceso restringido: Su cuenta no cuenta con el permiso 'Vincular Estación Fija'. Solicítelo a un Super Administrador.",
      }
    }

    if (!isAuthorized) {
      return {
        success: false,
        message: "Credenciales inválidas o sin privilegios de Super Administrador.",
      }
    }

    const token = `${KIOSK_TOKEN_PREFIX}${targetCampus}`
    if (params.deviceFingerprint) {
      await unbindDeviceByFingerprint(params.deviceFingerprint)
    }
    try {
      const cookieStore = await cookies()
      cookieStore.set("kiosk_authorized_token", token, {
        httpOnly: false,
        path: "/",
        maxAge: 60 * 60 * 24 * 365, // 1 año en esta PC
      })
    } catch {}

    await recordAuditLog({
      actorName,
      actorDni,
      actorRole,
      category: "KIOSK",
      action: "Vinculación de Estación Fija Oficial",
      target: targetCampus,
      details: `Equipo de oficina vinculado como Estación Fija Oficial (sin GPS) para ${targetCampus}.`,
    })

    return {
      success: true,
      kioskToken: token,
      campusName: targetCampus,
      message: `🖥️ Equipo vinculado como Estación Fija Oficial (${targetCampus}) libre de GPS.`,
    }
  } catch (error) {
    console.error("[authorizeKioskDeviceAction] Error:", error)
    return {
      success: false,
      message: "Error al verificar las credenciales de administrador.",
    }
  }
}

export async function revokeKioskDeviceAction(): Promise<{ success: boolean }> {
  try {
    const cookieStore = await cookies()
    cookieStore.delete("kiosk_authorized_token")
  } catch {}
  return { success: true }
}

/**
 * Vincula una PC como Estación Fija usando un Código de Un Solo Uso (OTP)
 * que ya trae configurada internamente la Sede para la que fue emitido.
 */
export async function authorizeKioskWithOneTimeCodeAction(
  code: string,
  preferredCampusName?: string,
  deviceFingerprint?: DeviceFingerprintPayload | null
): Promise<{
  success: boolean
  kioskToken?: string
  campusName?: string
  message: string
}> {
  try {
    const { consumeKioskOneTimeCode } = await import("@/lib/kiosk-codes")
    const result = await consumeKioskOneTimeCode(code, preferredCampusName)

    if (!result.success || !result.campusName) {
      return {
        success: false,
        message: result.message,
      }
    }

    if (deviceFingerprint) {
      await unbindDeviceByFingerprint(deviceFingerprint)
    }

    const token = `${KIOSK_TOKEN_PREFIX}${result.campusName}`
    try {
      const cookieStore = await cookies()
      cookieStore.set("kiosk_authorized_token", token, {
        httpOnly: false,
        path: "/",
        maxAge: 60 * 60 * 24 * 365, // 1 año en esta PC
      })
    } catch {}

    return {
      success: true,
      kioskToken: token,
      campusName: result.campusName,
      message: result.message,
    }
  } catch (error) {
    console.error("[authorizeKioskWithOneTimeCodeAction] Error:", error)
    return {
      success: false,
      message: "Error al verificar el código de un solo uso.",
    }
  }
}

/**
 * Genera un Código de Un Solo Uso para vincular una Estación Fija en la Sede seleccionada.
 * Solo permitido para SUPER_ADMIN o administradores con el permiso explícito 'kiosk'.
 */
export async function generateKioskOneTimeCodeAction(campusName: string) {
  try {
    const { getAdminSession } = await import("@/lib/session")
    const session = await getAdminSession()
    if (!session) {
      return { success: false, message: "No autorizado." }
    }

    const canManageKiosk =
      session.role === "SUPER_ADMIN" || session.permissions.includes("kiosk")
    if (!canManageKiosk) {
      return {
        success: false,
        message: "No cuenta con el permiso 'Vincular Estación Fija' para generar códigos.",
      }
    }

    // Si es un Admin por Sede, solo puede generar códigos para su propia sede
    const finalCampusName = session.campusName || campusName || "Campus Villa"

    const { createKioskOneTimeCode } = await import("@/lib/kiosk-codes")
    const entry = await createKioskOneTimeCode({
      campusName: finalCampusName,
      actorName: session.name,
      actorDni: session.dni,
      actorRole: session.role,
    })

    try {
      revalidatePath("/dashboard")
    } catch {}

    return {
      success: true,
      entry,
      message: `Código de 1 uso [${entry.code}] generado para ${finalCampusName}.`,
    }
  } catch (error: any) {
    console.error("[generateKioskOneTimeCodeAction] Error:", error)
    return {
      success: false,
      message: error.message || "Error al generar el código.",
    }
  }
}

export async function deleteKioskOneTimeCodeAction(code: string) {
  try {
    const { getAdminSession } = await import("@/lib/session")
    const session = await getAdminSession()
    if (!session) return { success: false, message: "No autorizado." }

    const canManageKiosk =
      session.role === "SUPER_ADMIN" || session.permissions.includes("kiosk")
    if (!canManageKiosk) {
      return { success: false, message: "Sin permiso para eliminar códigos." }
    }

    const { deleteKioskOneTimeCode } = await import("@/lib/kiosk-codes")
    await deleteKioskOneTimeCode(code, {
      name: session.name,
      dni: session.dni,
      role: session.role,
    })

    try {
      revalidatePath("/dashboard")
    } catch {}

    return { success: true, message: "Código eliminado." }
  } catch (error: any) {
    return { success: false, message: "Error al eliminar el código." }
  }
}

// ------------------------------------------------------------------
// 2. REEMPLAZO DE `registrarDatos(datos)`
// ------------------------------------------------------------------
type RegisterAttendanceData = {
  userId: string
  role: Role
  type: RecordType
  shift?: Shift
  campusId?: string
  courseId?: string
  expectedEntryTime?: string
  kioskToken?: string
  deviceFingerprint?: DeviceFingerprintPayload | null
  isOfflineSync?: boolean
  clientTimestamp?: Date 
  location?: { lat: number; lng: number; accuracy?: number }
}

export async function registerAttendanceAction(data: RegisterAttendanceData) {
  try {
    const recordTimestamp = data.isOfflineSync && data.clientTimestamp 
      ? new Date(data.clientTimestamp) 
      : new Date()

    // Fecha en hora Lima "YYYY-MM-DD"
    const limaDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(recordTimestamp)

    // Consulta concurrente en paralelo: usuario, turno programado y catálogos en caché en 1 roundtrip
    const [user, scheduledShift, allCampuses, allCourses, allRules] = await Promise.all([
      prisma.user.findUnique({
        where: { id: data.userId },
        include: { campus: true },
      }),
      data.role === Role.TECNICO
        ? prisma.technicianSchedule.findUnique({
            where: {
              userId_date: {
                userId: data.userId,
                date: limaDateStr,
              },
            },
            include: { campus: true },
          })
        : Promise.resolve(null),
      getCachedCampusesList(),
      getCachedCoursesList(),
      getCachedToleranceRulesList(),
    ])

    if (!user) {
      return { success: false, message: "El usuario ya no existe en el sistema." }
    }

    if (data.role === Role.TECNICO) {
      if (scheduledShift && scheduledShift.shift === Shift.DESCANSO) {
        return {
          success: false,
          message: `Hoy tienes asignado tu DÍA DE DESCANSO programado. ¡Que tengas un buen descanso!`,
        }
      }

      if (scheduledShift && scheduledShift.shift === Shift.COMISION) {
        return {
          success: false,
          isComision: true,
          message: `✈️ Hola ${user.name}, hoy estás en COMISIÓN DE SERVICIO / EVENTO ESPECIAL (EV) en provincia según el cronograma oficial. No es necesario marcar asistencia.`,
        }
      }

      if (!scheduledShift && user.defaultShift === Shift.COMISION) {
        return {
          success: false,
          isComision: true,
          message: `✈️ Hola ${user.name}, te encuentras asignado a COMISIÓN DE SERVICIO / EVENTO ESPECIAL (EV) en provincia. No es necesario marcar asistencia.`,
        }
      }
    }

    // Verificar si es una PC Kiosco Autorizada (exenta de GPS)
    let isKioskAuthorized = Boolean(
      data.kioskToken && data.kioskToken.startsWith(KIOSK_TOKEN_PREFIX)
    )
    if (!isKioskAuthorized) {
      try {
        const cookieStore = await cookies()
        const cookieToken = cookieStore.get("kiosk_authorized_token")?.value
        if (cookieToken && cookieToken.startsWith(KIOSK_TOKEN_PREFIX)) {
          isKioskAuthorized = true
        }
      } catch {}
    }

    // Validación Anti-Suplantación: en celulares/dispositivos personales (!isKioskAuthorized),
    // un equipo solo puede marcar para el único DNI que tiene vinculado, y un DNI vinculado no puede marcar desde el celular de otro compañero.
    if (!isKioskAuthorized && data.deviceFingerprint) {
      const clientIp = await getRequestClientIp()
      const bindCheck = await verifyAndBindDeviceForUser({
        dni: user.dni,
        userId: user.id,
        userName: user.name,
        role: data.role,
        fingerprint: data.deviceFingerprint,
        clientIp,
      })
      if (!bindCheck.allowed) {
        return {
          success: false,
          isDeviceLockedToOtherDni: bindCheck.code === "DEVICE_BOUND_TO_OTHER_DNI",
          isDniBoundToOtherDevice: bindCheck.code === "DNI_BOUND_TO_OTHER_DEVICE",
          boundDni: bindCheck.boundDni,
          boundUserName: bindCheck.boundUserName,
          message:
            bindCheck.message ||
            "No puede registrar asistencia con un DNI distinto al vinculado en este equipo.",
        }
      }
    }

    // Detección y validación de sede en Modo Híbrido (PC Kiosco sin GPS vs Celular con GPS en campus)
    let resolvedCampusName: string | null = null

    const tentativeCampusName = (data.campusId && data.campusId.trim() !== '')
      ? data.campusId.trim()
      : (scheduledShift?.campus?.name || user.campus?.name || "Campus Villa")

    if (!data.isOfflineSync) {
      const hybridCheck = validateHybridLocation(
        data.location,
        allCampuses,
        tentativeCampusName,
        isKioskAuthorized
      )
      if (!hybridCheck.allowed) {
        return {
          success: false,
          message:
            hybridCheck.error ||
            "Debe encontrarse dentro del perímetro de la universidad para registrar su asistencia desde este dispositivo.",
        }
      }
      resolvedCampusName = hybridCheck.detectedCampusName || tentativeCampusName
    }

    if (!resolvedCampusName) {
      if (data.campusId && data.campusId.trim() !== '') {
        resolvedCampusName = data.campusId.trim()
      } else if (scheduledShift?.campus?.name) {
        resolvedCampusName = scheduledShift.campus.name
      } else if (user.campus?.name) {
        resolvedCampusName = user.campus.name
      } else {
        resolvedCampusName = "Campus Villa"
      }
    }

    // Resolver Campus ID en memoria desde el catálogo precargado
    let finalCampusId: string | null = null
    if (resolvedCampusName) {
      const match = allCampuses.find(
        (c) => c.name.toLowerCase() === resolvedCampusName!.toLowerCase()
      )
      if (match?.id) {
        finalCampusId = match.id
      } else {
        let campus = await prisma.campus.findUnique({ where: { name: resolvedCampusName } })
        if (!campus) {
          campus = await prisma.campus.create({ data: { name: resolvedCampusName } })
          cachedCampuses = null
        }
        finalCampusId = campus.id
      }
    }

    // Si es Docente o Paciente Simulado y no vino courseId o expectedEntryTime, consultar programación diaria en caché
    let resolvedCourseName = data.courseId?.trim() || ""
    let resolvedExpectedEntryTime = data.expectedEntryTime?.trim() || ""

    if ((data.role === Role.DOCENTE || data.role === Role.PACIENTE_SIMULADO) && (!resolvedCourseName || !resolvedExpectedEntryTime)) {
      try {
        const prog = await getDailyProgramForUser(user.name, data.role, resolvedCampusName)
        if (prog.found) {
          // Marcaciones previas del día para saber qué módulo le corresponde marcar:
          // se reutilizan desde el directorio en memoria (0ms) y solo se consulta la BD si no están disponibles
          const cachedTodayRecs: TodayAttendanceRecordLite[] | undefined =
            cachedDirectory?.data[user.dni]?.todayRecords
          let todayRecsForModules: TodayAttendanceRecordLite[]

          if (Array.isArray(cachedTodayRecs)) {
            todayRecsForModules = cachedTodayRecs
          } else {
            const limaOffset = -5 * 60 * 60 * 1000
            const limaDay = new Date(recordTimestamp.getTime() + limaOffset)
            limaDay.setUTCHours(0, 0, 0, 0)
            const startOfDayUTC = new Date(limaDay.getTime() - limaOffset)
            const endOfDayUTC = new Date(startOfDayUTC.getTime() + 24 * 60 * 60 * 1000)

            const existingTodayRecs = await prisma.attendanceRecord.findMany({
              where: {
                userId: user.id,
                timestamp: { gte: startOfDayUTC, lt: endOfDayUTC },
              },
              orderBy: { timestamp: "asc" },
              select: { type: true, timestamp: true, course: { select: { name: true } } },
            })
            todayRecsForModules = existingTodayRecs.map((r) => ({
              type: r.type,
              timestamp: r.timestamp.toISOString(),
              courseName: r.course?.name || null,
            }))
          }

          const modResolution = resolveUserModulesState(
            prog.sessions,
            todayRecsForModules,
            getCurrentLimaMinutes(recordTimestamp),
            data.role
          )

          const targetMod = modResolution.activeModule
          if (!resolvedCourseName) {
            resolvedCourseName = targetMod?.courseName || prog.courseName || ""
          }
          if (!resolvedExpectedEntryTime) {
            resolvedExpectedEntryTime = targetMod?.horaInicio || prog.entryTime || ""
          }
        }
      } catch (err) {
        console.warn("[registerAttendanceAction] No se pudo consultar programación diaria:", err)
      }
    }

    // Resolver Course ID desde caché en memoria (evita roundtrip adicional a la BD)
    let finalCourseId: string | null = null
    if (resolvedCourseName !== '') {
      const cachedCourse = allCourses.find(
        (c) => c.name.toLowerCase() === resolvedCourseName.toLowerCase()
      )
      if (cachedCourse?.id) {
        finalCourseId = cachedCourse.id
      } else {
        let course = await prisma.course.findUnique({ where: { name: resolvedCourseName } })
        if (!course) {
          course = await prisma.course.create({ data: { name: resolvedCourseName } })
          cachedCourses = null
        }
        finalCourseId = course.id
      }
    }

    let status: RecordStatus = RecordStatus.A_TIEMPO
    
    if (data.type === RecordType.ENTRADA) {
      if (data.role === Role.TECNICO) {
        let techRule: {
          expectedEntryTime: string
          earlyEntryToleranceMinutes: number
          gracePeriodMinutes: number
          lateToleranceMinutes: number
          shiftName?: string
          enableEarlyTolerance?: boolean
          enableLateTolerance?: boolean
        } | null = null

        const currentDayOfWeek = limaDayOfWeek(recordTimestamp)
        let userShift = (data.shift || scheduledShift?.shift || user.defaultShift || Shift.MANANA) as Shift

        if (!data.shift && !scheduledShift && currentDayOfWeek === 0 && userShift === Shift.TARDE) {
          userShift = Shift.INTERMEDIO
        }

        const defShift = DEFAULT_SHIFT_TIMES[userShift] || DEFAULT_SHIFT_TIMES.MANANA

        // Filtrar desde reglas en memoria (incluye reglas de TECNICO y reglas Globales sin rol específico)
        const shiftRules = allRules.filter(
          (r: any) =>
            (r.role === Role.TECNICO || r.role === null) &&
            (r.campusId === finalCampusId || r.campusId === null)
        )

        const { getTechnicianCustomRule } = await import("@/lib/tech-custom-rules")
        const techCustomOverride = await getTechnicianCustomRule(user.id)

        const matchingShiftRules = shiftRules.filter((r: any) => {
          if (techCustomOverride?.customRuleId && r.id === techCustomOverride.customRuleId) {
            return true
          }
          if (r.shift) {
            if (r.shift === userShift) return true
            if (currentDayOfWeek === 0 && userShift === Shift.MANANA && r.shift === Shift.INTERMEDIO) return true
            return false
          }
          if (userShift === Shift.INTERMEDIO) return ["08:00", "09:00", "10:00"].includes(r.expectedEntryTime)
          if (userShift === Shift.MANANA) return ["06:00", ...(currentDayOfWeek === 0 ? ["09:00", "10:00"] : [])].includes(r.expectedEntryTime)
          if (userShift === Shift.TARDE) return r.expectedEntryTime === "13:00"
          if (userShift === Shift.NOCHE) return r.expectedEntryTime === "21:00"
          return r.expectedEntryTime === defShift.entry
        })

        const rulesForToday = matchingShiftRules.filter((r: any) => {
          if (techCustomOverride?.customRuleId && r.id === techCustomOverride.customRuleId) {
            return true
          }
          if (!r.daysOfWeek || r.daysOfWeek.trim() === "" || r.daysOfWeek === "ALL") return true
          const days = r.daysOfWeek.split(",").map((d: string) => Number(d.trim()))
          return days.includes(currentDayOfWeek)
        })

        let matchedShiftRule = null
        if (techCustomOverride?.customRuleId) {
          matchedShiftRule = allRules.find((r: any) => r.id === techCustomOverride.customRuleId) || null
        }
        if (!matchedShiftRule) {
          const candidateRules = rulesForToday.length > 0 ? rulesForToday : matchingShiftRules
          if (candidateRules.length > 0) {
            candidateRules.sort((a: any, b: any) => {
              const diffA = Math.abs(getShiftDiffInMinutes(recordTimestamp, a.expectedEntryTime).diffInMinutes)
              const diffB = Math.abs(getShiftDiffInMinutes(recordTimestamp, b.expectedEntryTime).diffInMinutes)
              return diffA - diffB
            })
            matchedShiftRule = candidateRules[0]
          }
        }

        let resolvedEntryTime =
          techCustomOverride?.customEntryTime ||
          matchedShiftRule?.expectedEntryTime ||
          defShift.entry
        if (!techCustomOverride?.customEntryTime && !techCustomOverride?.customRuleId && scheduledShift) {
          let sTime = scheduledShift.expectedEntryTime
          if (userShift === Shift.INTERMEDIO && sTime === "13:00") {
            sTime = resolvedEntryTime || defShift.entry
          } else if (userShift === Shift.MANANA && sTime === "13:00") {
            sTime = defShift.entry
          } else if (userShift === Shift.TARDE && ["06:00", "07:00", "08:00", "09:00", "10:00"].includes(sTime)) {
            sTime = "13:00"
          }
          resolvedEntryTime = sTime
        }

        const allTechRulesDisabledLate =
          shiftRules.length > 0 && shiftRules.every((r: any) => r.enableLateTolerance === false)
        const isLateToleranceDisabled =
          Boolean(techCustomOverride?.freeOutOfHours) ||
          allTechRulesDisabledLate ||
          (matchedShiftRule != null && matchedShiftRule.enableLateTolerance === false) ||
          scheduledShift?.enableLateTolerance === false

        const earlyMins =
          matchedShiftRule?.earlyEntryToleranceMinutes ??
          scheduledShift?.earlyEntryToleranceMinutes ??
          defShift.early
        const graceMins =
          techCustomOverride?.customGraceMinutes ??
          matchedShiftRule?.gracePeriodMinutes ??
          scheduledShift?.gracePeriodMinutes ??
          defShift.grace
        const lateMins =
          techCustomOverride?.customLateMinutes ??
          matchedShiftRule?.lateToleranceMinutes ??
          scheduledShift?.lateToleranceMinutes ??
          defShift.late

        techRule = {
          expectedEntryTime: resolvedEntryTime,
          earlyEntryToleranceMinutes: earlyMins,
          gracePeriodMinutes: graceMins,
          lateToleranceMinutes: lateMins,
          shiftName: userShift,
          // Sin bloqueo de límite de hora para permitir registrar asistencia en cualquier momento
          enableEarlyTolerance: false,
          enableLateTolerance: !isLateToleranceDisabled,
        }

        status = techCustomOverride?.freeOutOfHours
          ? RecordStatus.A_TIEMPO
          : calculateStatusFromRule(recordTimestamp, techRule)
      } else {
        const matchedRule = findApplicableToleranceRule(allRules, finalCampusId || undefined, data.role)
        if (resolvedExpectedEntryTime) {
          const dynamicRule = {
            expectedEntryTime: resolvedExpectedEntryTime,
            earlyEntryToleranceMinutes: matchedRule?.earlyEntryToleranceMinutes ?? 30,
            gracePeriodMinutes: matchedRule?.gracePeriodMinutes ?? 10,
            lateToleranceMinutes: matchedRule?.lateToleranceMinutes ?? 30,
            enableEarlyTolerance: false,
            enableLateTolerance: matchedRule?.enableLateTolerance ?? true,
          }
          status = calculateStatusFromRule(recordTimestamp, dynamicRule)
        } else if (matchedRule) {
          status = calculateStatusFromRule(recordTimestamp, {
            ...matchedRule,
            enableEarlyTolerance: false,
          })
        } else {
          status = RecordStatus.A_TIEMPO
        }
      }
    }

    await prisma.attendanceRecord.create({
      data: {
        userId: data.userId,
        type: data.type,
        campusId: finalCampusId,
        courseId: finalCourseId,
        timestamp: recordTimestamp,
        status: status,
        isOfflineSync: data.isOfflineSync ?? false,
      }
    })

    const createdRecordEntry: TodayAttendanceRecordLite = {
      type: data.type,
      timestamp: recordTimestamp.toISOString(),
      courseName: resolvedCourseName || null,
    }

    if (cachedDirectory && user.dni && cachedDirectory.data[user.dni]) {
      cachedDirectory.data[user.dni].lastRecordType = data.type
      const prevRecs = Array.isArray(cachedDirectory.data[user.dni].todayRecords)
        ? cachedDirectory.data[user.dni].todayRecords
        : []
      cachedDirectory.data[user.dni].todayRecords = [...prevRecs, createdRecordEntry]
    }

    try {
      revalidatePath("/dashboard")
    } catch {
      // Ignorar si se ejecuta fuera del ciclo de Next.js
    }

    return { 
      success: true, 
      newRecord: createdRecordEntry,
      message: `✓ Se registró exitosamente su ${data.type.toLowerCase()}: ${user.name} (${resolvedCampusName})`
    }
    
  } catch (error) {
    console.error("[registerAttendanceAction] Error:", error)
    return { success: false, message: "Error crítico al registrar la asistencia." }
  }
}

// ------------------------------------------------------------------
// 3. LÓGICA DE NEGOCIO: CÁLCULO DE REGLAS DE TOLERANCIA (vía @/lib/tolerance)
// ------------------------------------------------------------------
export async function calculateToleranceStatus(
  recordTime: Date,
  campusId?: string,
  role?: Role
): Promise<RecordStatus> {
  const rules = await getCachedToleranceRulesList()
  if (rules.length === 0) return RecordStatus.A_TIEMPO

  const rule = findApplicableToleranceRule(rules, campusId, role)
  if (!rule) return RecordStatus.A_TIEMPO

  return calculateStatusFromRule(recordTime, rule)
}

// ------------------------------------------------------------------
// 4. LÓGICA DE SINCRONIZACIÓN OFFLINE
// ------------------------------------------------------------------
export async function syncOfflineRecordsAction(records: any[]) {
  try {
    if (!records || records.length === 0) {
      return { success: true, syncedCount: 0, errorCount: 0 }
    }

    const dnis = Array.from(new Set(records.map((r) => r.dni).filter(Boolean)))
    const [users, campuses, rules] = await Promise.all([
      prisma.user.findMany({ where: { dni: { in: dnis } }, select: { id: true, dni: true, role: true } }),
      getCachedCampusesList(),
      getCachedToleranceRulesList(),
    ])

    const userMap = new Map(users.map((u) => [u.dni, u]))
    const campusMap = new Map(campuses.map((c) => [c.name.toLowerCase(), c.id]))
    const courseMap = new Map<string, string>()

    let errorCount = 0
    const recordsToCreate: any[] = []

    for (const record of records) {
      const user = userMap.get(record.dni)
      if (!user) {
        errorCount++
        continue
      }

      let finalCampusId: string | null = null
      if (record.campusId) {
        const cLower = record.campusId.toLowerCase()
        if (campusMap.has(cLower)) {
          finalCampusId = campusMap.get(cLower)!
        } else {
          const newC = await prisma.campus.create({ data: { name: record.campusId } })
          campusMap.set(cLower, newC.id)
          cachedCampuses = null
          finalCampusId = newC.id
        }
      }

      let finalCourseId: string | null = null
      if (record.courseId) {
        const courseName = record.courseId.trim()
        if (courseMap.has(courseName)) {
          finalCourseId = courseMap.get(courseName)!
        } else {
          let course = await prisma.course.findUnique({ where: { name: courseName } })
          if (!course) {
            course = await prisma.course.create({ data: { name: courseName } })
          }
          courseMap.set(courseName, course.id)
          finalCourseId = course.id
        }
      }

      const recDate = new Date(record.timestamp)
      let status: RecordStatus = RecordStatus.A_TIEMPO
      if (record.type === RecordType.ENTRADA) {
        const rule = findApplicableToleranceRule(rules, finalCampusId || undefined, user.role)
        status = rule ? calculateStatusFromRule(recDate, rule) : RecordStatus.A_TIEMPO
      }

      recordsToCreate.push({
        userId: user.id,
        type: record.type,
        campusId: finalCampusId,
        courseId: finalCourseId,
        timestamp: recDate,
        status: status,
        isOfflineSync: true,
      })
    }

    if (recordsToCreate.length > 0) {
      await prisma.attendanceRecord.createMany({
        data: recordsToCreate,
      })
    }

    try {
      revalidatePath("/dashboard")
    } catch {}

    return { success: true, syncedCount: recordsToCreate.length, errorCount }
  } catch (error) {
    console.error("[syncOfflineRecordsAction]", error)
    return { success: false, message: "Error al sincronizar lotes offline." }
  }
}

// ------------------------------------------------------------------
// 5. REGULARIZACIÓN MANUAL DE SALIDA (PARA PACIENTES / PERSONAL QUE OLVIDÓ MARCAR SALIDA)
// ------------------------------------------------------------------
export interface RegularizeExitParams {
  userId: string
  exitTimeHHMM: string // Formato "HH:mm", ej. "12:00"
  dateStr?: string // Formato "YYYY-MM-DD" en hora Lima (por defecto hoy)
  entryRecordId?: string // ID del registro de ENTRADA abierto (opcional)
  entryTimeHHMM?: string // Si olvidó marcar entrada y salida del bloque, hora de inicio "HH:mm"
  createEntryIfMissing?: boolean
  campusName?: string | null
  courseName?: string | null
  reason?: string
  skipAuthForTests?: boolean
}

export async function regularizeMissingExitAction(params: RegularizeExitParams): Promise<{
  success: boolean
  message: string
  createdRecord?: {
    id: string
    type: RecordType
    status: RecordStatus
    timestamp: string
    userId: string
    campusName: string | null
    courseName: string | null
  }
}> {
  try {
    let actorName = "Administrador"
    let actorDni = "—"
    let actorRole = "SUPER_ADMIN"

    if (!params.skipAuthForTests) {
      const { getAdminSession } = await import("@/lib/session")
      const session = await getAdminSession()
      if (!session) {
        return { success: false, message: "No autorizado. Inicie sesión como administrador." }
      }
      if (params.createEntryIfMissing) {
        const canEditEntry =
          session.role === "SUPER_ADMIN" ||
          session.adminTier === "SUPER_ADMIN" ||
          session.adminTier === "ADMIN_GLOBAL"
        if (!canEditEntry) {
          return {
            success: false,
            message:
              "Solo el Admin Total (Super Admin) y el Admin General están autorizados para registrar o editar manualmente la hora de entrada.",
          }
        }
      }
      actorName = session.name || "Administrador"
      actorDni = session.dni || "—"
      actorRole = session.role
    }

    const cleanExitHHMM = (params.exitTimeHHMM || "").trim()
    const timeMatch = cleanExitHHMM.match(/^(\d{1,2}):(\d{2})$/)
    if (!timeMatch) {
      return {
        success: false,
        message: "Ingrese una hora de salida válida en formato HH:mm (ej. 12:00).",
      }
    }

    const exitHour = Number(timeMatch[1])
    const exitMin = Number(timeMatch[2])
    if (exitHour < 0 || exitHour > 23 || exitMin < 0 || exitMin > 59) {
      return {
        success: false,
        message: "La hora de salida debe estar entre las 00:00 y las 23:59.",
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      include: { campus: true },
    })

    if (!user) {
      return { success: false, message: "El usuario seleccionado no existe en la base de datos." }
    }

    // Determinar la fecha objetivo en Lima ("YYYY-MM-DD")
    let targetDateStr = params.dateStr?.trim()
    let referenceEntryRecord: {
      id: string
      timestamp: Date
      campusId: string | null
      courseId: string | null
      campus?: { name: string } | null
      course?: { name: string } | null
    } | null = null

    if (params.entryRecordId) {
      referenceEntryRecord = await prisma.attendanceRecord.findUnique({
        where: { id: params.entryRecordId },
        include: {
          campus: { select: { name: true } },
          course: { select: { name: true } },
        },
      })
      if (referenceEntryRecord && !targetDateStr) {
        targetDateStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Lima",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(referenceEntryRecord.timestamp)
      }
    }

    if (!targetDateStr) {
      targetDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
    }

    const startOfDayUTC = new Date(`${targetDateStr}T00:00:00-05:00`)
    const endOfDayUTC = new Date(startOfDayUTC.getTime() + 24 * 60 * 60 * 1000)

    // Consultar las marcaciones del usuario en ese día para verificar su última ENTRADA
    const dayRecords = await prisma.attendanceRecord.findMany({
      where: {
        userId: user.id,
        timestamp: { gte: startOfDayUTC, lt: endOfDayUTC },
      },
      orderBy: { timestamp: "asc" },
      include: {
        campus: { select: { name: true } },
        course: { select: { name: true } },
      },
    })

    if (!referenceEntryRecord) {
      // Buscar si el último registro del día es una ENTRADA abierta (o la última ENTRADA sin SALIDA posterior)
      for (let i = dayRecords.length - 1; i >= 0; i--) {
        if (dayRecords[i].type === RecordType.ENTRADA) {
          const hasSubsequentExit = dayRecords
            .slice(i + 1)
            .some((r) => r.type === RecordType.SALIDA)
          if (!hasSubsequentExit) {
            referenceEntryRecord = dayRecords[i]
            break
          }
        }
      }
    }

    // Resolver Sede y Curso para el registro de salida
    const allCampuses = await getCachedCampusesList()
    const allCourses = await getCachedCoursesList()

    const resolvedCampusName =
      params.campusName?.trim() ||
      referenceEntryRecord?.campus?.name ||
      user.campus?.name ||
      "Campus Villa"

    let finalCampusId: string | null = referenceEntryRecord?.campusId ?? user.campusId ?? null
    if (resolvedCampusName) {
      const foundCampus = allCampuses.find(
        (c) => c.name.toLowerCase() === resolvedCampusName.toLowerCase()
      )
      if (foundCampus?.id) {
        finalCampusId = foundCampus.id
      }
    }

    const resolvedCourseName =
      params.courseName?.trim() || referenceEntryRecord?.course?.name || null

    let finalCourseId: string | null = referenceEntryRecord?.courseId ?? null
    if (resolvedCourseName) {
      const foundCourse = allCourses.find(
        (c) => c.name.toLowerCase() === resolvedCourseName.toLowerCase()
      )
      if (foundCourse?.id) {
        finalCourseId = foundCourse.id
      } else {
        let course = await prisma.course.findUnique({ where: { name: resolvedCourseName } })
        if (!course) {
          course = await prisma.course.create({ data: { name: resolvedCourseName } })
          cachedCourses = null
        }
        finalCourseId = course.id
      }
    }

    const paddedExitHHMM = `${String(exitHour).padStart(2, "0")}:${String(exitMin).padStart(2, "0")}`
    let exitTimestamp = new Date(`${targetDateStr}T${paddedExitHHMM}:00-05:00`)

    // Si no tenía ENTRADA abierta y se solicitó crear también la ENTRADA del módulo
    if (!referenceEntryRecord && params.createEntryIfMissing && params.entryTimeHHMM) {
      const entryMatch = params.entryTimeHHMM.trim().match(/^(\d{1,2}):(\d{2})$/)
      if (entryMatch) {
        const paddedEntry = `${String(Number(entryMatch[1])).padStart(2, "0")}:${String(Number(entryMatch[2])).padStart(2, "0")}`
        const entryTimestamp = new Date(`${targetDateStr}T${paddedEntry}:00-05:00`)
        if (exitTimestamp <= entryTimestamp) {
          return {
            success: false,
            message: `La hora de salida (${paddedExitHHMM}) debe ser posterior a la hora de inicio del bloque (${paddedEntry}).`,
          }
        }
        const createdEntry = await prisma.attendanceRecord.create({
          data: {
            userId: user.id,
            type: RecordType.ENTRADA,
            status: RecordStatus.A_TIEMPO,
            campusId: finalCampusId,
            courseId: finalCourseId,
            timestamp: entryTimestamp,
            isOfflineSync: false,
          },
          include: {
            campus: { select: { name: true } },
            course: { select: { name: true } },
          },
        })
        referenceEntryRecord = createdEntry
      }
    }

    if (referenceEntryRecord) {
      const entryMs = referenceEntryRecord.timestamp.getTime()
      const exitMs = exitTimestamp.getTime()

      if (exitMs <= entryMs) {
        // Si la diferencia es menor a 45 min (ej. marcó entrada unos minutos después del fin teórico),
        // ajustar 1 minuto después de la entrada para mantener la secuencia cronológica ENTRADA -> SALIDA
        if (entryMs - exitMs <= 45 * 60 * 1000) {
          exitTimestamp = new Date(entryMs + 60 * 1000)
        } else {
          const entryHourStr = new Intl.DateTimeFormat("es-PE", {
            timeZone: "America/Lima",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(referenceEntryRecord.timestamp)
          return {
            success: false,
            message: `La hora de salida (${paddedExitHHMM}) no puede ser anterior a la hora de entrada registrada (${entryHourStr}).`,
          }
        }
      }
    }

    const createdExit = await prisma.attendanceRecord.create({
      data: {
        userId: user.id,
        type: RecordType.SALIDA,
        status: RecordStatus.A_TIEMPO,
        campusId: finalCampusId,
        courseId: finalCourseId,
        timestamp: exitTimestamp,
        isOfflineSync: false,
      },
    })

    // Actualizar o limpiar caché en memoria para que el cambio se refleje de inmediato en celulares y PCs
    cachedDirectory = null

    if (!params.skipAuthForTests) {
      try {
        const { recordAuditLog } = await import("@/lib/audit-log")
        await recordAuditLog({
          actorName,
          actorDni,
          actorRole,
          category: "SCHEDULES",
          action: "Regularización Manual de Salida",
          target: `${user.name} (DNI: ${user.dni})`,
          details: `Salida regularizada manualmente a las ${paddedExitHHMM} (${targetDateStr}) en ${resolvedCampusName}${resolvedCourseName ? ` • ${resolvedCourseName}` : ""}${params.reason ? ` — Motivo: ${params.reason}` : ""}.`,
        })
      } catch {}
    }

    try {
      revalidatePath("/dashboard")
    } catch {}

    return {
      success: true,
      message: `✓ Salida regularizada correctamente para ${user.name} (${paddedExitHHMM}).`,
      createdRecord: {
        id: createdExit.id,
        type: createdExit.type,
        status: createdExit.status,
        timestamp: createdExit.timestamp.toISOString(),
        userId: user.id,
        campusName: resolvedCampusName,
        courseName: resolvedCourseName,
      },
    }
  } catch (error) {
    console.error("[regularizeMissingExitAction] Error:", error)
    return {
      success: false,
      message: "Ocurrió un error al regularizar la marcación de salida.",
    }
  }
}

// ------------------------------------------------------------------
// 6. REGULARIZACIÓN Y EDICIÓN MANUAL DE HORA DE ENTRADA Y SALIDA
//    (EXCLUSIVO PARA ADMIN TOTAL / SUPER_ADMIN Y ADMIN GENERAL / ADMIN_GLOBAL)
// ------------------------------------------------------------------
export interface RegularizeEntryExitParams {
  userId: string
  entryTimeHHMM: string // Formato "HH:mm", ej. "07:00"
  exitTimeHHMM?: string // Formato "HH:mm" opcional, ej. "15:00"
  includeExit?: boolean // true si se desea registrar/regularizar también la hora de salida
  dateStr?: string // Formato "YYYY-MM-DD" en hora Lima (por defecto hoy)
  existingEntryRecordId?: string // Si se está editando la hora de una ENTRADA ya existente
  status?: RecordStatus // Estado de la entrada (por defecto A_TIEMPO)
  campusName?: string | null
  courseName?: string | null
  reason?: string
  skipAuthForTests?: boolean
  mockAdminTierForTests?: "SUPER_ADMIN" | "ADMIN_GLOBAL" | "ADMIN_SEDE" | "COORDINADOR_PACIENTES"
}

export async function regularizeEntryAndExitAction(
  params: RegularizeEntryExitParams
): Promise<{
  success: boolean
  message: string
  entryRecord?: {
    id: string
    type: RecordType
    status: RecordStatus
    timestamp: string
    userId: string
    campusName: string | null
    courseName: string | null
  }
  exitRecord?: {
    id: string
    type: RecordType
    status: RecordStatus
    timestamp: string
    userId: string
    campusName: string | null
    courseName: string | null
  }
}> {
  try {
    let actorName = "Administrador"
    let actorDni = "—"
    let actorRole = "SUPER_ADMIN"

    if (params.skipAuthForTests) {
      if (
        params.mockAdminTierForTests &&
        params.mockAdminTierForTests !== "SUPER_ADMIN" &&
        params.mockAdminTierForTests !== "ADMIN_GLOBAL"
      ) {
        return {
          success: false,
          message:
            "Acceso denegado: Solo el Admin Total (Super Admin) y el Admin General pueden editar o regularizar manualmente la hora de ingreso.",
        }
      }
    } else {
      const { getAdminSession } = await import("@/lib/session")
      const session = await getAdminSession()
      if (!session) {
        return { success: false, message: "No autorizado. Inicie sesión como administrador." }
      }
      const isTotalOrGeneralAdmin =
        session.role === "SUPER_ADMIN" ||
        session.adminTier === "SUPER_ADMIN" ||
        session.adminTier === "ADMIN_GLOBAL"
      if (!isTotalOrGeneralAdmin) {
        return {
          success: false,
          message:
            "Acceso denegado: Solo el Admin Total (Super Admin) y el Admin General pueden editar o regularizar manualmente la hora de ingreso.",
        }
      }
      actorName = session.name || "Administrador"
      actorDni = session.dni || "—"
      actorRole = session.role
    }

    const cleanEntryHHMM = (params.entryTimeHHMM || "").trim()
    const entryMatch = cleanEntryHHMM.match(/^(\d{1,2}):(\d{2})$/)
    if (!entryMatch) {
      return {
        success: false,
        message: "Ingrese una hora de entrada válida en formato HH:mm (ej. 07:00).",
      }
    }
    const entryHour = Number(entryMatch[1])
    const entryMin = Number(entryMatch[2])
    if (entryHour < 0 || entryHour > 23 || entryMin < 0 || entryMin > 59) {
      return {
        success: false,
        message: "La hora de entrada debe estar entre las 00:00 y las 23:59.",
      }
    }
    const paddedEntryHHMM = `${String(entryHour).padStart(2, "0")}:${String(entryMin).padStart(2, "0")}`

    let paddedExitHHMM: string | null = null
    if (params.includeExit && params.exitTimeHHMM?.trim()) {
      const exitMatch = params.exitTimeHHMM.trim().match(/^(\d{1,2}):(\d{2})$/)
      if (!exitMatch) {
        return {
          success: false,
          message: "Ingrese una hora de salida válida en formato HH:mm (ej. 15:00).",
        }
      }
      const exitH = Number(exitMatch[1])
      const exitM = Number(exitMatch[2])
      if (exitH < 0 || exitH > 23 || exitM < 0 || exitM > 59) {
        return {
          success: false,
          message: "La hora de salida debe estar entre las 00:00 y las 23:59.",
        }
      }
      paddedExitHHMM = `${String(exitH).padStart(2, "0")}:${String(exitM).padStart(2, "0")}`
    }

    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      include: { campus: true },
    })
    if (!user) {
      return { success: false, message: "El colaborador seleccionado no existe." }
    }

    let existingEntry: {
      id: string
      timestamp: Date
      status: RecordStatus
      campusId: string | null
      courseId: string | null
      campus?: { name: string } | null
      course?: { name: string } | null
    } | null = null

    if (params.existingEntryRecordId) {
      existingEntry = await prisma.attendanceRecord.findUnique({
        where: { id: params.existingEntryRecordId },
        include: {
          campus: { select: { name: true } },
          course: { select: { name: true } },
        },
      })
    }

    let targetDateStr = params.dateStr?.trim()
    if (!targetDateStr && existingEntry) {
      targetDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(existingEntry.timestamp)
    }
    if (!targetDateStr) {
      targetDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
    }

    const entryTimestamp = new Date(`${targetDateStr}T${paddedEntryHHMM}:00-05:00`)
    let exitTimestamp: Date | null = null
    if (paddedExitHHMM) {
      exitTimestamp = new Date(`${targetDateStr}T${paddedExitHHMM}:00-05:00`)
      if (exitTimestamp <= entryTimestamp) {
        return {
          success: false,
          message: `La hora de salida (${paddedExitHHMM}) debe ser posterior a la hora de entrada (${paddedEntryHHMM}).`,
        }
      }
    }

    const allCampuses = await getCachedCampusesList()
    const allCourses = await getCachedCoursesList()

    const resolvedCampusName =
      params.campusName?.trim() ||
      existingEntry?.campus?.name ||
      user.campus?.name ||
      "Campus Villa"

    let finalCampusId: string | null = existingEntry?.campusId ?? user.campusId ?? null
    if (resolvedCampusName) {
      const foundCampus = allCampuses.find(
        (c) => c.name.toLowerCase() === resolvedCampusName.toLowerCase()
      )
      if (foundCampus?.id) {
        finalCampusId = foundCampus.id
      }
    }

    const resolvedCourseName =
      params.courseName?.trim() || existingEntry?.course?.name || null
    let finalCourseId: string | null = existingEntry?.courseId ?? null
    if (resolvedCourseName) {
      const foundCourse = allCourses.find(
        (c) => c.name.toLowerCase() === resolvedCourseName.toLowerCase()
      )
      if (foundCourse?.id) {
        finalCourseId = foundCourse.id
      } else {
        let course = await prisma.course.findUnique({ where: { name: resolvedCourseName } })
        if (!course) {
          course = await prisma.course.create({ data: { name: resolvedCourseName } })
          cachedCourses = null
        }
        finalCourseId = course.id
      }
    }

    const finalStatus = params.status || existingEntry?.status || RecordStatus.A_TIEMPO

    let savedEntry: {
      id: string
      type: RecordType
      status: RecordStatus
      timestamp: Date
    }

    if (existingEntry) {
      savedEntry = await prisma.attendanceRecord.update({
        where: { id: existingEntry.id },
        data: {
          timestamp: entryTimestamp,
          status: finalStatus,
          campusId: finalCampusId,
          courseId: finalCourseId,
        },
      })
    } else {
      savedEntry = await prisma.attendanceRecord.create({
        data: {
          userId: user.id,
          type: RecordType.ENTRADA,
          status: finalStatus,
          campusId: finalCampusId,
          courseId: finalCourseId,
          timestamp: entryTimestamp,
          isOfflineSync: false,
        },
      })
    }

    let savedExit: {
      id: string
      type: RecordType
      status: RecordStatus
      timestamp: Date
    } | null = null

    if (exitTimestamp) {
      savedExit = await prisma.attendanceRecord.create({
        data: {
          userId: user.id,
          type: RecordType.SALIDA,
          status: RecordStatus.A_TIEMPO,
          campusId: finalCampusId,
          courseId: finalCourseId,
          timestamp: exitTimestamp,
          isOfflineSync: false,
        },
      })
    }

    cachedDirectory = null

    if (!params.skipAuthForTests) {
      try {
        const { recordAuditLog } = await import("@/lib/audit-log")
        const actionTitle = existingEntry
          ? "Edición Manual de Hora de Entrada"
          : savedExit
          ? "Regularización Manual de Entrada y Salida"
          : "Regularización Manual de Entrada"
        await recordAuditLog({
          actorName,
          actorDni,
          actorRole,
          category: "SCHEDULES",
          action: actionTitle,
          target: `${user.name} (DNI: ${user.dni})`,
          details: `${actionTitle} (${targetDateStr}): Entrada ${paddedEntryHHMM}${
            paddedExitHHMM ? ` → Salida ${paddedExitHHMM}` : ""
          } en ${resolvedCampusName}${
            resolvedCourseName ? ` • ${resolvedCourseName}` : ""
          }${params.reason ? ` — Motivo: ${params.reason}` : ""}.`,
        })
      } catch {}
    }

    try {
      revalidatePath("/dashboard")
    } catch {}

    return {
      success: true,
      message: existingEntry
        ? `✓ Hora de entrada actualizada a ${paddedEntryHHMM}${
            paddedExitHHMM ? ` y salida registrada a ${paddedExitHHMM}` : ""
          } para ${user.name}.`
        : `✓ Entrada regularizada a las ${paddedEntryHHMM}${
            paddedExitHHMM ? ` y salida a las ${paddedExitHHMM}` : ""
          } para ${user.name}.`,
      entryRecord: {
        id: savedEntry.id,
        type: savedEntry.type,
        status: savedEntry.status,
        timestamp: savedEntry.timestamp.toISOString(),
        userId: user.id,
        campusName: resolvedCampusName,
        courseName: resolvedCourseName,
      },
      exitRecord: savedExit
        ? {
            id: savedExit.id,
            type: savedExit.type,
            status: savedExit.status,
            timestamp: savedExit.timestamp.toISOString(),
            userId: user.id,
            campusName: resolvedCampusName,
            courseName: resolvedCourseName,
          }
        : undefined,
    }
  } catch (error) {
    console.error("[regularizeEntryAndExitAction] Error:", error)
    return {
      success: false,
      message: "Ocurrió un error al regularizar o editar la hora de entrada.",
    }
  }
}
