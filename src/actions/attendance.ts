"use server"

import { revalidatePath } from "next/cache"
import { PrismaClient, Role, RecordType, RecordStatus } from "@prisma/client"

import prisma from "@/lib/prisma"
import { limaMinutesOfDay } from "@/lib/timezone"
import { checkGeofence } from "@/lib/geofence"

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

    if (user.role !== role) {
      return { success: false, message: "⚠ El DNI existe, pero el rol seleccionado es incorrecto." }
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
  campusId?: string
  courseId?: string
  isOfflineSync?: boolean
  clientTimestamp?: Date 
  location?: { lat: number; lng: number; accuracy?: number }
}

export async function registerAttendanceAction(data: RegisterAttendanceData) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      include: { campus: true },
    })

    if (!user) {
      return { success: false, message: "El usuario ya no existe en el sistema." }
    }

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

    // Si es TÉCNICO, verificar si tiene turno programado para hoy en el cronograma
    let scheduledShift: any = null
    if (data.role === Role.TECNICO) {
      scheduledShift = await prisma.technicianSchedule.findUnique({
        where: {
          userId_date: {
            userId: data.userId,
            date: limaDateStr,
          },
        },
        include: { campus: true },
      })
    }

    // Resolver Campus de marcación:
    // 1. data.campusId si vino del formulario (seleccionado o auto-asignado)
    // 2. Si no vino, pero hay cronograma hoy -> usar campus del cronograma
    // 3. Si no hay cronograma, pero el usuario tiene campus base -> usar su campus
    let resolvedCampusName = data.campusId && data.campusId.trim() !== '' ? data.campusId.trim() : null
    if (!resolvedCampusName && scheduledShift?.campus?.name) {
      resolvedCampusName = scheduledShift.campus.name
    } else if (!resolvedCampusName && user.campus?.name) {
      resolvedCampusName = user.campus.name
    }

    // Límite por geolocalización según la configuración de la sede
    if (!data.isOfflineSync) {
      const allCampuses = await prisma.campus.findMany({
        select: { name: true, geoEnforced: true, latitude: true, longitude: true, radiusMeters: true },
      })
      const geoError = checkGeofence(data.location, allCampuses, resolvedCampusName || undefined)
      if (geoError) return { success: false, message: geoError }
    }

    // Resolver Campus ID en BD
    let finalCampusId = null
    if (resolvedCampusName) {
      let campus = await prisma.campus.findUnique({ where: { name: resolvedCampusName } })
      if (!campus) {
        campus = await prisma.campus.create({ data: { name: resolvedCampusName } })
      }
      finalCampusId = campus.id
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
      // Si el técnico tiene un horario/turno específico asignado hoy en su cronograma,
      // usamos esas tolerancias prioritariamente sobre las reglas genéricas
      if (scheduledShift) {
        const scheduleRule = {
          expectedEntryTime: scheduledShift.expectedEntryTime,
          earlyEntryToleranceMinutes: scheduledShift.earlyEntryToleranceMinutes ?? 15,
          gracePeriodMinutes: scheduledShift.gracePeriodMinutes ?? 10,
          lateToleranceMinutes: scheduledShift.lateToleranceMinutes ?? 30,
        }
        const earlyCheck = validateEarlyEntry(recordTimestamp, scheduleRule)
        if (!earlyCheck.allowed) {
          return {
            success: false,
            message: earlyCheck.message || "No se permite marcar con tanta anticipación.",
          }
        }
        status = calculateStatusFromRule(recordTimestamp, scheduleRule)
      } else {
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
        }
        status = await calculateToleranceStatus(recordTimestamp, finalCampusId || undefined, data.role)
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

    revalidatePath("/dashboard")

    return { 
      success: true, 
      message: `✓ Se registró exitosamente su ${data.type.toLowerCase()}: ${user.name}`
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

function validateEarlyEntry(
  recordTime: Date,
  rule: { expectedEntryTime: string; earlyEntryToleranceMinutes: number }
): { allowed: boolean; message?: string } {
  const [expectedHour, expectedMinute] = rule.expectedEntryTime.split(':').map(Number)
  const expectedMinutes = (isNaN(expectedHour) ? 8 : expectedHour) * 60 + (isNaN(expectedMinute) ? 0 : expectedMinute)
  const recordMinutes = limaMinutesOfDay(recordTime)

  const diffInMinutes = recordMinutes - expectedMinutes
  const earlyAllowed = rule.earlyEntryToleranceMinutes ?? 15

  // Si marca con demasiada anticipación (ej: diffInMinutes < -15)
  if (diffInMinutes < -earlyAllowed) {
    const earlyMinutesActual = Math.abs(diffInMinutes)
    const allowedStartMinutes = (expectedMinutes - earlyAllowed + 1440) % 1440
    const startHour = Math.floor(allowedStartMinutes / 60)
    const startMinute = allowedStartMinutes % 60
    const startPeriod = startHour >= 12 ? "PM" : "AM"
    const displayH = startHour % 12 === 0 ? 12 : startHour % 12
    const allowedStartTimeStr = `${String(displayH).padStart(2, "0")}:${String(startMinute).padStart(2, "0")} ${startPeriod}`

    return {
      allowed: false,
      message: `No se permite marcar con tanta anticipación. Su hora de entrada oficial es ${rule.expectedEntryTime}. Podrá marcar a partir de las ${allowedStartTimeStr} (máximo ${earlyAllowed} min antes).`,
    }
  }

  return { allowed: true }
}

function calculateStatusFromRule(
  recordTime: Date,
  rule: { expectedEntryTime: string; gracePeriodMinutes: number; lateToleranceMinutes: number }
): RecordStatus {
  const [expectedHour, expectedMinute] = rule.expectedEntryTime.split(':').map(Number)
  const expectedMinutes = (isNaN(expectedHour) ? 8 : expectedHour) * 60 + (isNaN(expectedMinute) ? 0 : expectedMinute)
  const recordMinutes = limaMinutesOfDay(recordTime)
  const diffInMinutes = recordMinutes - expectedMinutes

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
    let syncedCount = 0
    let errorCount = 0
    
    for (const record of records) {
      // Buscamos el usuario por DNI porque offline no teníamos su ID
      const user = await prisma.user.findUnique({ where: { dni: record.dni } })
      
      if (!user) {
        errorCount++
        continue
      }

      // Resolver Campus y Course para el sync offline
      let finalCampusId = null
      if (record.campusId) {
        let campus = await prisma.campus.findUnique({ where: { name: record.campusId } })
        if (!campus) campus = await prisma.campus.create({ data: { name: record.campusId } })
        finalCampusId = campus.id
      }
      
      let finalCourseId = null
      if (record.courseId) {
        let course = await prisma.course.findUnique({ where: { name: record.courseId } })
        if (!course) course = await prisma.course.create({ data: { name: record.courseId } })
        finalCourseId = course.id
      }

      const recDate = new Date(record.timestamp)
      let status: RecordStatus = RecordStatus.A_TIEMPO
      if (record.type === RecordType.ENTRADA) {
        status = await calculateToleranceStatus(recDate, finalCampusId || undefined, user.role)
      }

      await prisma.attendanceRecord.create({
        data: {
          userId: user.id,
          type: record.type,
          campusId: finalCampusId,
          courseId: finalCourseId,
          timestamp: recDate,
          status: status,
          isOfflineSync: true,
        }
      })
      syncedCount++
    }

    revalidatePath("/dashboard")
    return { success: true, syncedCount, errorCount }
  } catch (error) {
    console.error("[syncOfflineRecordsAction]", error)
    return { success: false, message: "Error al sincronizar lotes offline." }
  }
}
