"use server"

import prisma from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/session"
import { Shift, Role } from "@prisma/client"
import { ScheduleItemInput, DEFAULT_SHIFT_TIMES } from "@/lib/schedule-constants"

/**
 * Obtiene el cronograma para un rango de fechas o mes específico.
 */
export async function getTechnicianSchedulesAction(params: {
  month?: string // "YYYY-MM"
  date?: string // "YYYY-MM-DD"
  campusId?: string
  userId?: string
}) {
  try {
    const where: any = {}

    if (params.date) {
      where.date = params.date
    } else if (params.month) {
      where.date = { startsWith: params.month }
    }

    if (params.campusId && params.campusId !== "ALL") {
      where.campusId = params.campusId
    }

    if (params.userId) {
      where.userId = params.userId
    }

    const schedules = await prisma.technicianSchedule.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, dni: true, defaultShift: true } },
        campus: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "asc" }, { expectedEntryTime: "asc" }],
    })

    return { success: true, schedules }
  } catch (error: any) {
    console.error("[getTechnicianSchedulesAction] Error:", error)
    return { success: false, message: error.message || "Error al obtener el cronograma.", schedules: [] }
  }
}

/**
 * Crea o actualiza un turno en el cronograma individualmente.
 */
export async function upsertTechnicianScheduleAction(item: ScheduleItemInput) {
  try {
    await requireAdmin()

    // Resolver usuario
    let targetUserId = item.userId
    if (!targetUserId && item.dni) {
      const u = await prisma.user.findUnique({ where: { dni: item.dni.trim() } })
      if (!u) return { success: false, message: `Usuario con DNI ${item.dni} no encontrado.` }
      targetUserId = u.id
    }
    if (!targetUserId) {
      return { success: false, message: "Debe seleccionar un técnico." }
    }

    // Resolver Sede
    let targetCampusId = item.campusId
    if (!targetCampusId && item.campusName) {
      let c = await prisma.campus.findUnique({ where: { name: item.campusName.trim() } })
      if (!c) {
        c = await prisma.campus.create({ data: { name: item.campusName.trim() } })
      }
      targetCampusId = c.id
    }
    if (!targetCampusId) {
      return { success: false, message: "Debe seleccionar la sede asignada." }
    }

    // Normalizar turno y horario
    const shiftKey = (item.shift || Shift.MANANA) as Shift
    const def = DEFAULT_SHIFT_TIMES[shiftKey]
    const entryTime = item.expectedEntryTime && item.expectedEntryTime.trim() !== ""
      ? item.expectedEntryTime.trim()
      : def.entry
    const early = item.earlyEntryToleranceMinutes ?? def.early
    const grace = item.gracePeriodMinutes ?? def.grace
    const late = item.lateToleranceMinutes ?? def.late

    const schedule = await prisma.technicianSchedule.upsert({
      where: {
        userId_date: {
          userId: targetUserId,
          date: item.date,
        },
      },
      create: {
        userId: targetUserId,
        date: item.date,
        campusId: targetCampusId,
        shift: shiftKey,
        expectedEntryTime: entryTime,
        earlyEntryToleranceMinutes: early,
        gracePeriodMinutes: grace,
        lateToleranceMinutes: late,
        enableEarlyTolerance: item.enableEarlyTolerance ?? true,
        enableLateTolerance: item.enableLateTolerance ?? true,
        notes: item.notes || null,
      },
      update: {
        campusId: targetCampusId,
        shift: shiftKey,
        expectedEntryTime: entryTime,
        earlyEntryToleranceMinutes: early,
        gracePeriodMinutes: grace,
        lateToleranceMinutes: late,
        enableEarlyTolerance: item.enableEarlyTolerance ?? true,
        enableLateTolerance: item.enableLateTolerance ?? true,
        notes: item.notes || null,
      },
      include: {
        user: { select: { id: true, name: true, dni: true } },
        campus: { select: { id: true, name: true } },
      },
    })

    revalidatePath("/dashboard")
    revalidatePath("/")
    return {
      success: true,
      message: `Turno guardado para ${schedule.user.name} el ${schedule.date} en ${schedule.campus.name}.`,
      schedule,
    }
  } catch (error: any) {
    console.error("[upsertTechnicianScheduleAction] Error:", error)
    return { success: false, message: error.message || "Error al guardar turno en el cronograma." }
  }
}

