import { Role } from "@prisma/client"

const API_1_JSON_URL =
  "https://script.google.com/macros/s/AKfycbzxGm4b1pt_Fnr7Emnm5DMgUy0AMPRFE_1Q3pOPrx0qSgJomt9a5SdjWy9KetL7xI50cg/exec"
const API_2_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1m__5uf7YckFoptbrQUHLi1OH7AqRto2s9jQknmEDzl0/export?format=csv"

export interface RawProgramSession {
  Piso: string
  Ambiente: string
  "Sesión": string
  "Hora Inicio": string
  "Hora Fin": string
  "Docente Líder": string
  "Docentes Colaboradores": string
  "Pacientes Estandarizados": string
}

export interface NormalizedProgramSession {
  piso: string
  ambiente: string
  sesion: string
  courseName: string
  campusName: string
  horaInicio: string // "HH:mm"
  horaFin: string // "HH:mm"
  startMinutes: number
  endMinutes: number
  docenteLider: string
  docentesColaboradores: string
  pacientesEstandarizados: string
}

export interface ProgramSessionItem {
  moduleNumber: number // 1, 2, 3...
  horaInicio: string // "HH:mm"
  horaFin: string // "HH:mm"
  startMinutes: number
  endMinutes: number
  ambiente: string
  piso: string
  sesion: string
  courseName: string
  campusName: string
}

export type ModuleAttendanceStatus = "PENDIENTE" | "EN_CURSO" | "COMPLETADO"

export interface ResolvedModuleStatus extends ProgramSessionItem {
  status: ModuleAttendanceStatus
  entryTimestamp?: string
  exitTimestamp?: string
}

export interface TodayAttendanceRecordLite {
  type: "ENTRADA" | "SALIDA"
  timestamp: string
  courseName?: string | null
}

export interface UserModulesResolution {
  modules: ResolvedModuleStatus[]
  activeModuleIndex: number
  activeModule: ResolvedModuleStatus | null
  nextModule: ResolvedModuleStatus | null
  completedModuleBeforeActive: ResolvedModuleStatus | null
  nextAction: "ENTRADA" | "SALIDA"
  allCompleted: boolean
  shouldTriggerRotationAlert: boolean
  rotationAlertReason: "MODULE_TIME_ENDED" | "READY_FOR_NEXT_MODULE" | null
}

export interface UserDailyProgramSummary {
  found: boolean
  matchedRoleInSession?: "DOCENTE_LIDER" | "DOCENTE_COLABORADOR" | "PACIENTE_ESTANDARIZADO"
  entryTime: string // Hora Inicio de la programación más temprana ("HH:mm")
  exitTime: string // Hora Fin de la última programación del día ("HH:mm")
  ambiente: string // Ambiente de la programación más temprana (sin código)
  piso: string // Piso de la programación más temprana
  sesion: string // Sesión de la programación más temprana
  courseName: string // Curso oficial mapeado de la programación más temprana
  campusName: string // Sede detectada (ej. "Campus Villa")
  totalSessions: number
  sessions: ProgramSessionItem[]
}

// Caché en memoria con Stale-While-Revalidate para respuesta instantánea (0ms cuando está caliente)
let cachedSessions: {
  data: NormalizedProgramSession[]
  expiresAt: number
} | null = null
let inflightRefresh: Promise<NormalizedProgramSession[]> | null = null

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutos fresco, luego refresca en segundo plano sin bloquear

/**
 * Normaliza una cadena de hora (ej. "7:00", "08:40", "16:10") a formato "HH:mm" y minutos del día.
 */
export function parseTimeString(raw: string): { formatted: string; minutes: number } | null {
  if (!raw) return null
  const clean = String(raw).trim()
  const match = clean.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null
  return {
    formatted: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    minutes: h * 60 + m,
  }
}

/**
 * Mapea el nombre de la sesión del Excel/JSON al catálogo oficial de Cursos del sistema.
 */
