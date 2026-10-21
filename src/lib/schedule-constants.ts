import { Shift } from "@prisma/client"

export type ScheduleItemInput = {
  id?: string
  userId?: string
  dni?: string
  date: string // "YYYY-MM-DD"
  campusId?: string
  campusName?: string
  shift: Shift
  expectedEntryTime?: string
  earlyEntryToleranceMinutes?: number
  gracePeriodMinutes?: number
  lateToleranceMinutes?: number
  notes?: string
}

// Horarios predeterminados por turno si no se especifican
export const DEFAULT_SHIFT_TIMES: Record<Shift, { entry: string; early: number; grace: number; late: number }> = {
  MANANA: { entry: "07:00", early: 15, grace: 10, late: 30 },
  INTERMEDIO: { entry: "11:00", early: 15, grace: 10, late: 30 },
  TARDE: { entry: "14:00", early: 15, grace: 10, late: 30 },
}
