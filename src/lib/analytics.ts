import prisma from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import type { AnalyticsData } from "@/lib/analytics-types"
import { addDaysToKey, formatDayLabel, formatDayMonthLabel, limaDayKey, limaHour, startOfLimaDay } from "@/lib/timezone"
import { computeOvertimeForRecords, DEFAULT_OVERTIME_SETTINGS, type OvertimeSettings } from "@/lib/overtime"

const ROLE_LABELS: Record<string, string> = {
  DOCENTE: "Docentes",
  TECNICO: "Técnicos",
  PACIENTE_SIMULADO: "Pacientes Sim.",
  SUPER_ADMIN: "Super Admin",
  ADMIN_SECUNDARIO: "Coordinadores",
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0)

/**
 * Calcula todas las métricas del panel de analítica para un rango de días
 * (contados hacia atrás desde hoy, en hora de Lima) y opcionalmente una sede.
 */
export async function computeAnalytics({ days, campusId }: { days: number; campusId?: string | null }): Promise<AnalyticsData> {
  const todayKey = limaDayKey(new Date())
  const fromKey = addDaysToKey(todayKey, -(days - 1))
  const from = startOfLimaDay(fromKey)
  const to = startOfLimaDay(addDaysToKey(todayKey, 1))
  const prevFrom = startOfLimaDay(addDaysToKey(fromKey, -days))

  const campusFilter: Prisma.AttendanceRecordWhereInput = campusId ? { campusId } : {}

  const [records, prevGroups, campuses, allStaffCounts, rawSettings, techSchedules] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { timestamp: { gte: from, lt: to }, ...campusFilter },
      select: {
        timestamp: true,
        type: true,
        status: true,
        userId: true,
        campus: { select: { name: true } },
        course: { select: { name: true } },
        user: { select: { id: true, name: true, dni: true, role: true, defaultShift: true, campus: { select: { name: true } } } },
      },
      orderBy: { timestamp: "asc" },
    }),
    prisma.attendanceRecord.groupBy({
      by: ["type", "status"],
      where: { timestamp: { gte: prevFrom, lt: from }, ...campusFilter },
      _count: { _all: true },
    }),
    prisma.campus.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.groupBy({
      by: ["role"],
      where: { role: { in: ["DOCENTE", "TECNICO", "PACIENTE_SIMULADO"] } },
      _count: { _all: true },
    }),
    prisma.systemSetting.findMany({
      where: { key: { in: ["OVERTIME_MIN_MINUTES", "OVERTIME_ROUNDING_MODE", "OVERTIME_WORKDAY_HOURS"] } },
    }).catch(() => []),
    prisma.technicianSchedule.findMany({
      where: { date: { gte: fromKey, lte: todayKey } },
      include: { campus: { select: { name: true } } },
    }).catch(() => []),
  ])

  let staffDocentes = 0
  let staffTecnicos = 0
  let staffPacientes = 0
  for (const s of allStaffCounts) {
    if (s.role === "DOCENTE") staffDocentes = s._count._all
    else if (s.role === "TECNICO") staffTecnicos = s._count._all
    else if (s.role === "PACIENTE_SIMULADO") staffPacientes = s._count._all
  }
  const staffTotal = staffDocentes + staffTecnicos + staffPacientes

  // ---------- Serie diaria (inicializada con todos los días del rango) ----------
  const dailyMap = new Map<string, AnalyticsData["daily"][number]>()
  for (let i = 0; i < days; i++) {
    const key = addDaysToKey(fromKey, i)
    dailyMap.set(key, {
      day: key,
      label: days <= 7 ? formatDayLabel(key) : formatDayMonthLabel(key),
      aTiempo: 0,
      tardanza: 0,
      falta: 0,
      salidas: 0,
      total: 0,
    })
  }

  const hourMap = new Map<number, { entradas: number; salidas: number }>()
  const campusMap = new Map<string, { entradas: number; tardanzas: number; faltas: number }>()
  const courseMap = new Map<string, number>()
  const roleMap = new Map<string, number>()
  const lateMap = new Map<string, AnalyticsData["topLate"][number]>()
  const activeUsers = new Set<string>()

  let entradas = 0, salidas = 0, aTiempo = 0, tardanzas = 0, faltas = 0, excepciones = 0

  for (const r of records) {
    activeUsers.add(r.userId)
    const dayEntry = dailyMap.get(limaDayKey(r.timestamp))
    const hour = limaHour(r.timestamp)
    const hourEntry = hourMap.get(hour) ?? { entradas: 0, salidas: 0 }
    roleMap.set(r.user.role, (roleMap.get(r.user.role) ?? 0) + 1)

    if (r.course?.name) courseMap.set(r.course.name, (courseMap.get(r.course.name) ?? 0) + 1)

    if (r.type === "SALIDA") {
      salidas++
      hourEntry.salidas++
      if (dayEntry) { dayEntry.salidas++; dayEntry.total++ }
      hourMap.set(hour, hourEntry)
      continue
    }

    // ENTRADA
    entradas++
    hourEntry.entradas++
    hourMap.set(hour, hourEntry)
    if (dayEntry) dayEntry.total++

    const campusName = r.campus?.name ?? "Sin sede"
    const campusEntry = campusMap.get(campusName) ?? { entradas: 0, tardanzas: 0, faltas: 0 }
    campusEntry.entradas++

    switch (r.status) {
      case "A_TIEMPO":
        aTiempo++
        if (dayEntry) dayEntry.aTiempo++
        break
      case "TARDANZA":
        tardanzas++
        campusEntry.tardanzas++
        if (dayEntry) dayEntry.tardanza++
        break
      case "FALTA":
        faltas++
        campusEntry.faltas++
        if (dayEntry) dayEntry.falta++
        break
      case "EXCEPCION":
        excepciones++
        if (dayEntry) dayEntry.aTiempo++
        break
    }
    campusMap.set(campusName, campusEntry)

    if (r.status === "TARDANZA" || r.status === "FALTA") {
      const late = lateMap.get(r.userId) ?? { userId: r.userId, name: r.user.name, dni: r.user.dni, role: r.user.role, tardanzas: 0, faltas: 0 }
      if (r.status === "TARDANZA") late.tardanzas++
      else late.faltas++
      lateMap.set(r.userId, late)
    }
  }

  // ---------- Periodo anterior (para indicadores de tendencia) ----------
  let prevTotal = 0, prevEntradas = 0, prevATiempo = 0
  for (const g of prevGroups) {
    prevTotal += g._count._all
    if (g.type === "ENTRADA") {
      prevEntradas += g._count._all
      if (g.status === "A_TIEMPO" || g.status === "EXCEPCION") prevATiempo += g._count._all
    }
  }

  // ---------- Horas pico (recorte al rango con actividad) ----------
  const activeHours = [...hourMap.keys()]
  const minHour = Math.min(7, ...activeHours)
  const maxHour = Math.max(20, ...activeHours)
  const byHour: AnalyticsData["byHour"] = []
  for (let h = minHour; h <= maxHour; h++) {
    const e = hourMap.get(h) ?? { entradas: 0, salidas: 0 }
    byHour.push({ hour: `${String(h).padStart(2, "0")}:00`, ...e })
  }

  // ---------- Control de Horas Extras ----------
  const settingsMap = new Map<string, string>()
  for (const s of (rawSettings as any[]) || []) {
    settingsMap.set(s.key, s.value)
  }
  const overtimeSettings: OvertimeSettings = {
    minMinutes: settingsMap.has("OVERTIME_MIN_MINUTES")
      ? parseInt(settingsMap.get("OVERTIME_MIN_MINUTES")!, 10) || DEFAULT_OVERTIME_SETTINGS.minMinutes
      : DEFAULT_OVERTIME_SETTINGS.minMinutes,
    roundingMode: (settingsMap.get("OVERTIME_ROUNDING_MODE") as any) || DEFAULT_OVERTIME_SETTINGS.roundingMode,
    workdayHours: settingsMap.has("OVERTIME_WORKDAY_HOURS")
      ? parseInt(settingsMap.get("OVERTIME_WORKDAY_HOURS")!, 10) || DEFAULT_OVERTIME_SETTINGS.workdayHours
      : DEFAULT_OVERTIME_SETTINGS.workdayHours,
  }

  const schedMap = new Map<string, { shift: string; expectedEntryTime: string; campusName?: string }>()
  for (const s of (techSchedules as any[]) || []) {
    const key = `${s.userId}_${s.date}`
    schedMap.set(key, {
      shift: s.shift,
      expectedEntryTime: s.expectedEntryTime,
      campusName: s.campus?.name,
    })
  }

  const overtimeResult = computeOvertimeForRecords(records, schedMap, overtimeSettings)

  return {
    range: { days, fromKey, toKey: todayKey },
    campusId: campusId ?? null,
    kpis: {
      total: records.length,
      entradas,
      salidas,
      aTiempo,
      tardanzas,
      faltas,
      excepciones,
      punctualityRate: pct(aTiempo + excepciones, entradas),
      activeUsers: activeUsers.size,
      prevTotal,
      prevPunctualityRate: pct(prevATiempo, prevEntradas),
    },
    daily: [...dailyMap.values()],
    statusBreakdown: [
      { key: "aTiempo", label: "A tiempo", value: aTiempo },
      { key: "tardanza", label: "Tardanza", value: tardanzas },
      { key: "falta", label: "Falta", value: faltas },
      { key: "excepcion", label: "Excepción", value: excepciones },
    ],
    byCampus: [...campusMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.entradas - a.entradas),
    byCourse: [...courseMap.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8),
    byHour,
    byRole: ["DOCENTE", "TECNICO", "PACIENTE_SIMULADO"].map((role) => ({
      role,
      label: ROLE_LABELS[role],
      total: roleMap.get(role) ?? 0,
    })),
    topLate: [...lateMap.values()]
      .sort((a, b) => b.tardanzas + b.faltas * 2 - (a.tardanzas + a.faltas * 2))
      .slice(0, 5),
    campuses,
    registeredStaff: {
      total: staffTotal,
      docentes: staffDocentes,
      tecnicos: staffTecnicos,
      pacientes: staffPacientes,
    },
    overtime: {
      totalRawHours: overtimeResult.totalRawHours,
      totalCountedHours: overtimeResult.totalCountedHours,
      minMinutesThreshold: overtimeSettings.minMinutes,
      staffWithOvertimeCount: overtimeResult.totalStaffWithOvertime,
      topOvertime: overtimeResult.staffSummaries.slice(0, 5).map((s) => ({
        userId: s.userId,
        name: s.userName,
        dni: s.userDni,
        role: s.role,
        countedHours: s.totalCountedHours,
        rawHours: s.totalRawHours,
      })),
    },
  }
}
