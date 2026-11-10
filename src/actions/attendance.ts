"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { Role, RecordType, RecordStatus, Shift } from "@prisma/client"
import prisma from "@/lib/prisma"
import { limaMinutesOfDay, limaDayOfWeek } from "@/lib/timezone"
import { detectAndValidateCampus, validateHybridLocation } from "@/lib/geofence"
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

// Cachés en memoria (TTL: 60s) para acelerar tiempos de respuesta de validación y marcación
let cachedCampuses: { data: any[]; expiresAt: number } | null = null
let cachedCourses: { data: { id: string; name: string }[]; expiresAt: number } | null = null
let cachedToleranceRules: { data: any[]; expiresAt: number } | null = null
let cachedDirectory: { data: Record<string, any>; expiresAt: number } | null = null

async function getCachedCampusesList() {
  const now = Date.now()
  if (cachedCampuses && cachedCampuses.expiresAt > now) {
    return cachedCampuses.data
  }
  try {
    const list = await prisma.campus.findMany({
      select: { id: true, name: true, geoEnforced: true, latitude: true, longitude: true, radiusMeters: true },
    })
    cachedCampuses = { data: list, expiresAt: now + 60_000 }
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
    cachedCourses = { data: list, expiresAt: now + 60_000 }
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
    cachedToleranceRules = { data: list, expiresAt: now + 60_000 }
    return list
  } catch {
    return cachedToleranceRules ? cachedToleranceRules.data : []
  }
}

