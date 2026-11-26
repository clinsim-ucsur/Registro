import prisma from "@/lib/prisma"

export const TECH_CUSTOM_RULES_SETTING_KEY = "TECH_CUSTOM_RULES_V1"

export interface TechnicianCustomRuleEntry {
  userId: string
  dni: string
  userName: string
  /** Si es true, el técnico está liberado manualmente para ingresar fuera de hora (sin bloqueo y marca A_TIEMPO) */
  freeOutOfHours: boolean
  /** ID de una regla de ToleranceRule asignada específicamente a este técnico (opcional) */
  customRuleId?: string | null
  /** Hora de entrada personalizada ("HH:mm") para este técnico en específico (opcional) */
  customEntryTime?: string | null
  /** Minutos de gracia personalizados para este técnico (opcional) */
  customGraceMinutes?: number | null
  /** Minutos de tolerancia de tardanza personalizados para este técnico (opcional) */
  customLateMinutes?: number | null
  notes?: string | null
  updatedAt: string
}

let cachedTechRules: Record<string, TechnicianCustomRuleEntry> | null = null
let cachedAt = 0
const CACHE_TTL_MS = 10_000

export async function getTechnicianCustomRulesMap(
  forceReload = false
): Promise<Record<string, TechnicianCustomRuleEntry>> {
  const now = Date.now()
  if (!forceReload && cachedTechRules && now - cachedAt < CACHE_TTL_MS) {
    return cachedTechRules
  }

  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: TECH_CUSTOM_RULES_SETTING_KEY },
    })
    if (row?.value) {
      const parsed = JSON.parse(row.value)
      if (parsed && typeof parsed === "object") {
        cachedTechRules = parsed as Record<string, TechnicianCustomRuleEntry>
        cachedAt = now
        return cachedTechRules
      }
    }
  } catch (err) {
    console.warn("[tech-custom-rules] Error leyendo configuración por técnico:", err)
  }

  cachedTechRules = {}
  cachedAt = now
  return cachedTechRules
}

export async function getTechnicianCustomRule(
  userIdOrDni: string
): Promise<TechnicianCustomRuleEntry | null> {
  if (!userIdOrDni) return null
  const map = await getTechnicianCustomRulesMap()
  if (map[userIdOrDni]) return map[userIdOrDni]
  const found = Object.values(map).find(
    (e) => e.userId === userIdOrDni || e.dni === userIdOrDni
  )
  return found || null
}

export async function upsertTechnicianCustomRule(
  entry: Omit<TechnicianCustomRuleEntry, "updatedAt">
): Promise<TechnicianCustomRuleEntry> {
  const map = { ...(await getTechnicianCustomRulesMap(true)) }
  const saved: TechnicianCustomRuleEntry = {
    ...entry,
    updatedAt: new Date().toISOString(),
  }

  // Si no tiene liberación fuera de hora ni regla/hora personalizada, limpiar registro
  if (
    !saved.freeOutOfHours &&
    !saved.customRuleId &&
    !saved.customEntryTime
  ) {
    delete map[saved.userId]
    delete map[saved.dni]
  } else {
    map[saved.userId] = saved
  }

  cachedTechRules = map
  cachedAt = Date.now()

  await prisma.systemSetting.upsert({
    where: { key: TECH_CUSTOM_RULES_SETTING_KEY },
    update: {
      value: JSON.stringify(map),
      description: "Liberación fuera de hora y reglas específicas por Técnico",
    },
    create: {
      key: TECH_CUSTOM_RULES_SETTING_KEY,
      value: JSON.stringify(map),
      description: "Liberación fuera de hora y reglas específicas por Técnico",
    },
  })

  return saved
}

export async function removeTechnicianCustomRule(userId: string): Promise<void> {
  const map = { ...(await getTechnicianCustomRulesMap(true)) }
  delete map[userId]
  cachedTechRules = map
  cachedAt = Date.now()

  await prisma.systemSetting.upsert({
    where: { key: TECH_CUSTOM_RULES_SETTING_KEY },
    update: { value: JSON.stringify(map) },
    create: { key: TECH_CUSTOM_RULES_SETTING_KEY, value: JSON.stringify(map) },
  })
}
