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
  /** Pre-tokenización interna para búsqueda O(1) en directorios masivos */
  _liderTokenGroups?: string[][]
  _colabTokenGroups?: string[][]
  _pacientesTokenGroups?: string[][]
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

// Caché en memoria con refresco rápido (15s) y soporte de lectura en vivo forzada para reflejar cambios al instante
let cachedSessions: {
  data: NormalizedProgramSession[]
  expiresAt: number
  syncedAt: string
  source: "API_1_JSON_LIVE" | "API_2_CSV_BACKUP"
} | null = null
let inflightRefresh: Promise<NormalizedProgramSession[]> | null = null
const cachedUserMatchMap = new Map<string, UserDailyProgramSummary>()

const CACHE_TTL_MS = 15 * 1000 // 15 segundos de frescura máxima para captar modificaciones de último minuto en el Excel

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

function tokenizeFieldGroups(fieldValue: string): string[][] {
  if (!fieldValue) return []
  const trimmed = fieldValue.trim()
  if (!trimmed || trimmed.toLowerCase() === "ninguno") return []
  const parts = trimmed.split(/[;/\n]+/).map((p) => p.trim()).filter(Boolean)
  const groups: string[][] = []
  for (const part of parts) {
    const tokens = normalizeNameTokens(part)
    if (tokens.length > 0) groups.push(tokens)
  }
  return groups
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
    const docenteLider = (item["Docente Líder"] || "").trim()
    const docentesColaboradores = (item["Docentes Colaboradores"] || "").trim()
    const pacientesEstandarizados = (item["Pacientes Estandarizados"] || "").trim()

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
      docenteLider,
      docentesColaboradores,
      pacientesEstandarizados,
      _liderTokenGroups: tokenizeFieldGroups(docenteLider),
      _colabTokenGroups: tokenizeFieldGroups(docentesColaboradores),
      _pacientesTokenGroups: tokenizeFieldGroups(pacientesEstandarizados),
    })
  }
  return normalized
}