// ------------------------------------------------------------------
// 0. PRECARGA DEL DIRECTORIO DIARIO EN MEMORIA (RESPUESTA INSTANTÁNEA 0ms)
// ------------------------------------------------------------------
export async function preloadAttendanceDirectoryAction(): Promise<{
  success: boolean
  directory: Record<string, any>
}> {
  try {
    const nowMs = Date.now()
    if (cachedDirectory && cachedDirectory.expiresAt > nowMs) {
      return { success: true, directory: cachedDirectory.data }
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

    cachedDirectory = { data: directory, expiresAt: Date.now() + 15_000 }
    return { success: true, directory }
  } catch (error) {
    console.error("[preloadAttendanceDirectoryAction] Error:", error)
    return { success: false, directory: {} }
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

// ------------------------------------------------------------------
// 1. VALIDACIÓN AUTOMÁTICA POR DNI (ROL, SEDE, HORARIO Y AMBIENTE)
// ------------------------------------------------------------------
export async function validateUserAction(dni: string, roleOverride?: Role) {
  try {
    const cleanDni = dni.trim()

    // Respuesta en 0ms si el directorio en memoria está caliente
    if (cachedDirectory && cachedDirectory.expiresAt > Date.now() && !roleOverride) {
      const hit = cachedDirectory.data[cleanDni]
      if (hit) return hit
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

    // 1 solo lote en paralelo (evita esperas secuenciales BD -> BD -> API)
    const [user, userTodayRecords, todaySched, allRules, dailySessions] = await Promise.all([
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
      fetchDailyProgramSessions(),
    ])

    if (!user) {
      return { success: false, message: "⚠ El DNI ingresado no se encuentra registrado en el sistema." }
    }

    // Determinar el rol operativo automáticamente a partir del usuario en BD
    const isAdmin = user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN_SECUNDARIO
    const effectiveRole: Role = isAdmin ? (roleOverride || Role.DOCENTE) : user.role

    if (effectiveRole === Role.TECNICO && todaySched?.shift === Shift.DESCANSO) {
      return {
        success: false,
        message: `🏖️ Hola ${user.name}, hoy tienes asignado tu DÍA DE DESCANSO según el cronograma oficial. No requieres registrar asistencia.`,
      }
    }

    if (effectiveRole === Role.TECNICO && (todaySched?.shift === Shift.COMISION || (!todaySched && user.defaultShift === Shift.COMISION))) {
      return {
        success: false,
        isComision: true,
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
      if (todaySched) {
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
        const defaultShift = user.defaultShift || Shift.MANANA
        const def = DEFAULT_SHIFT_TIMES[defaultShift] || DEFAULT_SHIFT_TIMES.MANANA
        const techRules = allRules.filter((r: any) => r.role === Role.TECNICO)
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
    } else if (effectiveRole === Role.DOCENTE || effectiveRole === Role.PACIENTE_SIMULADO) {
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

    return result
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
export async function authorizeKioskWithOneTimeCodeAction(code: string): Promise<{
  success: boolean
  kioskToken?: string
  campusName?: string
  message: string
}> {
  try {
    const { consumeKioskOneTimeCode } = await import("@/lib/kiosk-codes")
    const result = await consumeKioskOneTimeCode(code)

    if (!result.success || !result.campusName) {
      return {
        success: false,
        message: result.message,
      }
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
          // Obtener registros previos del día para saber qué módulo le corresponde marcar
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

          const modResolution = resolveUserModulesState(
            prog.sessions,
            existingTodayRecs.map((r) => ({
              type: r.type,
              timestamp: r.timestamp.toISOString(),
              courseName: r.course?.name || null,
            })),
            getCurrentLimaMinutes(recordTimestamp)
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

        // Filtrar desde reglas en memoria
        const shiftRules = allRules.filter(
          (r: any) =>
            r.role === Role.TECNICO && (r.campusId === finalCampusId || r.campusId === null)
        )

        const matchingShiftRules = shiftRules.filter((r: any) => {
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
          if (!r.daysOfWeek || r.daysOfWeek.trim() === "" || r.daysOfWeek === "ALL") return true
          const days = r.daysOfWeek.split(",").map((d: string) => Number(d.trim()))
          return days.includes(currentDayOfWeek)
        })

        let matchedShiftRule = null
        const candidateRules = rulesForToday.length > 0 ? rulesForToday : matchingShiftRules

        if (candidateRules.length > 0) {
          candidateRules.sort((a: any, b: any) => {
            const diffA = Math.abs(getShiftDiffInMinutes(recordTimestamp, a.expectedEntryTime).diffInMinutes)
            const diffB = Math.abs(getShiftDiffInMinutes(recordTimestamp, b.expectedEntryTime).diffInMinutes)
            return diffA - diffB
          })
          matchedShiftRule = candidateRules[0]
        }

        let resolvedEntryTime = matchedShiftRule?.expectedEntryTime ?? defShift.entry
        if (scheduledShift) {
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

        const allTechRulesDisabledEarly = shiftRules.length > 0 && shiftRules.every((r: any) => r.enableEarlyTolerance === false)
        const isEarlyToleranceDisabled = allTechRulesDisabledEarly
          || (matchedShiftRule != null && matchedShiftRule.enableEarlyTolerance === false)
          || scheduledShift?.enableEarlyTolerance === false

        const allTechRulesDisabledLate = shiftRules.length > 0 && shiftRules.every((r: any) => r.enableLateTolerance === false)
        const isLateToleranceDisabled = allTechRulesDisabledLate
          || (matchedShiftRule != null && matchedShiftRule.enableLateTolerance === false)
          || scheduledShift?.enableLateTolerance === false

        const earlyMins = matchedShiftRule?.earlyEntryToleranceMinutes ?? scheduledShift?.earlyEntryToleranceMinutes ?? defShift.early
        const graceMins = matchedShiftRule?.gracePeriodMinutes ?? scheduledShift?.gracePeriodMinutes ?? defShift.grace
        const lateMins = matchedShiftRule?.lateToleranceMinutes ?? scheduledShift?.lateToleranceMinutes ?? defShift.late

        techRule = {
          expectedEntryTime: resolvedEntryTime,
          earlyEntryToleranceMinutes: earlyMins,
          gracePeriodMinutes: graceMins,
          lateToleranceMinutes: lateMins,
          shiftName: userShift,
          enableEarlyTolerance: !isEarlyToleranceDisabled,
          enableLateTolerance: !isLateToleranceDisabled,
        }

        const earlyCheck = validateEarlyEntry(recordTimestamp, techRule)
        if (!earlyCheck.allowed) {
          return {
            success: false,
            message: earlyCheck.message || "No se permite marcar con tanta anticipación para su turno asignado.",
          }
        }
        status = calculateStatusFromRule(recordTimestamp, techRule)
      } else {
        const matchedRule = findApplicableToleranceRule(allRules, finalCampusId || undefined, data.role)
        if (resolvedExpectedEntryTime) {
          const dynamicRule = {
            expectedEntryTime: resolvedExpectedEntryTime,
            earlyEntryToleranceMinutes: matchedRule?.earlyEntryToleranceMinutes ?? 30,
            gracePeriodMinutes: matchedRule?.gracePeriodMinutes ?? 10,
            lateToleranceMinutes: matchedRule?.lateToleranceMinutes ?? 30,
            enableEarlyTolerance: matchedRule?.enableEarlyTolerance ?? false,
            enableLateTolerance: matchedRule?.enableLateTolerance ?? true,
          }
          const earlyCheck = validateEarlyEntry(recordTimestamp, dynamicRule)
          if (!earlyCheck.allowed) {
            return {
              success: false,
              message: earlyCheck.message || "No se permite marcar con tanta anticipación.",
            }
          }
          status = calculateStatusFromRule(recordTimestamp, dynamicRule)
        } else if (matchedRule) {
          const earlyCheck = validateEarlyEntry(recordTimestamp, matchedRule)
          if (!earlyCheck.allowed) {
            return {
              success: false,
              message: earlyCheck.message || "No se permite marcar con tanta anticipación.",
            }
          }
          status = calculateStatusFromRule(recordTimestamp, matchedRule)
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
// 3. LÓGICA DE NEGOCIO: CÁLCULO DE REGLAS DE TOLERANCIA
// ------------------------------------------------------------------
function findApplicableToleranceRule(
  rules: any[],
  campusId?: string,
  role?: Role
) {
  if (rules.length === 0) return null
  return (
    (campusId && role ? rules.find(r => r.campusId === campusId && r.role === role) : null) ||
    (campusId ? rules.find(r => r.campusId === campusId && !r.role) : null) ||
    (role ? rules.find(r => !r.campusId && r.role === role) : null) ||
    rules.find(r => !r.campusId && !r.role) ||
    null
  )
}

function getShiftDiffInMinutes(recordTime: Date, expectedEntryTime: string): { diffInMinutes: number; recordMinutes: number; expectedMinutes: number } {
  const [expectedHour, expectedMinute] = expectedEntryTime.split(':').map(Number)
  const expectedMinutes = (isNaN(expectedHour) ? 8 : expectedHour) * 60 + (isNaN(expectedMinute) ? 0 : expectedMinute)
  const recordMinutes = limaMinutesOfDay(recordTime)

  // Diferencia horaria considerando el ciclo de 24 horas (720 min = 12 horas)
  let diffInMinutes = recordMinutes - expectedMinutes
  if (diffInMinutes < -720) {
    diffInMinutes += 1440
  } else if (diffInMinutes > 720) {
    diffInMinutes -= 1440
  }

  return { diffInMinutes, recordMinutes, expectedMinutes }
}

function validateEarlyEntry(
  recordTime: Date,
  rule: {
    expectedEntryTime: string
    earlyEntryToleranceMinutes: number
    lateToleranceMinutes?: number
    enableEarlyTolerance?: boolean
  }
): { allowed: boolean; message?: string } {
  // Si la restricción de hora anticipada de ingreso está desactivada: permitir el ingreso libremente
  if (rule.enableEarlyTolerance === false) {
    return { allowed: true }
  }

  const { diffInMinutes, expectedMinutes } = getShiftDiffInMinutes(recordTime, rule.expectedEntryTime)
  const earlyAllowed = rule.earlyEntryToleranceMinutes ?? 15
  // Ventana máxima permitida para registrar entrada: 240 minutos (4 horas) después de la hora oficial
  const maxLateAllowed = Math.max(rule.lateToleranceMinutes ?? 30, 240)

  // 1. Si intenta marcar antes de la ventana de anticipación permitida (ej: la noche anterior o 1 hora antes)
  if (diffInMinutes < -earlyAllowed) {
    const allowedStartMinutes = (expectedMinutes - earlyAllowed + 1440) % 1440
    const startHour = Math.floor(allowedStartMinutes / 60)
    const startMinute = allowedStartMinutes % 60
    const startPeriod = startHour >= 12 ? "PM" : "AM"
    const displayH = startHour % 12 === 0 ? 12 : startHour % 12
    const allowedStartTimeStr = `${String(displayH).padStart(2, "0")}:${String(startMinute).padStart(2, "0")} ${startPeriod}`

    return {
      allowed: false,
      message: `No se permite marcar fuera de horario. Su turno oficial es a las ${rule.expectedEntryTime}. Podrá registrar su entrada a partir de las ${allowedStartTimeStr} (máximo ${earlyAllowed} minutos antes).`,
    }
  }

  // 2. Si intenta marcar como "Entrada" muchas horas después de haber concluido el inicio de su turno
  if (diffInMinutes > maxLateAllowed) {
    return {
      allowed: false,
      message: `Su horario de entrada (${rule.expectedEntryTime}) ya venció hace más de 4 horas. No corresponde registrar entrada en este momento.`,
    }
  }

  return { allowed: true }
}

function calculateStatusFromRule(
  recordTime: Date,
  rule: {
    expectedEntryTime: string
    gracePeriodMinutes: number
    lateToleranceMinutes: number
    enableLateTolerance?: boolean
  }
): RecordStatus {
  // Si el control de tardanzas está desactivado: todas las entradas marcan A_TIEMPO sin penalización
  if (rule.enableLateTolerance === false) {
    return RecordStatus.A_TIEMPO
  }

  const { diffInMinutes } = getShiftDiffInMinutes(recordTime, rule.expectedEntryTime)

  if (diffInMinutes <= rule.gracePeriodMinutes) {
    return RecordStatus.A_TIEMPO
  } else if (diffInMinutes <= rule.lateToleranceMinutes) {
    return RecordStatus.TARDANZA
  } else {
    return RecordStatus.FALTA
  }
}

export async function calculateToleranceStatus(
  recordTime: Date, 
  campusId?: string, 
  role?: Role
): Promise<RecordStatus> {
  const rules = await prisma.toleranceRule.findMany()
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
      prisma.user.findMany({ where: { dni: { in: dnis } } }),
      prisma.campus.findMany(),
      prisma.toleranceRule.findMany(),
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