export function mapSessionToCourseName(sesionRaw: string): string {
  const s = (sesionRaw || "").trim()
  const upper = s.toUpperCase()

  if (upper.includes("MED_SBS") || upper.includes("SBS") || upper.includes("SEMIOLOG")) {
    return "Semiología Basada en Simulación (SBS)"
  }
  if (upper.includes("[SCI]") || upper.includes("SCI") || upper.includes("SIMULACIÓN CLÍNICA INTEGRADA")) {
    return "Simulación Clínica Integrada (SCI)"
  }
  if (upper.includes("SIMQX") || upper.includes("QUIRÚRGICA") || upper.includes("QUIRURGICA")) {
    return "Simulación Quirúrgica"
  }
  if (upper.includes("SIMGO") || upper.includes("SIMULACIÓN GINECOLÓGICA") || upper.includes("SIMULACION GINECOLOGICA")) {
    return "Simulación Ginecológica"
  }
  if (upper.includes("SIMPED") || upper.includes("SIMULACIÓN PEDIÁTRICA") || upper.includes("SIMULACION PEDIATRICA")) {
    return "Simulación Pediátrica"
  }
  if (upper.includes("EXT CIRG") || upper.includes("EXT CIR") || upper.includes("EXTERNADO DE CIRUG")) {
    return "Externado de Cirugía"
  }
  if (upper.includes("EXT MED") || upper.includes("EXTERNADO DE MEDICINA")) {
    return "Externado de Medicina"
  }
  if (upper.includes("EXT PED") || upper.includes("EXTERNADO DE PEDIATR")) {
    return "Externado de Pediatría"
  }
  if (upper.includes("EXT GYO") || upper.includes("EXT G&O") || upper.includes("EXTERNADO DE GINECOLOG")) {
    return "Externado de Ginecología"
  }
  if (upper.includes("MED. LEGAL") || upper.includes("MEDICINA LEGAL")) {
    return "Medicina Legal"
  }
  if (upper.includes("ECOGRAF")) {
    return "Ecografía"
  }
  if (upper.includes("PRIMEROS AUXILIOS")) {
    return "Primeros Auxilios"
  }
  if (upper.includes("PRE INTERNADO CIRUG") || upper.includes("PREINTERNADO CIRUG")) {
    return "Pre Internado Cirugía"
  }
  if (upper.includes("PRE INTERNADO MEDICINA") || upper.includes("PREINTERNADO MEDICINA")) {
    return "Pre internado Medicina"
  }
  if (upper.includes("PRE INTERNADO GINECOLOG") || upper.includes("PREINTERNADO GINECOLOG")) {
    return "Pre Internado Ginecologia"
  }

  return s || "Otros"
}

/**
 * Limpia el código técnico del ambiente y devuelve solo el nombre después de ":"
 * Ejemplo: "SL02TA21: CONSULTORIO 1 - L 107" -> "CONSULTORIO 1 - L 107"
 */
export function formatAmbienteName(rawAmbiente: string): string {
  const clean = (rawAmbiente || "").trim()
  const colonIdx = clean.indexOf(":")
  if (colonIdx !== -1) {
    return clean.slice(colonIdx + 1).trim()
  }
  return clean
}

/**
 * Determina la sede según el código de ambiente o piso, con respaldo en Campus Villa.
 */
export function resolveCampusFromAmbiente(ambiente: string, piso: string, fallbackCampus?: string | null): string {
  const combined = `${ambiente} ${piso}`.toUpperCase()
  if (combined.includes("NORTE")) return "Campus Norte"
  if (combined.includes("ARAMBURU") || combined.includes("ARAMBURÚ")) return "Campus Aramburú"
  if (combined.includes("ATE")) return "Campus Ate"
  if (combined.includes("SL02") || combined.includes("VILLA")) return "Campus Villa"
  return fallbackCampus || "Campus Villa"
}