async function fetchFromApi2Csv(): Promise<NormalizedProgramSession[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3500)
  try {
    const bustUrl = `${API_2_CSV_URL}&t=${Date.now()}`
    const res = await fetch(bustUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
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
  const timer = setTimeout(() => controller.abort(), 4500)
  try {
    const bustUrl = `${API_1_JSON_URL}?t=${Date.now()}`
    const res = await fetch(bustUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
      },
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

async function refreshDailyProgramCache(preferLiveJson = false): Promise<NormalizedProgramSession[]> {
  if (inflightRefresh && !preferLiveJson) return inflightRefresh
  const task = (async () => {
    try {
      const p1 = fetchFromApi1Json()
      const p2 = fetchFromApi2Csv()

      // Cuando se solicita lectura en vivo (o validación directa), priorizamos API 1 (Apps Script lee las celdas en vivo
      // sin el caché de CDN de exportación CSV de Google Docs). Si API 1 tarda > 2.2s o falla, usamos API 2 o el que tenga más filas.
      if (preferLiveJson) {
        try {
          const liveData = await p1
          cachedSessions = {
            data: liveData,
            expiresAt: Date.now() + CACHE_TTL_MS,
            syncedAt: new Date().toISOString(),
            source: "API_1_JSON_LIVE",
          }
          cachedUserMatchMap.clear()
          return liveData
        } catch {
          const csvData = await p2
          cachedSessions = {
            data: csvData,
            expiresAt: Date.now() + CACHE_TTL_MS,
            syncedAt: new Date().toISOString(),
            source: "API_2_CSV_BACKUP",
          }
          cachedUserMatchMap.clear()
          return csvData
        }
      }

      // En precarga general: si API 2 responde primero, actualizamos rápido, pero cuando API 1 termina (en vivo),
      // actualiza el caché con los datos en tiempo real de Apps Script para no perder filas recién agregadas.
      p1.then((liveData) => {
        if (liveData && liveData.length > 0) {
          cachedSessions = {
            data: liveData,
            expiresAt: Date.now() + CACHE_TTL_MS,
            syncedAt: new Date().toISOString(),
            source: "API_1_JSON_LIVE",
          }
          cachedUserMatchMap.clear()
        }
      }).catch(() => {})

      const fastest = await Promise.any([
        p1.then((d) => ({ data: d, source: "API_1_JSON_LIVE" as const })),
        p2.then((d) => ({ data: d, source: "API_2_CSV_BACKUP" as const })),
      ])
      cachedSessions = {
        data: fastest.data,
        expiresAt: Date.now() + CACHE_TTL_MS,
        syncedAt: new Date().toISOString(),
        source: fastest.source,
      }
      cachedUserMatchMap.clear()
      return fastest.data
    } catch (err) {
      console.warn("[daily-program-api] No se pudo actualizar desde API 1 / API 2:", err)
      return cachedSessions ? cachedSessions.data : []
    } finally {
      inflightRefresh = null
    }
  })()
  inflightRefresh = task
  return task
}

export function getDailyProgramSyncMeta() {
  return {
    syncedAt: cachedSessions?.syncedAt || null,
    source: cachedSessions?.source || null,
    totalSessions: cachedSessions?.data.length || 0,
  }
}

/**
 * Fuerza una recarga inmediata en vivo desde el Excel/Google Sheet ignorando cualquier caché previo.
 */
export async function forceRefreshDailyProgramSessions(): Promise<NormalizedProgramSession[]> {
  return refreshDailyProgramCache(true)
}

/**
 * Obtiene las sesiones programadas del día:
 * - Si `forceRefresh` es true, consulta en vivo el Excel/Apps Script para reflejar cambios recién hechos.
 * - Si hay datos en caché vigentes (< 15s), responde en 0ms.
 * - Si el caché venció (> 15s), espera hasta `maxWaitMs` por los datos frescos para que el usuario siempre vea sus últimos cambios.
 */
export async function fetchDailyProgramSessions(
  maxWaitMs = 2400,
  forceRefresh = false
): Promise<NormalizedProgramSession[]> {
  const now = Date.now()
  if (!forceRefresh && cachedSessions && cachedSessions.expiresAt > now) {
    return cachedSessions.data
  }

  const refreshPromise = refreshDailyProgramCache(forceRefresh)
  if (maxWaitMs <= 0) {
    return refreshPromise
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<NormalizedProgramSession[]>((resolve) => {
    timeoutId = setTimeout(() => resolve(cachedSessions ? cachedSessions.data : []), maxWaitMs)
  })

  try {
    return await Promise.race([refreshPromise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
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

/**
 * Evalúa en O(N) y con cero asignaciones en memoria si dos cadenas tienen
 * distancia de edición (Levenshtein) <= 1.
 */
function isEditDistanceAtMostOne(a: string, b: string): boolean {
  const lenA = a.length
  const lenB = b.length
  const diff = lenA - lenB
  if (diff > 1 || diff < -1) return false
  if (a === b) return true

  let i = 0
  let j = 0
  let edits = 0

  while (i < lenA && j < lenB) {
    if (a.charCodeAt(i) === b.charCodeAt(j)) {
      i++
      j++
    } else {
      edits++
      if (edits > 1) return false
      if (lenA > lenB) {
        i++
      } else if (lenB > lenA) {
        j++
      } else {
        i++
        j++
      }
    }
  }

  if (i < lenA || j < lenB) {
    edits++
  }

  return edits <= 1
}

function tokensAreEquivalent(t1: string, t2: string): boolean {
  if (t1 === t2) return true
  if (t1.length >= 4 && t2.length >= 4 && isEditDistanceAtMostOne(t1, t2)) return true
  return false
}

function tokenArraysMatchPerson(tokA: string[], tokB: string[]): boolean {
  if (tokA.length === 0 || tokB.length === 0) return false

  const shorter = tokA.length <= tokB.length ? tokA : tokB
  const longer = tokA.length <= tokB.length ? tokB : tokA
  const requiredMatches = shorter.length <= 3 ? shorter.length : 3

  let usedMask = 0
  let matchedCount = 0

  for (let s = 0; s < shorter.length; s++) {
    const sToken = shorter[s]
    for (let l = 0; l < longer.length; l++) {
      if ((usedMask & (1 << l)) === 0 && tokensAreEquivalent(sToken, longer[l])) {
        usedMask |= 1 << l
        matchedCount++
        break
      }
    }
    // Salida temprana si incluso acertando todos los tokens restantes no alcanzaría el mínimo requerido
    if (matchedCount + (shorter.length - 1 - s) < requiredMatches) {
      return false
    }
  }

  return matchedCount >= requiredMatches
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
  return tokenArraysMatchPerson(tokA, tokB)
}

function matchesPreTokenizedField(
  userTokens: string[],
  session: NormalizedProgramSession,
  fieldKey: "docenteLider" | "docentesColaboradores" | "pacientesEstandarizados"
): boolean {
  if (userTokens.length === 0) return false

  let groups: string[][] | undefined
  if (fieldKey === "docenteLider") {
    if (!session._liderTokenGroups) {
      session._liderTokenGroups = tokenizeFieldGroups(session.docenteLider)
    }
    groups = session._liderTokenGroups
  } else if (fieldKey === "docentesColaboradores") {
    if (!session._colabTokenGroups) {
      session._colabTokenGroups = tokenizeFieldGroups(session.docentesColaboradores)
    }
    groups = session._colabTokenGroups
  } else {
    if (!session._pacientesTokenGroups) {
      session._pacientesTokenGroups = tokenizeFieldGroups(session.pacientesEstandarizados)
    }
    groups = session._pacientesTokenGroups
  }

  if (!groups || groups.length === 0) return false
  for (let i = 0; i < groups.length; i++) {
    if (tokenArraysMatchPerson(userTokens, groups[i])) return true
  }
  return false
}

export function matchDailyProgramFromSessions(
  allSessions: NormalizedProgramSession[],
  userName: string,
  userRole: Role,
  fallbackCampusName?: string | null
): UserDailyProgramSummary {
  const isUsingLiveCache = cachedSessions !== null && allSessions === cachedSessions.data
  const cacheKey = isUsingLiveCache
    ? `${userRole}|${(userName || "").trim().toLowerCase()}|${fallbackCampusName || ""}`
    : ""

  if (isUsingLiveCache) {
    const cachedResult = cachedUserMatchMap.get(cacheKey)
    if (cachedResult) return cachedResult
  }

  const userTokens = normalizeNameTokens((userName || "").trim())
  const matchedSessions: {
    session: NormalizedProgramSession
    roleInSession: "DOCENTE_LIDER" | "DOCENTE_COLABORADOR" | "PACIENTE_ESTANDARIZADO"
  }[] = []

  if (userTokens.length > 0) {
    for (const s of allSessions) {
      if (userRole === Role.PACIENTE_SIMULADO) {
        if (matchesPreTokenizedField(userTokens, s, "pacientesEstandarizados")) {
          matchedSessions.push({ session: s, roleInSession: "PACIENTE_ESTANDARIZADO" })
        }
      } else if (userRole === Role.DOCENTE || userRole === Role.SUPER_ADMIN || userRole === Role.ADMIN_SECUNDARIO) {
        if (matchesPreTokenizedField(userTokens, s, "docenteLider")) {
          matchedSessions.push({ session: s, roleInSession: "DOCENTE_LIDER" })
        } else if (matchesPreTokenizedField(userTokens, s, "docentesColaboradores")) {
          matchedSessions.push({ session: s, roleInSession: "DOCENTE_COLABORADOR" })
        }
      }
    }
  }

  if (matchedSessions.length === 0) {
    const emptySummary: UserDailyProgramSummary = {
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
    if (isUsingLiveCache) cachedUserMatchMap.set(cacheKey, emptySummary)
    return emptySummary
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

  const summary: UserDailyProgramSummary = {
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
  if (isUsingLiveCache) cachedUserMatchMap.set(cacheKey, summary)
  return summary
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
    // Siempre priorizamos el primer módulo pendiente que aún no haya terminado (endMinutes > currentLimaMinutes).
    // Así, si se agregan nuevos módulos en el Excel o hubo un módulo anterior ya vencido, muestra el horario actual/siguiente real.
    let chosenIdx = pendingAfterLastCompleted[0]
    const notEndedIdx = pendingAfterLastCompleted.find(
      (idx) => moduleStates[idx].endMinutes > currentLimaMinutes
    )
    if (notEndedIdx !== undefined) {
      chosenIdx = notEndedIdx
    }

    const activeModule = moduleStates[chosenIdx]
    const nextModule = moduleStates[chosenIdx + 1] || null
    const prevModule = chosenIdx > 0 ? moduleStates[chosenIdx - 1] : null
    const completedModuleBeforeActive =
      lastCompletedIdx !== -1
        ? moduleStates[lastCompletedIdx]
        : prevModule &&
            currentLimaMinutes >= prevModule.endMinutes &&
            currentLimaMinutes <= prevModule.endMinutes + 15
          ? prevModule
          : null

    // Si acaba de completar (o acaba de vencer la hora de) el módulo anterior y ya estamos en la rotación hacia el nuevo módulo
    const readyForNext =
      completedModuleBeforeActive !== null &&
      currentLimaMinutes >= completedModuleBeforeActive.endMinutes - 15

    // Si el módulo actual acaba de cumplir su hora de término (dentro de los últimos 15 min)
    const activeJustEnded =
      notEndedIdx === undefined &&
      currentLimaMinutes >= activeModule.endMinutes &&
      currentLimaMinutes <= activeModule.endMinutes + 15

    return {
      modules: moduleStates,
      activeModuleIndex: chosenIdx,
      activeModule,
      nextModule,
      completedModuleBeforeActive,
      nextAction: "ENTRADA",
      allCompleted: false,
      shouldTriggerRotationAlert: readyForNext || activeJustEnded,
      rotationAlertReason: activeJustEnded
        ? "MODULE_TIME_ENDED"
        : readyForNext
          ? "READY_FOR_NEXT_MODULE"
          : null,
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
