"use server"

import { revalidatePath } from "next/cache"
import { Role, RecordType, RecordStatus, Shift } from "@prisma/client"
import prisma from "@/lib/prisma"
import { limaMinutesOfDay, limaDayOfWeek } from "@/lib/timezone"
import { detectAndValidateCampus } from "@/lib/geofence"
import { DEFAULT_SHIFT_TIMES } from "@/lib/schedule-constants"

// Caché de sedes en memoria (TTL: 60s) para acelerar tiempos de respuesta de marcación
let cachedCampuses: { data: any[]; expiresAt: number } | null = null

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
// 1. REEMPLAZO DE `validarDNI(rol, dni)`
// ------------------------------------------------------------------
export async function validateUserAction(dni: string, role: Role) {
  try {
    const user = await prisma.user.findUnique({
      where: { dni },
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
    })

    if (!user) {
      return { success: false, message: "⚠ El usuario no está registrado." }
    }

    // Permitir marcación si el rol coincide, O si el usuario es un Administrador con funciones operativas
    const isAdmin = user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN_SECUNDARIO
    if (user.role !== role && !isAdmin) {
      return { success: false, message: "⚠ El DNI existe, pero el rol seleccionado es incorrecto." }
    }

    // Consultar en paralelo: último registro de hoy y cronograma de técnico (si aplica)
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

    const [lastRecord, todaySched] = await Promise.all([
      prisma.attendanceRecord.findFirst({
        where: {
          userId: user.id,
          timestamp: { gte: startOfDayUTC, lt: endOfDayUTC },
        },
        orderBy: { timestamp: "desc" },
        select: { type: true },
      }),
      role === Role.TECNICO
        ? prisma.technicianSchedule.findUnique({
            where: {
              userId_date: {
                userId: user.id,
                date: limaDateStr,
              },
            },
            include: { campus: true },
          })
        : Promise.resolve(null),
    ])

    if (role === Role.TECNICO && todaySched?.shift === Shift.DESCANSO) {
      return {
        success: false,
        message: `🏖️ Hola ${user.name}, hoy tienes asignado tu DÍA DE DESCANSO según el cronograma oficial. No requieres registrar asistencia.`,
      }
    }

    if (role === Role.TECNICO && (todaySched?.shift === Shift.COMISION || (!todaySched && user.defaultShift === Shift.COMISION))) {
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
      source: "SCHEDULE" | "DEFAULT_PROFILE"
    } | null = null

    if (role === Role.TECNICO) {
      if (todaySched) {
        let expectedTime = todaySched.expectedEntryTime
        const def = DEFAULT_SHIFT_TIMES[todaySched.shift] || DEFAULT_SHIFT_TIMES.MANANA
        // Corregir contradicciones si el turno fue cambiado pero quedó el horario anterior
        if (todaySched.shift === Shift.INTERMEDIO && expectedTime === "13:00") {
          expectedTime = def.entry
        } else if (todaySched.shift === Shift.MANANA && expectedTime === "13:00") {
          expectedTime = def.entry
        } else if (todaySched.shift === Shift.TARDE && ["06:00", "07:00", "08:00", "09:00", "10:00"].includes(expectedTime)) {
          expectedTime = "13:00"
        }

        technicianAssignment = {
          campusName: todaySched.campus?.name || user.campus?.name || null,
          shift: todaySched.shift,
          expectedEntryTime: expectedTime,
          source: "SCHEDULE",
        }
      } else {
        const defaultShift = user.defaultShift || Shift.MANANA
        const def = DEFAULT_SHIFT_TIMES[defaultShift] || DEFAULT_SHIFT_TIMES.MANANA
        const matchingRule = await prisma.toleranceRule.findFirst({
          where: {
            role: Role.TECNICO,
            AND: [
              {
                OR: [
                  { shift: defaultShift },
                  { shift: null },
                ],
              },
              {
                OR: [
                  ...(user.campusId ? [{ campusId: user.campusId }] : []),
                  { campusId: null },
                ],
              },
            ],
          },
          orderBy: [{ campusId: "desc" }],
        })

        technicianAssignment = {
          campusName: user.campus?.name || null,
          shift: defaultShift,
          expectedEntryTime: matchingRule?.expectedEntryTime || def.entry,
          source: "DEFAULT_PROFILE",
        }
      }
    }

    return {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        campusId: user.campusId,
        campusName: user.campus?.name || null,
        defaultShift: user.defaultShift,
      },
      lastRecordType: lastRecord?.type ?? null,
      technicianAssignment,
    }
  } catch (error) {
    console.error("[validateUserAction] Error:", error)
    return { success: false, message: "Error de conexión con la base de datos." }
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

    // Consulta concurrente en paralelo: usuario, turno programado y sedes en 1 roundtrip
    const [user, scheduledShift, allCampuses] = await Promise.all([
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
    ])

    if (!user) {
      return { success: false, message: "El usuario ya no existe en el sistema." }
    }

    if (data.role === Role.TECNICO) {
      // Si el técnico está programado en DESCANSO para hoy
      if (scheduledShift && scheduledShift.shift === Shift.DESCANSO) {
        return {
          success: false,
          message: `Hoy tienes asignado tu DÍA DE DESCANSO programado. ¡Que tengas un buen descanso!`,
        }
      }

      // Si el técnico está asignado a COMISIÓN / EVENTO ESPECIAL (EV)
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

    // Detección y validación de sede por geolocalización (GPS) según configuración de Sedes & Cursos
    let resolvedCampusName: string | null = null

    const tentativeCampusName = (data.campusId && data.campusId.trim() !== '')
      ? data.campusId.trim()
      : (scheduledShift?.campus?.name || user.campus?.name || "Campus Villa")

    if (!data.isOfflineSync && data.location) {
      // Validación de sede: respeta la activación/desactivación en Sedes y Cursos
      const geoResult = detectAndValidateCampus(data.location, allCampuses, tentativeCampusName)
      if (!geoResult.allowed) {
        return { success: false, message: geoResult.error || "Ubicación fuera del perímetro permitido." }
      }

      if (data.campusId && data.campusId.trim() !== '') {
        resolvedCampusName = data.campusId.trim()
      } else if (geoResult.detectedCampusName) {
        resolvedCampusName = geoResult.detectedCampusName
      }
    } else if (!data.isOfflineSync && !data.location) {
      // Si la sede tiene activada la geocerca en "Sedes y Cursos", exigir GPS
      const targetDb = allCampuses.find((c) => c.name.toLowerCase() === tentativeCampusName.toLowerCase())
      if (targetDb && targetDb.geoEnforced && targetDb.latitude != null && targetDb.longitude != null) {
        return {
          success: false,
          message: `La sede "${targetDb.name}" requiere validación de ubicación GPS para registrar la asistencia.`
        }
      }
    }

    // Fallbacks si no hubo coordenadas GPS o en modo contingencia / offline:
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

    // Resolver Campus ID en memoria desde el catálogo precargado (ahorra consulta repetida a la BD)
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

    // Resolver Course por nombre
    let finalCourseId = null
    if (data.courseId && data.courseId.trim() !== '') {
      let course = await prisma.course.findUnique({ where: { name: data.courseId.trim() } })
      if (!course) {
        course = await prisma.course.create({ data: { name: data.courseId.trim() } })
      }
      finalCourseId = course.id
    }

    let status: RecordStatus = RecordStatus.A_TIEMPO
    
    if (data.type === RecordType.ENTRADA) {
      // Para TÉCNICOS: resolver turno de hoy por cronograma o por turno predeterminado del perfil
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

        // En domingos (currentDayOfWeek === 0):
        // Los técnicos de la tarde rotan comúnmente a turno Intermedio si no tienen programación específica
        if (!data.shift && !scheduledShift && currentDayOfWeek === 0 && userShift === Shift.TARDE) {
          userShift = Shift.INTERMEDIO
        }

        const defShift = DEFAULT_SHIFT_TIMES[userShift] || DEFAULT_SHIFT_TIMES.MANANA

        // Consultar reglas activas en la BD para este rol y sede
        const shiftRules = await prisma.toleranceRule.findMany({
          where: {
            role: Role.TECNICO,
            OR: [
              { campusId: finalCampusId },
              { campusId: null },
            ],
          },
          orderBy: [{ campusId: 'desc' }],
        })

        // Filtrar reglas que correspondan a su turno
        // Si es domingo y el técnico es de Mañana, permitir también evaluar reglas de Intermedio si llega cerca de las 9/10 AM
        const matchingShiftRules = shiftRules.filter(r => {
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

        // Filtrar por día de la semana según daysOfWeek
        const rulesForToday = matchingShiftRules.filter(r => {
          if (!r.daysOfWeek || r.daysOfWeek.trim() === "" || r.daysOfWeek === "ALL") return true
          const days = r.daysOfWeek.split(",").map(d => Number(d.trim()))
          return days.includes(currentDayOfWeek)
        })

        // Si hay varias reglas para hoy (ej: Domingo 9 AM y 10 AM en Turno Intermedio),
        // seleccionar la regla más cercana a la hora de marcación del técnico
        let matchedShiftRule = null
        const candidateRules = rulesForToday.length > 0 ? rulesForToday : matchingShiftRules

        if (candidateRules.length > 0) {
          candidateRules.sort((a, b) => {
            const diffA = Math.abs(getShiftDiffInMinutes(recordTimestamp, a.expectedEntryTime).diffInMinutes)
            const diffB = Math.abs(getShiftDiffInMinutes(recordTimestamp, b.expectedEntryTime).diffInMinutes)
            return diffA - diffB
          })
          matchedShiftRule = candidateRules[0]
        }

        // Determinar hora esperada de ingreso
        let resolvedEntryTime = matchedShiftRule?.expectedEntryTime ?? defShift.entry
        if (scheduledShift) {
          let sTime = scheduledShift.expectedEntryTime
          // Auto-corrección si el turno fue cambiado pero quedó la hora anterior
          if (userShift === Shift.INTERMEDIO && sTime === "13:00") {
            sTime = resolvedEntryTime || defShift.entry
          } else if (userShift === Shift.MANANA && sTime === "13:00") {
            sTime = defShift.entry
          } else if (userShift === Shift.TARDE && ["06:00", "07:00", "08:00", "09:00", "10:00"].includes(sTime)) {
            sTime = "13:00"
          }
          resolvedEntryTime = sTime
        }

        // Comprobar si la marcación anticipada o tardanza están desactivadas
        // (sea a nivel general de reglas de técnico, de la regla específica de su turno o del cronograma)
        const allTechRulesDisabledEarly = shiftRules.length > 0 && shiftRules.every(r => r.enableEarlyTolerance === false)
        const isEarlyToleranceDisabled = allTechRulesDisabledEarly
          || (matchedShiftRule != null && matchedShiftRule.enableEarlyTolerance === false)
          || scheduledShift?.enableEarlyTolerance === false

        const allTechRulesDisabledLate = shiftRules.length > 0 && shiftRules.every(r => r.enableLateTolerance === false)
        const isLateToleranceDisabled = allTechRulesDisabledLate
          || (matchedShiftRule != null && matchedShiftRule.enableLateTolerance === false)
          || scheduledShift?.enableLateTolerance === false

        // Tolerancias: priorizar la regla configurada por el administrador en ToleranceRule, luego scheduledShift, luego default
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
        // Para Docentes y Pacientes Simulados: buscar regla correspondiente a su sede y rol
        const allRules = await prisma.toleranceRule.findMany()
        const matchedRule = findApplicableToleranceRule(allRules, finalCampusId || undefined, data.role)
        if (matchedRule) {
          const earlyCheck = validateEarlyEntry(recordTimestamp, matchedRule)
          if (!earlyCheck.allowed) {
            return {
              success: false,
              message: earlyCheck.message || "No se permite marcar con tanta anticipación.",
            }
          }
          status = calculateStatusFromRule(recordTimestamp, matchedRule)
        } else {
          status = await calculateToleranceStatus(recordTimestamp, finalCampusId || undefined, data.role)
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

    try {
      revalidatePath("/dashboard")
    } catch {
      // Ignorar si se ejecuta fuera del ciclo de Next.js
    }

    return { 
      success: true, 
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
