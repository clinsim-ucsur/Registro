import { DEFAULT_SHIFT_TIMES } from "@/lib/schedule-constants"
import { limaMinutesOfDay, limaDayKey } from "@/lib/timezone"
import { Shift } from "@prisma/client"

export type OvertimeSettings = {
  minMinutes: number // default: 60 (mínimo 1 hora para empezar a contabilizar)
  roundingMode: "DECIMAL" | "HORAS_COMPLETAS" // default: "DECIMAL" (ej: 1.25 hrs vs 1.0 hr)
  workdayHours: number // default: 9 (8h trabajo + 1h refrigerio)
}

export const DEFAULT_OVERTIME_SETTINGS: OvertimeSettings = {
  minMinutes: 60,
  roundingMode: "DECIMAL",
  workdayHours: 9,
}

export type OvertimePair = {
  date: string
  userId: string
  userName: string
  userDni: string
  shift: string
  campusName: string
  entryTime: string // "HH:mm"
  exitTime: string // "HH:mm"
  scheduledExitTime: string // "HH:mm"
  rawExtraMinutes: number // Minutos excedidos después de la hora oficial
  countedExtraMinutes: number // Minutos reconocidos (0 si no superó minMinutes)
  countedHours: number // Horas reconocidas contabilizadas
  qualifies: boolean // true si rawExtraMinutes >= minMinutes
}

export type UserOvertimeSummary = {
  userId: string
  userName: string
  userDni: string
  role: string
  shift: string
  campusName: string
  totalDaysWithOvertime: number
  totalRawExtraMinutes: number
  totalRawHours: number
  totalCountedExtraMinutes: number
  totalCountedHours: number
  formattedRawTime: string // ej: "2h 45m"
  formattedCountedHours: string // ej: "2.5 hrs"
}

