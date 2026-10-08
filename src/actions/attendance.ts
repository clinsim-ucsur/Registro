"use server"

import { revalidatePath } from "next/cache"
import { PrismaClient, Role, RecordType, RecordStatus } from "@prisma/client"

import prisma from "@/lib/prisma"

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
}

export async function registerAttendanceAction(data: RegisterAttendanceData) {
  try {
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
async function calculateToleranceStatus(
  recordTime: Date, 
  campusId?: string, 
  role?: Role
): Promise<RecordStatus> {
  const rule = await prisma.toleranceRule.findFirst({
    where: {
      OR: [
        { campusId: campusId || null, role: role },
        { campusId: campusId || null, role: null },
        { campusId: null, role: null }     
      ]
    }
  })

  if (!rule) return RecordStatus.A_TIEMPO

  const [expectedHour, expectedMinute] = rule.expectedEntryTime.split(':').map(Number)
  
  const expectedDate = new Date(recordTime)
  expectedDate.setHours(expectedHour, expectedMinute, 0, 0)

  const diffInMinutes = (recordTime.getTime() - expectedDate.getTime()) / (1000 * 60)

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

      await prisma.attendanceRecord.create({
        data: {
          userId: user.id,
          type: record.type,
          campusId: finalCampusId,
          courseId: finalCourseId,
          timestamp: new Date(record.timestamp),
          status: RecordStatus.A_TIEMPO,
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