/**
 * Parsea una línea CSV respetando comillas.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function normalizeRawSessions(rawList: RawProgramSession[]): NormalizedProgramSession[] {
  const normalized: NormalizedProgramSession[] = []
  for (const item of rawList) {
    const start = parseTimeString(item["Hora Inicio"])
    const end = parseTimeString(item["Hora Fin"])
    if (!start || !end) continue

    const piso = (item.Piso || "").trim()
    const rawAmbiente = (item.Ambiente || "").trim()
    const ambiente = formatAmbienteName(rawAmbiente)
    const sesion = (item["Sesión"] || "").trim()

    normalized.push({
      piso,
      ambiente,
      sesion,
      courseName: mapSessionToCourseName(sesion),
      campusName: resolveCampusFromAmbiente(rawAmbiente, piso),
      horaInicio: start.formatted,
      horaFin: end.formatted,
      startMinutes: start.minutes,
      endMinutes: end.minutes,
      docenteLider: (item["Docente Líder"] || "").trim(),
      docentesColaboradores: (item["Docentes Colaboradores"] || "").trim(),
      pacientesEstandarizados: (item["Pacientes Estandarizados"] || "").trim(),
    })
  }
  return normalized
}

async function fetchFromApi2Csv(): Promise<NormalizedProgramSession[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(API_2_CSV_URL, {
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const csvText = await res.text()
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0)
    if (lines.length <= 1) throw new Error("CSV vacío")
    const rawList: RawProgramSession[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      if (cols.length >= 8) {
        rawList.push({
          Piso: cols[0],
          Ambiente: cols[1],
          "Sesión": cols[2],
          "Hora Inicio": cols[3],
          "Hora Fin": cols[4],
          "Docente Líder": cols[5],
          "Docentes Colaboradores": cols[6],
          "Pacientes Estandarizados": cols[7],
        })
      }
    }
    const parsed = normalizeRawSessions(rawList)
    if (parsed.length === 0) throw new Error("Sin sesiones válidas en CSV")
    return parsed
  } finally {
    clearTimeout(timer)
  }
}

async function fetchFromApi1Json(): Promise<NormalizedProgramSession[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(API_1_JSON_URL, {
      signal: controller.signal,
      cache: "no-store",
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (!json || !Array.isArray(json.sesiones)) throw new Error("JSON inválido")
    const parsed = normalizeRawSessions(json.sesiones)
    if (parsed.length === 0) throw new Error("Sin sesiones válidas en JSON")
    return parsed
  } finally {
    clearTimeout(timer)
  }
}

async function refreshDailyProgramCache(): Promise<NormalizedProgramSession[]> {
  if (inflightRefresh) return inflightRefresh
  inflightRefresh = (async () => {
    try {
      // Competencia en paralelo: responde el que llegue más rápido (API 2 CSV suele responder 3x más rápido que Apps Script)
      const fastest = await Promise.any([fetchFromApi2Csv(), fetchFromApi1Json()])
      cachedSessions = {
        data: fastest,
        expiresAt: Date.now() + CACHE_TTL_MS,
      }
      return fastest
    } catch (err) {
      console.warn("[daily-program-api] No se pudo actualizar desde API 1 / API 2:", err)
      return cachedSessions ? cachedSessions.data : []
    } finally {
      inflightRefresh = null
    }
  })()
  return inflightRefresh
}

/**
 * Obtiene las sesiones programadas del día de forma ultra-rápida:
 * - Si hay datos en caché (frescos o ligeramente vencidos), responde en 0ms y refresca en segundo plano.
 * - Si es la primera carga en frío, compite en paralelo entre API 2 (CSV rápido) y API 1 (JSON).
 */
export async function fetchDailyProgramSessions(): Promise<NormalizedProgramSession[]> {
  const now = Date.now()
  if (cachedSessions) {
    if (cachedSessions.expiresAt <= now && !inflightRefresh) {
      // Stale-while-revalidate: refrescar en segundo plano sin hacer esperar al usuario
      void refreshDailyProgramCache()
    }
    return cachedSessions.data
  }
  return refreshDailyProgramCache()
}

// ------------------------------------------------------------------
// ALGORITMO DE COINCIDENCIA DE NOMBRES (BD <-> EXCEL/JSON)
// ------------------------------------------------------------------
const STOP_WORDS = new Set(["de", "del", "la", "las", "los", "el", "y", "ninguno", "ninguna"])