export function formatMinutesToHoursAndMins(minutes: number): string {
  if (minutes <= 0) return "0 min"
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h}h ${m}m`
}

/**
 * Calcula la hora esperada de salida según la hora de entrada esperada y la jornada oficial (default 9h).
 */
export function calculateExpectedExitTime(expectedEntryTime: string, workdayHours: number = 9): string {
  const [hStr, mStr] = (expectedEntryTime || "06:00").split(":")
  const entryH = parseInt(hStr, 10) || 6
  const entryM = parseInt(mStr, 10) || 0
  const entryTotalMins = entryH * 60 + entryM
  const exitTotalMins = (entryTotalMins + workdayHours * 60) % 1440
  const exitH = Math.floor(exitTotalMins / 60)
  const exitM = exitTotalMins % 60
  return `${String(exitH).padStart(2, "0")}:${String(exitM).padStart(2, "0")}`
}

/**
 * Procesa registros de asistencia agrupados por día y colaborador para detectar y calcular horas extras.
 */
export function computeOvertimeForRecords(
  records: any[],
  schedulesMap: Map<string, { shift: string; expectedEntryTime: string; campusName?: string }> = new Map(),
  settings: OvertimeSettings = DEFAULT_OVERTIME_SETTINGS
): {
  pairs: OvertimePair[]
  staffSummaries: UserOvertimeSummary[]
  totalRawHours: number
  totalCountedHours: number
  totalStaffWithOvertime: number
} {
  // 1. Agrupar registros por colaborador y fecha
  const dayGroups = new Map<string, { entries: any[]; exits: any[] }>()

  for (const r of records) {
    const dateKey = limaDayKey(new Date(r.timestamp))
    const groupKey = `${r.userId}_${dateKey}`
    if (!dayGroups.has(groupKey)) {
      dayGroups.set(groupKey, { entries: [], exits: [] })
    }
    const g = dayGroups.get(groupKey)!
    if (r.type === "ENTRADA") {
      g.entries.push(r)
    } else if (r.type === "SALIDA") {
      g.exits.push(r)
    }
  }

  const pairs: OvertimePair[] = []
  const staffMap = new Map<string, UserOvertimeSummary>()

  for (const [groupKey, group] of dayGroups.entries()) {
    if (group.entries.length === 0 || group.exits.length === 0) continue

    const [userId, dateStr] = groupKey.split("_")

    // Ordenar entradas por timestamp asc (primera entrada) y salidas por timestamp desc (última salida)
    group.entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    group.exits.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    const firstEntry = group.entries[0]
    const lastExit = group.exits[0]

    const entryDate = new Date(firstEntry.timestamp)
    const exitDate = new Date(lastExit.timestamp)

    const entryMinutes = limaMinutesOfDay(entryDate)
    const exitMinutes = limaMinutesOfDay(exitDate)

    const user = firstEntry.user || lastExit.user || {}
    const role = user.role || "TECNICO"

    // Resolver turno y horario esperado
    const schedKey = `${userId}_${dateStr}`
    const sched = schedulesMap.get(schedKey)

    const userShift = (sched?.shift || user.defaultShift || Shift.MANANA) as Shift
    const def = DEFAULT_SHIFT_TIMES[userShift] || DEFAULT_SHIFT_TIMES.MANANA
    const expectedEntry = sched?.expectedEntryTime || def.entry || "06:00"

    const campusName = firstEntry.campus?.name || lastExit.campus?.name || sched?.campusName || user.campus?.name || "Campus Villa"

    const scheduledExit = calculateExpectedExitTime(expectedEntry, settings.workdayHours)
    const [schedExitH, schedExitM] = scheduledExit.split(":").map(Number)
    const scheduledExitMinutes = (isNaN(schedExitH) ? 15 : schedExitH) * 60 + (isNaN(schedExitM) ? 0 : schedExitM)

    // Diferencia entre salida real y salida programada
    let rawExtraMinutes = 0

    if (userShift === Shift.DESCANSO) {
      // Si trabajó en día de descanso, todos los minutos de la jornada son horas extras
      const diffMs = exitDate.getTime() - entryDate.getTime()
      rawExtraMinutes = Math.max(0, Math.floor(diffMs / (60 * 1000)))
    } else {
      // Diferencia respecto a la hora oficial de salida
      let diff = exitMinutes - scheduledExitMinutes
      // Manejo de cruce de medianoche (ej: salida 01:00 AM para turno noche)
      if (diff < -720) {
        diff += 1440
      } else if (diff > 720) {
        diff -= 1440
      }
      rawExtraMinutes = Math.max(0, diff)
    }

    // Comprobar umbral mínimo (ej: >= 60 minutos)
    const qualifies = rawExtraMinutes >= settings.minMinutes
    const countedExtraMinutes = qualifies ? rawExtraMinutes : 0

    let countedHours = 0
    if (qualifies) {
      if (settings.roundingMode === "HORAS_COMPLETAS") {
        countedHours = Math.floor(countedExtraMinutes / 60)
      } else {
        // Modo DECIMAL estándar (ej: 75m -> 1.25 hrs, 90m -> 1.5 hrs)
        countedHours = Math.round((countedExtraMinutes / 60) * 100) / 100
      }
    }

    const entryTimeStr = `${String(Math.floor(entryMinutes / 60)).padStart(2, "0")}:${String(entryMinutes % 60).padStart(2, "0")}`
    const exitTimeStr = `${String(Math.floor(exitMinutes / 60)).padStart(2, "0")}:${String(exitMinutes % 60).padStart(2, "0")}`

    const pair: OvertimePair = {
      date: dateStr,
      userId,
      userName: user.name || "Sin nombre",
      userDni: user.dni || "-",
      shift: userShift,
      campusName,
      entryTime: entryTimeStr,
      exitTime: exitTimeStr,
      scheduledExitTime: scheduledExit,
      rawExtraMinutes,
      countedExtraMinutes,
      countedHours,
      qualifies,
    }
    pairs.push(pair)

    // Acumular en resumen por colaborador
    if (!staffMap.has(userId)) {
      staffMap.set(userId, {
        userId,
        userName: user.name || "Sin nombre",
        userDni: user.dni || "-",
        role,
        shift: userShift,
        campusName,
        totalDaysWithOvertime: 0,
        totalRawExtraMinutes: 0,
        totalRawHours: 0,
        totalCountedExtraMinutes: 0,
        totalCountedHours: 0,
        formattedRawTime: "0 min",
        formattedCountedHours: "0 hrs",
      })
    }

    const staffSummary = staffMap.get(userId)!
    staffSummary.totalRawExtraMinutes += rawExtraMinutes
    staffSummary.totalRawHours = Math.round((staffSummary.totalRawExtraMinutes / 60) * 100) / 100
    staffSummary.formattedRawTime = formatMinutesToHoursAndMins(staffSummary.totalRawExtraMinutes)

    if (qualifies) {
      staffSummary.totalDaysWithOvertime++
      staffSummary.totalCountedExtraMinutes += countedExtraMinutes
      staffSummary.totalCountedHours = Math.round((staffSummary.totalCountedHours + countedHours) * 100) / 100
      staffSummary.formattedCountedHours = `${staffSummary.totalCountedHours} hrs`
    }
  }

  // Ordenar pares por fecha desc
  pairs.sort((a, b) => b.date.localeCompare(a.date))

  const staffSummaries = Array.from(staffMap.values()).sort(
    (a, b) => b.totalCountedHours - a.totalCountedHours
  )

  const totalRawHours = Math.round(staffSummaries.reduce((acc, s) => acc + s.totalRawHours, 0) * 100) / 100
  const totalCountedHours = Math.round(staffSummaries.reduce((acc, s) => acc + s.totalCountedHours, 0) * 100) / 100
  const totalStaffWithOvertime = staffSummaries.filter((s) => s.totalCountedHours > 0).length

  return {
    pairs,
    staffSummaries,
    totalRawHours,
    totalCountedHours,
    totalStaffWithOvertime,
  }
}
