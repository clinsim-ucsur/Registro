"use server"

import { revalidatePath } from "next/cache"
import { PrismaClient, Role, RecordType, RecordStatus } from "@prisma/client"

import prisma from "@/lib/prisma"
import { limaMinutesOfDay } from "@/lib/timezone"
import { checkGeofence } from "@/lib/geofence"

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
      }
    })

    if (!user) {
      return { success: false, message: "⚠ El usuario no está registrado." }
    }

    if (user.role !== role) {
      return { success: false, message: "⚠ El DNI existe, pero el rol seleccionado es incorrecto." }
    }

    return { success: true, user: { id: user.id, name: user.name } }
    
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
    // Límite por geolocalización según la configuración de cada sede
    // (el registro offline se valida en el dispositivo al guardarse)
    if (!data.isOfflineSync) {
      const allCampuses = await prisma.campus.findMany({
        select: { name: true, geoEnforced: true, latitude: true, longitude: true, radiusMeters: true },
      })
      const geoError = checkGeofence(data.location, allCampuses, data.campusId)
      if (geoError) return { success: false, message: geoError }
    }

    const recordTimestamp = data.isOfflineSync && data.clientTimestamp 
      ? new Date(data.clientTimestamp) 
      : new Date()

    const user = await prisma.user.findUnique({
      where: { id: data.userId }
    })

    if (!user) {
      return { success: false, message: "El usuario ya no existe en el sistema." }
    }

    // Resolver Campus por nombre (ya que el form envía nombres hardcodeados)
    let finalCampusId = null
    if (data.campusId && data.campusId.trim() !== '') {
      let campus = await prisma.campus.findUnique({ where: { name: data.campusId.trim() } })
      if (!campus) {
        campus = await prisma.campus.create({ data: { name: data.campusId.trim() } })
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
export function findApplicableToleranceRule(
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

export function validateEarlyEntry(
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

export async function calculateToleranceStatus(
  recordTime: Date, 
  campusId?: string, 
  role?: Role
): Promise<RecordStatus> {
  const rules = await prisma.toleranceRule.findMany()
  if (rules.length === 0) return RecordStatus.A_TIEMPO

  const rule = findApplicableToleranceRule(rules, campusId, role)
  if (!rule) return RecordStatus.A_TIEMPO

  const [expectedHour, expectedMinute] = rule.expectedEntryTime.split(':').map(Number)
  const expectedMinutes = (isNaN(expectedHour) ? 8 : expectedHour) * 60 + (isNaN(expectedMinute) ? 0 : expectedMinute)
  const recordMinutes = limaMinutesOfDay(recordTime)

  const diffInMinutes = recordMinutes - expectedMinutes

  // Si marca antes de la hora esperada o dentro del periodo de gracia
  if (diffInMinutes <= rule.gracePeriodMinutes) {
    return RecordStatus.A_TIEMPO
  } else if (diffInMinutes <= rule.lateToleranceMinutes) {
    return RecordStatus.TARDANZA
  } else {
    return RecordStatus.FALTA
  }
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