function normalizeNameTokens(name: string): string[] {
  if (!name) return []
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function tokensAreEquivalent(t1: string, t2: string): boolean {
  if (t1 === t2) return true
  if (t1.length >= 4 && t2.length >= 4 && levenshteinDistance(t1, t2) <= 1) return true
  return false
}

/**
 * Evalúa si dos nombres completos corresponden a la misma persona,
 * soportando formatos "APELLIDOS, NOMBRES" vs "NOMBRES APELLIDOS",
 * nombres parciales (ej. "BRISSA MOLINA" vs "Brissa Molina Martinez")
 * y pequeñas variaciones tipográficas (ej. "Mackee" vs "Mckee").
 */
export function isSamePersonName(nameA: string, nameB: string): boolean {
  if (!nameA || !nameB) return false
  const cleanA = nameA.trim()
  const cleanB = nameB.trim()
  if (cleanA.toLowerCase() === "ninguno" || cleanB.toLowerCase() === "ninguno") return false

  const tokA = normalizeNameTokens(cleanA)
  const tokB = normalizeNameTokens(cleanB)
  if (tokA.length === 0 || tokB.length === 0) return false

  const shorter = tokA.length <= tokB.length ? tokA : tokB
  const longer = tokA.length <= tokB.length ? tokB : tokA

  const usedIndices = new Set<number>()
  let matchedCount = 0

  for (const sToken of shorter) {
    const idx = longer.findIndex((lToken, i) => !usedIndices.has(i) && tokensAreEquivalent(sToken, lToken))
    if (idx !== -1) {
      usedIndices.add(idx)
      matchedCount++
    }
  }

  if (shorter.length <= 2) {
    return matchedCount === shorter.length
  }
  if (shorter.length === 3) {
    return matchedCount === 3
  }
  return matchedCount >= 3
}

/**
 * Verifica si el nombre del usuario coincide con un campo de la sesión
 * (que puede contener un nombre o varios separados por "/", ";", "\n").
 */
function matchesSessionField(userName: string, fieldValue: string): boolean {
  if (!fieldValue || fieldValue.trim().toLowerCase() === "ninguno") return false
  if (isSamePersonName(userName, fieldValue)) return true

  const parts = fieldValue.split(/[;/\n]+/).map((p) => p.trim()).filter(Boolean)
  if (parts.length > 1) {
    return parts.some((part) => isSamePersonName(userName, part))
  }
  return false
}

export function matchDailyProgramFromSessions(
  allSessions: NormalizedProgramSession[],
  userName: string,
  userRole: Role,
  fallbackCampusName?: string | null
): UserDailyProgramSummary {
  const matchedSessions: {
    session: NormalizedProgramSession
    roleInSession: "DOCENTE_LIDER" | "DOCENTE_COLABORADOR" | "PACIENTE_ESTANDARIZADO"
  }[] = []

  for (const s of allSessions) {
    if (userRole === Role.PACIENTE_SIMULADO) {
      if (matchesSessionField(userName, s.pacientesEstandarizados)) {
        matchedSessions.push({ session: s, roleInSession: "PACIENTE_ESTANDARIZADO" })
      }
    } else if (userRole === Role.DOCENTE || userRole === Role.SUPER_ADMIN || userRole === Role.ADMIN_SECUNDARIO) {
      if (matchesSessionField(userName, s.docenteLider)) {
        matchedSessions.push({ session: s, roleInSession: "DOCENTE_LIDER" })
      } else if (matchesSessionField(userName, s.docentesColaboradores)) {
        matchedSessions.push({ session: s, roleInSession: "DOCENTE_COLABORADOR" })
      }
    }
  }

  if (matchedSessions.length === 0) {
    return {
      found: false,
      entryTime: "",
      exitTime: "",
      ambiente: "",
      piso: "",
      sesion: "",
      courseName: "",
      campusName: fallbackCampusName || "Campus Villa",
      totalSessions: 0,
      sessions: [],
    }
  }

  // Ordenar por hora de inicio ascendente (y luego por hora de fin) para obtener cada módulo en orden cronológico
  const byEarliestStart = [...matchedSessions].sort(
    (a, b) => a.session.startMinutes - b.session.startMinutes || a.session.endMinutes - b.session.endMinutes
  )
  // Ordenar por hora de fin descendente para obtener la última programación del día (fin de turno)
  const byLatestEnd = [...matchedSessions].sort(
    (a, b) => b.session.endMinutes - a.session.endMinutes
  )

  // Deduplicar filas que tengan exactamente el mismo bloque horario y ambiente
  const seenKeys = new Set<string>()
  const uniqueOrdered: typeof byEarliestStart = []
  for (const item of byEarliestStart) {
    const key = `${item.session.horaInicio}|${item.session.horaFin}|${item.session.ambiente.trim().toLowerCase()}`
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      uniqueOrdered.push(item)
    }
  }

  const earliest = uniqueOrdered[0] || byEarliestStart[0]
  const latest = byLatestEnd[0]

  const rawMappedSessions: ProgramSessionItem[] = uniqueOrdered.map((m, idx) => ({
    moduleNumber: idx + 1,
    horaInicio: m.session.horaInicio,
    horaFin: m.session.horaFin,
    startMinutes: m.session.startMinutes,
    endMinutes: m.session.endMinutes,
    ambiente: m.session.ambiente,
    piso: m.session.piso,
    sesion: m.session.sesion,
    courseName: m.session.courseName,
    campusName: m.session.campusName || fallbackCampusName || "Campus Villa",
  }))

  // Si es PACIENTE_SIMULADO y tiene varios módulos seguidos (de corrido) del mismo tema y en el mismo salón,
  // se unifican en un solo bloque continuo para no interrumpirlo con alarmas intermedias mientras no cambie de tema/salón.
  // Si es DOCENTE, cada módulo se mantiene individual para que la alarma le avise cada vez que termina la hora con su sección de alumnos.
  const mappedSessions =
    userRole === Role.PACIENTE_SIMULADO
      ? mergeContinuousSessionsForPatient(rawMappedSessions)
      : rawMappedSessions

  return {
    found: true,
    matchedRoleInSession: earliest.roleInSession,
    entryTime: earliest.session.horaInicio,
    exitTime: latest.session.horaFin,
    ambiente: earliest.session.ambiente,
    piso: earliest.session.piso,
    sesion: earliest.session.sesion,
    courseName: earliest.session.courseName,
    campusName: earliest.session.campusName || fallbackCampusName || "Campus Villa",
    totalSessions: mappedSessions.length,
    sessions: mappedSessions,
  }
}

