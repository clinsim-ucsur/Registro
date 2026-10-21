// ------------------------------------------------------------------
// Utilidades de zona horaria (America/Lima, UTC-5, sin horario de verano)
// ------------------------------------------------------------------
// Vercel ejecuta el servidor en UTC, por lo que NUNCA debemos usar
// getHours()/setHours() directamente para lógica de negocio.
// Todas las agrupaciones por día/hora se hacen con estas funciones.

export const LIMA_TZ = "America/Lima"
const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

/** Devuelve un Date "desplazado" cuyos getters UTC representan la hora de Lima. */
export function shiftToLima(date: Date): Date {
  return new Date(date.getTime() + LIMA_OFFSET_MS)
}

/** Día de la semana en Lima: 0 = Domingo, 1 = Lunes, ..., 6 = Sábado */
export function limaDayOfWeek(date: Date): number {
  return shiftToLima(date).getUTCDay()
}

/** Clave de día en Lima: "YYYY-MM-DD" */
export function limaDayKey(date: Date): string {
  return shiftToLima(date).toISOString().slice(0, 10)
}

/** Hora (0-23) en Lima */
export function limaHour(date: Date): number {
  return shiftToLima(date).getUTCHours()
}

/** Minutos transcurridos desde la medianoche en Lima */
export function limaMinutesOfDay(date: Date): number {
  const d = shiftToLima(date)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/** Instante UTC que corresponde a las 00:00 de Lima del día indicado */
export function startOfLimaDay(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00-05:00`)
}

/** Suma (o resta) días a una clave "YYYY-MM-DD" */
export function addDaysToKey(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Diferencia en días entre dos claves (to - from) */
export function diffDayKeys(fromKey: string, toKey: string): number {
  const a = new Date(`${fromKey}T12:00:00Z`).getTime()
  const b = new Date(`${toKey}T12:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** Etiqueta corta: "Lun 13" */
export function formatDayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}`
}

/** Etiqueta con mes: "13 Oct" */
export function formatDayMonthLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`)
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`
}

/** Valida formato "YYYY-MM-DD" */
export function isValidDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(new Date(`${value}T12:00:00Z`).getTime())
}

/** Formatea fecha y hora en Lima (para reportes) */
export function formatLimaDate(date: Date): string {
  return date.toLocaleDateString("es-PE", { timeZone: LIMA_TZ, day: "2-digit", month: "2-digit", year: "numeric" })
}

export function formatLimaTime(date: Date): string {
  return date.toLocaleTimeString("es-PE", { timeZone: LIMA_TZ, hour12: true, hour: "2-digit", minute: "2-digit" })
}
