// Tipos compartidos entre el servidor (cálculo) y el cliente (gráficos)

export type AnalyticsRange = 7 | 30 | 90

export type AnalyticsData = {
  range: { days: number; fromKey: string; toKey: string }
  campusId: string | null
  kpis: {
    total: number
    entradas: number
    salidas: number
    aTiempo: number
    tardanzas: number
    faltas: number
    excepciones: number
    punctualityRate: number // 0-100
    activeUsers: number
    prevTotal: number
    prevPunctualityRate: number
  }
  daily: { day: string; label: string; aTiempo: number; tardanza: number; falta: number; salidas: number; total: number }[]
  statusBreakdown: { key: "aTiempo" | "tardanza" | "falta" | "excepcion"; label: string; value: number }[]
  byCampus: { name: string; entradas: number; tardanzas: number; faltas: number }[]
  byCourse: { name: string; total: number }[]
  byHour: { hour: string; entradas: number; salidas: number }[]
  byRole: { role: string; label: string; total: number }[]
  topLate: { userId: string; name: string; dni: string; role: string; tardanzas: number; faltas: number }[]
  campuses: { id: string; name: string }[]
    registeredStaff: {
    total: number
    docentes: number
    tecnicos: number
    pacientes: number
  }
  overtime?: {
    totalRawHours: number
    totalCountedHours: number
    minMinutesThreshold: number
    staffWithOvertimeCount: number
    topOvertime: { userId: string; name: string; dni: string; role: string; countedHours: number; rawHours: number }[]
  }
}