/**
 * Une bloques horarios consecutivos (de corrido) para Pacientes Simulados cuando permanecen
 * en el mismo salón (ambiente) y con el mismo tema (sesión/curso). Solo separa bloques cuando
 * el paciente debe cambiar de tema o cambiar de salón.
 */
export function mergeContinuousSessionsForPatient(
  sessions: ProgramSessionItem[]
): ProgramSessionItem[] {
  if (!sessions || sessions.length <= 1) return sessions || []

  const normText = (s?: string | null) =>
    (s || "")
      .replace(/^[^:]+:\s*/, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")

  const merged: ProgramSessionItem[] = []

  for (const item of sessions) {
    if (merged.length === 0) {
      merged.push({ ...item, moduleNumber: 1 })
      continue
    }

    const prev = merged[merged.length - 1]
    const sameAmbiente = normText(prev.ambiente) === normText(item.ambiente)
    const sameTema =
      normText(prev.sesion || prev.courseName) === normText(item.sesion || item.courseName)
    // Consideramos "de corrido" si el siguiente módulo inicia inmediatamente al terminar el anterior (o con <= 15 min de receso)
    const isContinuous = item.startMinutes <= prev.endMinutes + 15

    if (sameAmbiente && sameTema && isContinuous) {
      if (item.endMinutes > prev.endMinutes) {
        prev.horaFin = item.horaFin
        prev.endMinutes = item.endMinutes
      }
    } else {
      merged.push({
        ...item,
        moduleNumber: merged.length + 1,
      })
    }
  }

  return merged
}

/**
 * Obtiene los minutos transcurridos del día en hora oficial de Lima (UTC-5).
 */
export function getCurrentLimaMinutes(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now)
  const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10)
  const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10)
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
}

/**
 * Resuelve el estado por módulo (PENDIENTE, EN_CURSO, COMPLETADO) de un Docente o Paciente Simulado
 * a partir de su programación del día, sus marcaciones de hoy y la hora actual en Lima.
 */