/**
 * Elimina un turno del cronograma.
 */
export async function deleteTechnicianScheduleAction(id: string) {
  try {
    await requireAdmin()
    await prisma.technicianSchedule.delete({ where: { id } })
    revalidatePath("/dashboard")
    return { success: true, message: "Turno eliminado del cronograma." }
  } catch (error: any) {
    console.error("[deleteTechnicianScheduleAction] Error:", error)
    return { success: false, message: error.message || "Error al eliminar turno." }
  }
}

/**
 * Carga masiva de cronograma desde datos estructurados (vía Excel/CSV o post-OCR).
 */
export async function bulkUpsertTechnicianSchedulesAction(items: ScheduleItemInput[]) {
  try {
    await requireAdmin()

    if (!items || items.length === 0) {
      return { success: false, message: "No hay registros para procesar." }
    }

    // Precargar usuarios técnicos y sedes para resolución en memoria
    const [technicians, campuses] = await Promise.all([
      prisma.user.findMany({
        where: { role: Role.TECNICO },
        select: { id: true, name: true, dni: true },
      }),
      prisma.campus.findMany(),
    ])

    const dniMap = new Map(technicians.map((t) => [t.dni.trim(), t]))
    const nameMap = new Map(technicians.map((t) => [t.name.trim().toLowerCase(), t]))
    const campusMap = new Map(campuses.map((c) => [c.name.trim().toLowerCase(), c.id]))

    let processed = 0
    let errors = 0
    const errorDetails: string[] = []

    for (const item of items) {
      if (!item.date || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
        errors++
        errorDetails.push(`Fecha inválida: ${item.date}`)
        continue
      }

      // Buscar técnico por DNI o por coincidencia de nombre
      let targetUser = item.userId ? technicians.find((t) => t.id === item.userId) : null
      if (!targetUser && item.dni) {
        targetUser = dniMap.get(item.dni.trim()) || null
      }
      if (!targetUser && (item as any).name) {
        const cleanName = String((item as any).name).trim().toLowerCase()
        targetUser = nameMap.get(cleanName) || null
        if (!targetUser) {
          // Búsqueda parcial
          targetUser = technicians.find((t) => t.name.toLowerCase().includes(cleanName) || cleanName.includes(t.name.toLowerCase())) || null
        }
      }

      if (!targetUser) {
        errors++
        errorDetails.push(`Técnico no encontrado: ${item.dni || (item as any).name || "Sin identificar"}`)
        continue
      }

      // Resolver Sede
      let targetCampusId = item.campusId
      if (!targetCampusId && item.campusName) {
        const cleanCName = item.campusName.trim().toLowerCase()
        targetCampusId = campusMap.get(cleanCName)
        if (!targetCampusId) {
          // Coincidencia parcial con sedes conocidas (ej: "villa", "aramburu", "norte", "ate")
          for (const [cName, cId] of campusMap.entries()) {
            if (cName.includes(cleanCName) || cleanCName.includes(cName)) {
              targetCampusId = cId
              break
            }
          }
        }
      }

      if (!targetCampusId) {
        errors++
        errorDetails.push(`Sede no encontrada para ${targetUser.name}: ${item.campusName || "vacía"}`)
        continue
      }

      // Normalizar turno
      let shiftKey: Shift = Shift.MANANA
      const rawShift = String(item.shift || "").toUpperCase().trim()
      if (rawShift.includes("EV") || rawShift.includes("EVENTO") || rawShift.includes("COMISION")) {
        shiftKey = Shift.COMISION
      } else if (rawShift.includes("DESC") || rawShift.includes("LIBRE") || rawShift === "D" || rawShift === "L") {
        shiftKey = Shift.DESCANSO
      } else if (rawShift.includes("TARDE") || rawShift === "T") {
        shiftKey = Shift.TARDE
      } else if (rawShift.includes("INTER") || rawShift.includes("MED") || rawShift === "I") {
        shiftKey = Shift.INTERMEDIO
      } else if (rawShift.includes("NOCHE") || rawShift === "N") {
        shiftKey = Shift.NOCHE
      } else if (rawShift.includes("MANANA") || rawShift.includes("MAÑANA") || rawShift === "M") {
        shiftKey = Shift.MANANA
      }

      const def = DEFAULT_SHIFT_TIMES[shiftKey] || DEFAULT_SHIFT_TIMES.MANANA
      const entryTime = item.expectedEntryTime && item.expectedEntryTime.trim() !== ""
        ? item.expectedEntryTime.trim()
        : def.entry
      const early = item.earlyEntryToleranceMinutes ?? def.early
      const grace = item.gracePeriodMinutes ?? def.grace
      const late = item.lateToleranceMinutes ?? def.late

      await prisma.technicianSchedule.upsert({
        where: {
          userId_date: {
            userId: targetUser.id,
            date: item.date,
          },
        },
        create: {
          userId: targetUser.id,
          date: item.date,
          campusId: targetCampusId,
          shift: shiftKey,
          expectedEntryTime: entryTime,
          earlyEntryToleranceMinutes: early,
          gracePeriodMinutes: grace,
          lateToleranceMinutes: late,
          enableEarlyTolerance: item.enableEarlyTolerance ?? true,
          enableLateTolerance: item.enableLateTolerance ?? true,
          notes: item.notes || "Carga Masiva",
        },
        update: {
          campusId: targetCampusId,
          shift: shiftKey,
          expectedEntryTime: entryTime,
          earlyEntryToleranceMinutes: early,
          gracePeriodMinutes: grace,
          lateToleranceMinutes: late,
          enableEarlyTolerance: item.enableEarlyTolerance ?? true,
          enableLateTolerance: item.enableLateTolerance ?? true,
          notes: item.notes || "Carga Masiva",
        },
      })
      processed++
    }

    revalidatePath("/dashboard")
    revalidatePath("/")
    return {
      success: true,
      message: `Se procesaron exitosamente ${processed} asignaciones de turno.${errors > 0 ? ` (${errors} omitidos)` : ""}`,
      processed,
      errors,
      errorDetails: errorDetails.slice(0, 10),
    }
  } catch (error: any) {
    console.error("[bulkUpsertTechnicianSchedulesAction] Error:", error)
    return { success: false, message: error.message || "Error al procesar el lote de cronogramas." }
  }
}

