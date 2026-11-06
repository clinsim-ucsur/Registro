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

export interface UserDailyProgramSummary {
  found: boolean
  matchedRoleInSession?: "DOCENTE_LIDER" | "DOCENTE_COLABORADOR" | "PACIENTE_ESTANDARIZADO"
  entryTime: string // Hora Inicio de la programación más temprana ("HH:mm")
  exitTime: string // Hora Fin de la última programación del día ("HH:mm")
  ambiente: string // Ambiente de la programación más temprana
  piso: string // Piso de la programación más temprana
  sesion: string // Sesión de la programación más temprana
  courseName: string // Curso oficial mapeado de la programación más temprana
  campusName: string // Sede detectada (ej. "Campus Villa")
  totalSessions: number
  sessions: {
    horaInicio: string
    horaFin: string
    ambiente: string
    piso: string
    sesion: string
    courseName: string
  }[]
}

// Caché en memoria (TTL: 2 minutos) para respuesta instantánea al digitar DNI
let cachedSessions: {
  data: NormalizedProgramSession[]
  expiresAt: number
} | null = null

const CACHE_TTL_MS = 2 * 60 * 1000

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

/**
 * Obtiene las sesiones programadas del día desde la API 1 (JSON) o API 2 (Google Sheet CSV como respaldo).
 */
export async function fetchDailyProgramSessions(): Promise<NormalizedProgramSession[]> {
  const now = Date.now()
  if (cachedSessions && cachedSessions.expiresAt > now) {
    return cachedSessions.data
  }

  // 1. Intentar con API 1 (Google Apps Script JSON)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6500)
    const res = await fetch(API_1_JSON_URL, {
      signal: controller.signal,
      cache: "no-store",
    })
    clearTimeout(timer)

    if (res.ok) {
      const json = await res.json()
      if (json && Array.isArray(json.sesiones)) {
        const parsed = normalizeRawSessions(json.sesiones)
        cachedSessions = { data: parsed, expiresAt: now + CACHE_TTL_MS }
        return parsed
      }
    }
  } catch (err) {
    console.warn("[daily-program-api] Falló API 1 JSON, intentando respaldo API 2 CSV:", err)
  }

  // 2. Respaldo con API 2 (Google Sheets CSV export)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6500)
    const res = await fetch(API_2_CSV_URL, {
      signal: controller.signal,
      cache: "no-store",
    })
    clearTimeout(timer)

    if (res.ok) {
      const csvText = await res.text()
      const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0)
      if (lines.length > 1) {
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
        cachedSessions = { data: parsed, expiresAt: now + CACHE_TTL_MS }
        return parsed
      }
    }
  } catch (err) {
    console.warn("[daily-program-api] Falló API 2 CSV:", err)
  }

  return cachedSessions ? cachedSessions.data : []
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

  // Si hay múltiples nombres separados por slash, punto y coma o salto de línea
  const parts = fieldValue.split(/[;/\n]+/).map((p) => p.trim()).filter(Boolean)
  if (parts.length > 1) {
    return parts.some((part) => isSamePersonName(userName, part))
  }
  return false
}

/**
 * Obtiene el resumen de programación del día para un Docente o Paciente Simulado.
 * - Toma como referencia de ingreso la programación MÁS TEMPRANA del día (Hora Inicio, Ambiente y Curso).
 * - Toma como fin de su turno la ÚLTIMA programación del día (Hora Fin más tardía).
 */
export async function getDailyProgramForUser(
  userName: string,
  userRole: Role,
  fallbackCampusName?: string | null
): Promise<UserDailyProgramSummary> {
  const allSessions = await fetchDailyProgramSessions()

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

  // Ordenar por hora de inicio ascendente para obtener la programación más temprana del día
  const byEarliestStart = [...matchedSessions].sort(
    (a, b) => a.session.startMinutes - b.session.startMinutes
  )
  // Ordenar por hora de fin descendente para obtener la última programación del día (fin de turno)
  const byLatestEnd = [...matchedSessions].sort(
    (a, b) => b.session.endMinutes - a.session.endMinutes
  )

  const earliest = byEarliestStart[0]
  const latest = byLatestEnd[0]

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
    totalSessions: matchedSessions.length,
    sessions: byEarliestStart.map((m) => ({
      horaInicio: m.session.horaInicio,
      horaFin: m.session.horaFin,
      ambiente: m.session.ambiente,
      piso: m.session.piso,
      sesion: m.session.sesion,
      courseName: m.session.courseName,
    })),
  }
}

