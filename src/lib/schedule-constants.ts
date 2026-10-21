import { Shift } from "@prisma/client"

export type ScheduleItemInput = {
  id?: string
  userId?: string
  dni?: string
  name?: string
  date: string // "YYYY-MM-DD"
  campusId?: string
  campusName?: string
  shift: Shift
  expectedEntryTime?: string
  earlyEntryToleranceMinutes?: number
  gracePeriodMinutes?: number
  lateToleranceMinutes?: number
  enableEarlyTolerance?: boolean
  enableLateTolerance?: boolean
  notes?: string
}

// Horarios y tolerancias predeterminados por turno para técnicos
// Mañana: 6 AM - 3 PM (Entrada 06:00)
// Tarde: 1 PM - 10 PM (Entrada 13:00)
// Intermedio L-V: 9 AM - 6 PM (Entrada 09:00)
// Intermedio Sábado: 8 AM - 5 PM (Entrada 08:00)
// Intermedio Domingo: 10 AM - 7 PM (Entrada 10:00)
export const DEFAULT_SHIFT_TIMES: Record<Shift, { entry: string; early: number; grace: number; late: number; label: string; timeRange: string }> = {
  MANANA: { entry: "06:00", early: 15, grace: 10, late: 30, label: "Mañana", timeRange: "6:00 AM — 3:00 PM" },
  INTERMEDIO: { entry: "09:00", early: 15, grace: 10, late: 30, label: "Intermedio (L-V)", timeRange: "9:00 AM — 6:00 PM" },
  TARDE: { entry: "13:00", early: 15, grace: 10, late: 30, label: "Tarde", timeRange: "1:00 PM — 10:00 PM" },
  NOCHE: { entry: "21:00", early: 15, grace: 10, late: 30, label: "Noche / Guardia", timeRange: "9:00 PM — 6:00 AM" },
  DESCANSO: { entry: "00:00", early: 0, grace: 0, late: 0, label: "Descanso / Libre", timeRange: "Día libre programado" },
}

export type ShiftPreset = {
  id: string
  shift: Shift
  name: string
  scheduleText: string
  entry: string
  daysOfWeek?: string
  early: number
  grace: number
  late: number
}

export const TECHNICIAN_SHIFT_PRESETS: ShiftPreset[] = [
  {
    id: "MANANA",
    shift: Shift.MANANA,
    name: "Mañana (Todos los días)",
    scheduleText: "6:00 AM — 3:00 PM",
    entry: "06:00",
    daysOfWeek: "1,2,3,4,5,6,0",
    early: 15,
    grace: 10,
    late: 30,
  },
  {
    id: "INTERMEDIO_LV",
    shift: Shift.INTERMEDIO,
    name: "Intermedio L-V y Domingo",
    scheduleText: "9:00 AM — 6:00 PM",
    entry: "09:00",
    daysOfWeek: "1,2,3,4,5,0",
    early: 15,
    grace: 10,
    late: 30,
  },
  {
    id: "INTERMEDIO_SAB",
    shift: Shift.INTERMEDIO,
    name: "Intermedio Sábado",
    scheduleText: "8:00 AM — 5:00 PM",
    entry: "08:00",
    daysOfWeek: "6",
    early: 15,
    grace: 10,
    late: 30,
  },
  {
    id: "INTERMEDIO_DOM",
    shift: Shift.INTERMEDIO,
    name: "Intermedio Domingo Tardío",
    scheduleText: "10:00 AM — 7:00 PM",
    entry: "10:00",
    daysOfWeek: "0",
    early: 15,
    grace: 10,
    late: 30,
  },
  {
    id: "TARDE",
    shift: Shift.TARDE,
    name: "Tarde (Todos los días)",
    scheduleText: "1:00 PM — 10:00 PM",
    entry: "13:00",
    daysOfWeek: "1,2,3,4,5,6,0",
    early: 15,
    grace: 10,
    late: 30,
  },
  {
    id: "NOCHE",
    shift: Shift.NOCHE,
    name: "Noche / Guardia",
    scheduleText: "9:00 PM — 6:00 AM",
    entry: "21:00",
    daysOfWeek: "1,2,3,4,5,6,0",
    early: 15,
    grace: 10,
    late: 30,
  },
]
