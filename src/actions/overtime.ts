"use server"

import prisma from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/session"
import {
  DEFAULT_OVERTIME_SETTINGS,
  type OvertimeSettings,
  computeOvertimeForRecords,
} from "@/lib/overtime"
import { Role } from "@prisma/client"
import { startOfLimaDay, addDaysToKey } from "@/lib/timezone"

function safeRevalidate() {
  try {
    revalidatePath("/dashboard")
    revalidatePath("/")
  } catch {}
}

/**
 * Obtiene la configuración actual de horas extras del sistema.
 */
export async function getOvertimeSettingsAction(): Promise<OvertimeSettings> {
  try {
    const settings = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: ["OVERTIME_MIN_MINUTES", "OVERTIME_ROUNDING_MODE", "OVERTIME_WORKDAY_HOURS"],
        },
      },
    })

    const map = new Map(settings.map((s) => [s.key, s.value]))

    const minMinutes = map.has("OVERTIME_MIN_MINUTES")
      ? parseInt(map.get("OVERTIME_MIN_MINUTES")!, 10)
      : DEFAULT_OVERTIME_SETTINGS.minMinutes

    const roundingMode = (map.get("OVERTIME_ROUNDING_MODE") as "DECIMAL" | "HORAS_COMPLETAS") || DEFAULT_OVERTIME_SETTINGS.roundingMode

    const workdayHours = map.has("OVERTIME_WORKDAY_HOURS")
      ? parseInt(map.get("OVERTIME_WORKDAY_HOURS")!, 10)
      : DEFAULT_OVERTIME_SETTINGS.workdayHours

    return {
      minMinutes: isNaN(minMinutes) ? 60 : minMinutes,
      roundingMode: ["DECIMAL", "HORAS_COMPLETAS"].includes(roundingMode) ? roundingMode : "DECIMAL",
      workdayHours: isNaN(workdayHours) ? 9 : workdayHours,
    }
  } catch (error) {
    console.error("[getOvertimeSettingsAction] Error:", error)
    return DEFAULT_OVERTIME_SETTINGS
  }
}

/**
 * Guarda o actualiza los parámetros del control de horas extras.
 */
export async function updateOvertimeSettingsAction(data: {
  minMinutes: number
  roundingMode?: "DECIMAL" | "HORAS_COMPLETAS"
  workdayHours?: number
}) {
  try {
    await requireAdmin()

    const minMinutes = Number(data.minMinutes)
    if (isNaN(minMinutes) || minMinutes < 0) {
      return { success: false, message: "El umbral mínimo de minutos debe ser un número igual o mayor a 0." }
    }

    const roundingMode = data.roundingMode || "DECIMAL"
    const workdayHours = Number(data.workdayHours ?? 9)

    await Promise.all([
      prisma.systemSetting.upsert({
        where: { key: "OVERTIME_MIN_MINUTES" },
        update: { value: String(minMinutes), description: "Minutos mínimos para contabilizar horas extras" },
        create: { key: "OVERTIME_MIN_MINUTES", value: String(minMinutes), description: "Minutos mínimos para contabilizar horas extras" },
      }),
      prisma.systemSetting.upsert({
        where: { key: "OVERTIME_ROUNDING_MODE" },
        update: { value: roundingMode, description: "Modo de redondeo (DECIMAL o HORAS_COMPLETAS)" },
        create: { key: "OVERTIME_ROUNDING_MODE", value: roundingMode, description: "Modo de redondeo (DECIMAL o HORAS_COMPLETAS)" },
      }),
      prisma.systemSetting.upsert({
        where: { key: "OVERTIME_WORKDAY_HOURS" },
        update: { value: String(workdayHours), description: "Horas de jornada laboral oficial (8h trabajo + 1h refrigerio = 9)" },
        create: { key: "OVERTIME_WORKDAY_HOURS", value: String(workdayHours), description: "Horas de jornada laboral oficial (8h trabajo + 1h refrigerio = 9)" },
      }),
    ])

    safeRevalidate()

    return {
      success: true,
      message: `✓ Parámetro actualizado: Se contabilizarán horas extras únicamente cuando superen ${minMinutes} minutos (${Math.round((minMinutes / 60) * 10) / 10} h).`,
      settings: { minMinutes, roundingMode, workdayHours },
    }
  } catch (error: any) {
    console.error("[updateOvertimeSettingsAction] Error:", error)
    return { success: false, message: error.message || "Error al actualizar la configuración de horas extras." }
  }
}

/**
 * Obtiene el reporte detallado y consolidado de horas extras para un rango de fechas.
 */
export async function getOvertimeReportAction(params: {
  startDate?: string // "YYYY-MM-DD"
  endDate?: string // "YYYY-MM-DD"
  campusId?: string
  role?: Role | "ALL"
}) {
  try {
    const settings = await getOvertimeSettingsAction()

    const where: any = {}

    if (params.startDate || params.endDate) {
      where.timestamp = {}
      if (params.startDate) {
        where.timestamp.gte = startOfLimaDay(params.startDate)
      }
      if (params.endDate) {
        where.timestamp.lt = startOfLimaDay(addDaysToKey(params.endDate, 1))
      }
    }

    if (params.campusId && params.campusId !== "ALL") {
      where.campusId = params.campusId
    }

    if (params.role && params.role !== "ALL") {
      where.user = { role: params.role }
    } else {
      // Por defecto para horas extras se enfoca en TÉCNICOS (o todo el personal si se solicita)
      where.user = { role: Role.TECNICO }
    }

    const records = await prisma.attendanceRecord.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, dni: true, role: true, defaultShift: true, campus: { select: { name: true } } } },
        campus: { select: { id: true, name: true } },
      },
      orderBy: { timestamp: "asc" },
    })

    // Consultar cronogramas en el rango de fechas para empatar turnos
    const userIds = Array.from(new Set(records.map((r) => r.userId)))
    const schedules = await prisma.technicianSchedule.findMany({
      where: {
        userId: { in: userIds },
      },
      include: {
        campus: { select: { name: true } },
      },
    })

    const schedulesMap = new Map<string, { shift: string; expectedEntryTime: string; campusName?: string }>()
    for (const s of schedules) {
      schedulesMap.set(`${s.userId}_${s.date}`, {
        shift: s.shift,
        expectedEntryTime: s.expectedEntryTime,
        campusName: s.campus?.name,
      })
    }

    const result = computeOvertimeForRecords(records, schedulesMap, settings)

    return {
      success: true,
      settings,
      ...result,
    }
  } catch (error: any) {
    console.error("[getOvertimeReportAction] Error:", error)
    return {
      success: false,
      message: error.message || "Error al calcular reporte de horas extras.",
      pairs: [],
      staffSummaries: [],
      totalRawHours: 0,
      totalCountedHours: 0,
      totalStaffWithOvertime: 0,
    }
  }
}