/**
 * Consulta la asignación de hoy de un técnico (usada en la marcación de asistencia).
 */
export async function getTodayTechnicianAssignmentAction(userId: string) {
  try {
    // Fecha Lima en formato "YYYY-MM-DD"
    const now = new Date()
    const limaDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now) // devuelve "YYYY-MM-DD"

    // Buscar en cronograma del día
    const schedule = await prisma.technicianSchedule.findUnique({
      where: {
        userId_date: {
          userId,
          date: limaDateStr,
        },
      },
      include: {
        campus: {
          select: {
            id: true,
            name: true,
            geoEnforced: true,
            latitude: true,
            longitude: true,
            radiusMeters: true,
          },
        },
      },
    })

    if (schedule) {
      let expectedEntryTime = schedule.expectedEntryTime
      const def = DEFAULT_SHIFT_TIMES[schedule.shift] || DEFAULT_SHIFT_TIMES.MANANA
      if (schedule.shift === Shift.INTERMEDIO && expectedEntryTime === "13:00") {
        expectedEntryTime = def.entry
      } else if (schedule.shift === Shift.MANANA && expectedEntryTime === "13:00") {
        expectedEntryTime = def.entry
      } else if (schedule.shift === Shift.TARDE && ["06:00", "07:00", "08:00", "09:00", "10:00"].includes(expectedEntryTime)) {
        expectedEntryTime = "13:00"
      }

      return {
        assignedToday: true,
        source: "SCHEDULE" as const,
        date: schedule.date,
        campus: schedule.campus,
        shift: schedule.shift,
        expectedEntryTime,
        earlyEntryToleranceMinutes: schedule.earlyEntryToleranceMinutes,
        gracePeriodMinutes: schedule.gracePeriodMinutes,
        lateToleranceMinutes: schedule.lateToleranceMinutes,
      }
    }

    // Si no tiene cronograma programado hoy, usar su sede base y turno base del perfil
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        defaultShift: true,
        campus: {
          select: {
            id: true,
            name: true,
            geoEnforced: true,
            latitude: true,
            longitude: true,
            radiusMeters: true,
          },
        },
      },
    })

    // Día de la semana en Lima (0=Dom, 1=Lun, ..., 6=Sáb)
    const currentDayOfWeek = new Date(`${limaDateStr}T12:00:00Z`).getUTCDay()

    let userShift = user?.defaultShift || Shift.MANANA
    // En domingos, el personal de la tarde comúnmente rota a Turno Intermedio (09:00 AM) si no tiene cronograma explícito
    if (currentDayOfWeek === 0 && userShift === Shift.TARDE) {
      userShift = Shift.INTERMEDIO
    }

    const def = DEFAULT_SHIFT_TIMES[userShift] || DEFAULT_SHIFT_TIMES.MANANA

    // Consultar si existe una regla personalizada para este turno, sede y día de la semana
    let expectedEntry = def.entry
    let early = def.early
    let grace = def.grace
    let late = def.late

    const shiftRules = await prisma.toleranceRule.findMany({
      where: {
        role: Role.TECNICO,
        OR: [
          ...(user?.campus?.id ? [{ campusId: user.campus.id }] : []),
          { campusId: null },
        ],
      },
      orderBy: [{ campusId: "desc" }],
    })

    // Reglas que coinciden con su turno
    const matchingRules = shiftRules.filter((r) => {
      if (r.shift) return r.shift === userShift
      if (userShift === Shift.INTERMEDIO) return ["08:00", "09:00", "10:00"].includes(r.expectedEntryTime)
      return r.expectedEntryTime === def.entry
    })

    // Reglas para el día de hoy según daysOfWeek
    const rulesForToday = matchingRules.filter((r) => {
      if (!r.daysOfWeek || r.daysOfWeek.trim() === "" || r.daysOfWeek === "ALL") return true
      const days = r.daysOfWeek.split(",").map((d) => Number(d.trim()))
      return days.includes(currentDayOfWeek)
    })

    const activeRule = rulesForToday[0] || matchingRules[0]
    if (activeRule) {
      expectedEntry = activeRule.expectedEntryTime
      early = activeRule.earlyEntryToleranceMinutes ?? early
      grace = activeRule.gracePeriodMinutes ?? grace
      late = activeRule.lateToleranceMinutes ?? late
    }

    return {
      assignedToday: user?.campus ? true : false,
      source: "DEFAULT_PROFILE" as const,
      date: limaDateStr,
      campus: user?.campus || null,
      shift: userShift,
      expectedEntryTime: expectedEntry,
      earlyEntryToleranceMinutes: early,
      gracePeriodMinutes: grace,
      lateToleranceMinutes: late,
    }
  } catch (error) {
    console.error("[getTodayTechnicianAssignmentAction] Error:", error)
    return { assignedToday: false, campus: null, shift: Shift.MANANA }
  }
}