export function resolveUserModulesState(
  sessions: ProgramSessionItem[],
  todayRecords: TodayAttendanceRecordLite[] = [],
  currentLimaMinutes: number = getCurrentLimaMinutes(),
  userRole?: Role
): UserModulesResolution {
  const effectiveSessions =
    userRole === Role.PACIENTE_SIMULADO
      ? mergeContinuousSessionsForPatient(sessions)
      : sessions

  if (!effectiveSessions || effectiveSessions.length === 0) {
    const lastRec = todayRecords.length > 0 ? todayRecords[todayRecords.length - 1] : null
    return {
      modules: [],
      activeModuleIndex: -1,
      activeModule: null,
      nextModule: null,
      completedModuleBeforeActive: null,
      nextAction: lastRec?.type === "ENTRADA" ? "SALIDA" : "ENTRADA",
      allCompleted: false,
      shouldTriggerRotationAlert: false,
      rotationAlertReason: null,
    }
  }

  // Agrupar las marcaciones cronológicas del día en pares [ENTRADA, SALIDA?]
  const cycles: { entryTimestamp: string; exitTimestamp?: string }[] = []
  for (const rec of todayRecords) {
    if (rec.type === "ENTRADA") {
      cycles.push({ entryTimestamp: rec.timestamp })
    } else if (rec.type === "SALIDA") {
      const openCycle = cycles.length > 0 ? cycles[cycles.length - 1] : null
      if (openCycle && !openCycle.exitTimestamp) {
        openCycle.exitTimestamp = rec.timestamp
      } else {
        // Si hubo una SALIDA huérfana sin ENTRADA previa, cerramos un ciclo sintético
        cycles.push({ entryTimestamp: rec.timestamp, exitTimestamp: rec.timestamp })
      }
    }
  }

  // Emparejar cada ciclo con su módulo correspondiente en orden
  // Si el primer ciclo se registró cuando ya habían terminado los primeros módulos (ej. llegó al Módulo 2),
  // asignamos respetando la ventana horaria cuando no hay ciclos previos.
  const moduleStates: ResolvedModuleStatus[] = effectiveSessions.map((s) => ({
    ...s,
    status: "PENDIENTE" as ModuleAttendanceStatus,
  }))

  let nextAvailableModIdx = 0
  for (const cycle of cycles) {
    if (nextAvailableModIdx >= moduleStates.length) break
    const entryDate = new Date(cycle.entryTimestamp)
    const entryMins = !isNaN(entryDate.getTime()) ? getCurrentLimaMinutes(entryDate) : null

    // Si este ciclo empezó después de que el módulo actual ya había terminado y hay un módulo posterior disponible,
    // avanzamos hasta el módulo cuya hora de fin sea posterior al ingreso (siempre que queden módulos suficientes)
    if (entryMins !== null) {
      while (
        nextAvailableModIdx < moduleStates.length - 1 &&
        entryMins >= moduleStates[nextAvailableModIdx].endMinutes
      ) {
        nextAvailableModIdx++
      }
    }

    const targetMod = moduleStates[nextAvailableModIdx]
    targetMod.entryTimestamp = cycle.entryTimestamp
    if (cycle.exitTimestamp) {
      targetMod.exitTimestamp = cycle.exitTimestamp
      targetMod.status = "COMPLETADO"
      nextAvailableModIdx++
    } else {
      targetMod.status = "EN_CURSO"
      nextAvailableModIdx++
    }
  }

  // Verificar si hay un módulo actualmente EN_CURSO (con ENTRADA marcada y pendiente de SALIDA)
  const inProgressIdx = moduleStates.findIndex((m) => m.status === "EN_CURSO")

  if (inProgressIdx !== -1) {
    const activeModule = moduleStates[inProgressIdx]
    const nextModule = moduleStates[inProgressIdx + 1] || null
    const completedModuleBeforeActive = inProgressIdx > 0 ? moduleStates[inProgressIdx - 1] : null
    const timeEnded = currentLimaMinutes >= activeModule.endMinutes

    return {
      modules: moduleStates,
      activeModuleIndex: inProgressIdx,
      activeModule,
      nextModule,
      completedModuleBeforeActive,
      nextAction: "SALIDA",
      allCompleted: false,
      shouldTriggerRotationAlert: timeEnded,
      rotationAlertReason: timeEnded ? "MODULE_TIME_ENDED" : null,
    }
  }

  // Buscar el último módulo completado
  let lastCompletedIdx = -1
  for (let i = moduleStates.length - 1; i >= 0; i--) {
    if (moduleStates[i].status === "COMPLETADO") {
      lastCompletedIdx = i
      break
    }
  }

  // Buscar el siguiente módulo PENDIENTE después del último completado
  const pendingAfterLastCompleted: number[] = []
  for (let i = lastCompletedIdx + 1; i < moduleStates.length; i++) {
    if (moduleStates[i].status === "PENDIENTE") {
      pendingAfterLastCompleted.push(i)
    }
  }

  if (pendingAfterLastCompleted.length > 0) {
    // Si ya completó un módulo previo (ej. acaba de marcar SALIDA del Módulo 1), el siguiente módulo inmediato
    // es el que le toca marcar ENTRADA para su rotación.
    // Si aún no ha marcado nada hoy (lastCompletedIdx === -1), elegimos el primer módulo que aún no haya terminado.
    let chosenIdx = pendingAfterLastCompleted[0]
    if (lastCompletedIdx === -1) {
      const notEndedIdx = pendingAfterLastCompleted.find(
        (idx) => moduleStates[idx].endMinutes > currentLimaMinutes
      )
      if (notEndedIdx !== undefined) {
        chosenIdx = notEndedIdx
      }
    }

    const activeModule = moduleStates[chosenIdx]
    const nextModule = moduleStates[chosenIdx + 1] || null
    const completedModuleBeforeActive =
      lastCompletedIdx !== -1 ? moduleStates[lastCompletedIdx] : null

    // Si acaba de completar el módulo anterior y ya estamos en (o cerca de) la rotación hacia el nuevo módulo
    const readyForNext =
      completedModuleBeforeActive !== null &&
      currentLimaMinutes >= completedModuleBeforeActive.endMinutes - 15

    return {
      modules: moduleStates,
      activeModuleIndex: chosenIdx,
      activeModule,
      nextModule,
      completedModuleBeforeActive,
      nextAction: "ENTRADA",
      allCompleted: false,
      shouldTriggerRotationAlert: readyForNext,
      rotationAlertReason: readyForNext ? "READY_FOR_NEXT_MODULE" : null,
    }
  }

  // Todos los módulos posteriores ya fueron completados
  const lastIdx = moduleStates.length - 1
  const lastRec = todayRecords.length > 0 ? todayRecords[todayRecords.length - 1] : null

  return {
    modules: moduleStates,
    activeModuleIndex: lastIdx,
    activeModule: moduleStates[lastIdx],
    nextModule: null,
    completedModuleBeforeActive: lastIdx > 0 ? moduleStates[lastIdx - 1] : null,
    nextAction: lastRec?.type === "ENTRADA" ? "SALIDA" : "ENTRADA",
    allCompleted: true,
    shouldTriggerRotationAlert: false,
    rotationAlertReason: null,
  }
}

