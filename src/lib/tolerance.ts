import { RecordStatus, Role } from "@prisma/client"
import { limaMinutesOfDay } from "@/lib/timezone"

export interface ToleranceRuleEvalInput {
  expectedEntryTime: string
  earlyEntryToleranceMinutes: number
  gracePeriodMinutes: number
  lateToleranceMinutes: number
  shiftName?: string
  enableEarlyTolerance?: boolean
  enableLateTolerance?: boolean
}

export function findApplicableToleranceRule(
  rules: any[],
  campusId?: string,
  role?: Role
) {
  if (!rules || rules.length === 0) return null
  return (
    (campusId && role ? rules.find((r) => r.campusId === campusId && r.role === role) : null) ||
    (campusId ? rules.find((r) => r.campusId === campusId && !r.role) : null) ||
    (role ? rules.find((r) => !r.campusId && r.role === role) : null) ||
    rules.find((r) => !r.campusId && !r.role) ||
    null
  )
}

export function getShiftDiffInMinutes(
  recordTime: Date,
  expectedEntryTime: string
): { diffInMinutes: number; recordMinutes: number; expectedMinutes: number } {
  const [expectedHour, expectedMinute] = expectedEntryTime.split(":").map(Number)
  const expectedMinutes =
    (isNaN(expectedHour) ? 8 : expectedHour) * 60 + (isNaN(expectedMinute) ? 0 : expectedMinute)
  const recordMinutes = limaMinutesOfDay(recordTime)

  // Diferencia horaria considerando el ciclo de 24 horas (720 min = 12 horas)
  let diffInMinutes = recordMinutes - expectedMinutes
  if (diffInMinutes < -720) {
    diffInMinutes += 1440
  } else if (diffInMinutes > 720) {
    diffInMinutes -= 1440
  }

  return { diffInMinutes, recordMinutes, expectedMinutes }
}

export function validateEarlyEntry(
  recordTime: Date,
  rule: {
    expectedEntryTime: string
    earlyEntryToleranceMinutes: number
    lateToleranceMinutes?: number
    enableEarlyTolerance?: boolean
  }
): { allowed: boolean; message?: string } {
  // Si la restricción de hora anticipada de ingreso está desactivada: permitir el ingreso libremente
  if (rule.enableEarlyTolerance === false) {
    return { allowed: true }
  }

  const { diffInMinutes, expectedMinutes } = getShiftDiffInMinutes(
    recordTime,
    rule.expectedEntryTime
  )
  const earlyAllowed = rule.earlyEntryToleranceMinutes ?? 15
  // Ventana máxima permitida para registrar entrada: 240 minutos (4 horas) después de la hora oficial
  const maxLateAllowed = Math.max(rule.lateToleranceMinutes ?? 30, 240)

  // 1. Si intenta marcar antes de la ventana de anticipación permitida (ej: la noche anterior o 1 hora antes)
  if (diffInMinutes < -earlyAllowed) {
    const allowedStartMinutes = (expectedMinutes - earlyAllowed + 1440) % 1440
    const startHour = Math.floor(allowedStartMinutes / 60)
    const startMinute = allowedStartMinutes % 60
    const startPeriod = startHour >= 12 ? "PM" : "AM"
    const displayH = startHour % 12 === 0 ? 12 : startHour % 12
    const allowedStartTimeStr = `${String(displayH).padStart(2, "0")}:${String(startMinute).padStart(2, "0")} ${startPeriod}`

    return {
      allowed: false,
      message: `No se permite marcar fuera de horario. Su turno oficial es a las ${rule.expectedEntryTime}. Podrá registrar su entrada a partir de las ${allowedStartTimeStr} (máximo ${earlyAllowed} minutos antes).`,
    }
  }

  // 2. Si intenta marcar como "Entrada" muchas horas después de haber concluido el inicio de su turno
  if (diffInMinutes > maxLateAllowed) {
    return {
      allowed: false,
      message: `Su horario de entrada (${rule.expectedEntryTime}) ya venció hace más de 4 horas. No corresponde registrar entrada en este momento.`,
    }
  }

  return { allowed: true }
}

export function calculateStatusFromRule(
  recordTime: Date,
  rule: {
    expectedEntryTime: string
    gracePeriodMinutes: number
    lateToleranceMinutes: number
    enableLateTolerance?: boolean
  }
): RecordStatus {
  // Si el control de tardanzas está desactivado: todas las entradas marcan A_TIEMPO sin penalización
  if (rule.enableLateTolerance === false) {
    return RecordStatus.A_TIEMPO
  }

  const { diffInMinutes } = getShiftDiffInMinutes(recordTime, rule.expectedEntryTime)

  if (diffInMinutes <= rule.gracePeriodMinutes) {
    return RecordStatus.A_TIEMPO
  } else if (diffInMinutes <= rule.lateToleranceMinutes) {
    return RecordStatus.TARDANZA
  } else {
    return RecordStatus.FALTA
  }
}