export interface MobileRotationAlertPayload {
  enabled: boolean
  shouldAlert: boolean
  reason: "MODULE_TIME_ENDED" | "READY_FOR_NEXT_MODULE" | null
  title: string
  message: string
  currentModule: ResolvedModuleStatus | null
  nextModule: ResolvedModuleStatus | null
  nextAmbiente: string | null
  nextHorario: string | null
}

/**
 * Construye el aviso de término de módulo y rotación de clase EXCLUSIVAMENTE para celulares (!isKioskStation).
 * Si el dispositivo es una Estación Oficial (PC fija de sede), esta función está deshabilitada.
 */
export function buildMobileRotationAlertPayload(
  resolution: UserModulesResolution | null,
  isKioskStation: boolean,
  userRole?: Role
): MobileRotationAlertPayload {
  if (isKioskStation || !resolution || !resolution.shouldTriggerRotationAlert || !resolution.activeModule) {
    return {
      enabled: !isKioskStation,
      shouldAlert: false,
      reason: null,
      title: "",
      message: "",
      currentModule: null,
      nextModule: null,
      nextAmbiente: null,
      nextHorario: null,
    }
  }

  const cleanAmb = (raw?: string | null) =>
    raw ? raw.replace(/^[^:]+:\s*/, "").trim() : "Por asignar"

  if (resolution.rotationAlertReason === "MODULE_TIME_ENDED") {
    const cur = resolution.activeModule
    const nxt = resolution.nextModule
    const curAmb = cleanAmb(cur.ambiente)
    const nxtAmb = nxt ? cleanAmb(nxt.ambiente) : null
    const isDocente = userRole === Role.DOCENTE

    if (isDocente) {
      const sameRoom = nxtAmb && curAmb.toLowerCase() === nxtAmb.toLowerCase()
      const title = nxt
        ? `⏰ Fin de hora (${cur.horaFin}) — Cambio de sección de alumnos`
        : `⏰ Fin de hora (${cur.horaFin}) — Sección concluida`

      const message = nxt
        ? sameRoom
          ? `Ya terminó la hora con esta sección de alumnos en ${curAmb} (${cur.horaFin}). Marque su SALIDA y registre su ENTRADA para la siguiente sección (${nxt.horaInicio} a ${nxt.horaFin}).`
          : `Ya terminó la hora con esta sección de alumnos en ${curAmb} (${cur.horaFin}). Marque su SALIDA y cambie al ambiente ${nxtAmb} (${nxt.horaInicio} a ${nxt.horaFin} — ${nxt.courseName}).`
        : `Ya terminó la hora con su sección de alumnos en ${curAmb} (${cur.horaFin}). Por favor, marque su SALIDA.`

      return {
        enabled: true,
        shouldAlert: true,
        reason: "MODULE_TIME_ENDED",
        title,
        message,
        currentModule: cur,
        nextModule: nxt,
        nextAmbiente: nxtAmb,
        nextHorario: nxt ? `${nxt.horaInicio} a ${nxt.horaFin}` : null,
      }
    }

    // PACIENTE_SIMULADO: solo recibe aviso cuando cambia de tema y/o salón (los bloques seguidos iguales ya fueron unificados)
    const title = nxt
      ? `⏰ Fin de clase (${cur.horaFin}) — ¡Cambio de tema y salón!`
      : `⏰ Fin de clase (${cur.horaFin})`

    const message = nxt
      ? `La hora de su clase en ${curAmb} ha terminado (${cur.horaFin}). Marque su SALIDA y rote al ambiente ${nxtAmb} (${nxt.horaInicio} a ${nxt.horaFin} — ${nxt.courseName}).`
      : `La hora de su clase en ${curAmb} (${cur.courseName}) ha terminado (${cur.horaFin}). Por favor, marque su SALIDA.`

    return {
      enabled: true,
      shouldAlert: true,
      reason: "MODULE_TIME_ENDED",
      title,
      message,
      currentModule: cur,
      nextModule: nxt,
      nextAmbiente: nxtAmb,
      nextHorario: nxt ? `${nxt.horaInicio} a ${nxt.horaFin}` : null,
    }
  }

  if (resolution.rotationAlertReason === "READY_FOR_NEXT_MODULE") {
    const prev = resolution.completedModuleBeforeActive
    const nxt = resolution.activeModule
    const nxtAmb = cleanAmb(nxt.ambiente)

    return {
      enabled: true,
      shouldAlert: true,
      reason: "READY_FOR_NEXT_MODULE",
      title: `🔄 Siguiente clase (${nxt.horaInicio} a ${nxt.horaFin})`,
      message: `Diríjase a su ambiente ${nxtAmb}${nxt.piso ? ` (${nxt.piso})` : ""} y marque su ENTRADA (${nxt.courseName}).`,
      currentModule: prev,
      nextModule: nxt,
      nextAmbiente: nxtAmb,
      nextHorario: `${nxt.horaInicio} a ${nxt.horaFin}`,
    }
  }

  return {
    enabled: true,
    shouldAlert: false,
    reason: null,
    title: "",
    message: "",
    currentModule: null,
    nextModule: null,
    nextAmbiente: null,
    nextHorario: null,
  }
}

/**
 * Obtiene el resumen de programación del día para un Docente o Paciente Simulado.
 */
export async function getDailyProgramForUser(
  userName: string,
  userRole: Role,
  fallbackCampusName?: string | null
): Promise<UserDailyProgramSummary> {
  const allSessions = await fetchDailyProgramSessions()
  return matchDailyProgramFromSessions(allSessions, userName, userRole, fallbackCampusName)
}
