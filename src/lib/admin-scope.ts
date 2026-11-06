// Utilidades para separar la Sede Operativa (campusId como Técnico/Docente/Paciente)
// de la Sede de Visualización Administrativa (adminCampusId) y el Nivel de Administrador (AdminTier).

export type AdminTier =
  | "SUPER_ADMIN"
  | "ADMIN_GLOBAL"
  | "ADMIN_SEDE"
  | "COORDINADOR_PACIENTES"

export const SCOPE_PREFIX = "scope:"
export const SCOPE_ALL = "scope:ALL"
export const SCOPE_CAMPUS_PREFIX = "scope:campus:"

export const TIER_PREFIX = "tier:"

/**
 * Extrae únicamente los IDs de módulos limpios (sin metadatos de scope: o tier:).
 */
export function extractModulePermissions(rawPermissions: string[] | null | undefined): string[] {
  if (!Array.isArray(rawPermissions)) return []
  return rawPermissions.filter(
    (p) => typeof p === "string" && !p.startsWith(SCOPE_PREFIX) && !p.startsWith(TIER_PREFIX)
  )
}

/**
 * Extrae el adminCampusId configurado para la vista administrativa.
 * - Si tiene `scope:ALL`, retorna `null` (ve todas las sedes).
 * - Si tiene `scope:campus:<id>`, retorna `<id>` (solo ve esa sede).
 * - Si no tiene token `scope:` (registros antiguos):
 *   - Si es `SUPER_ADMIN`, por defecto ve todas las sedes (`null`).
 *   - Si es `ADMIN_SECUNDARIO`, usa `fallbackCampusId` si existe, o `null`.
 */
export function extractAdminCampusId(
  rawPermissions: string[] | null | undefined,
  effectiveRole: "SUPER_ADMIN" | "ADMIN_SECUNDARIO",
  fallbackCampusId?: string | null
): string | null {
  if (Array.isArray(rawPermissions)) {
    if (rawPermissions.includes(SCOPE_ALL)) {
      return null
    }
    const campusToken = rawPermissions.find((p) => p.startsWith(SCOPE_CAMPUS_PREFIX))
    if (campusToken) {
      const id = campusToken.slice(SCOPE_CAMPUS_PREFIX.length).trim()
      return id || null
    }
  }

  // Por defecto un SUPER_ADMIN siempre ve todas las sedes (sin confundirse con su sede operativa de técnico)
  if (effectiveRole === "SUPER_ADMIN") {
    return null
  }

  return fallbackCampusId || null
}

/**
 * Extrae el nivel administrativo exacto:
 * - `SUPER_ADMIN`: Acceso total sin restricciones (incluye Informe de Logs y designar Super Admins)
 * - `ADMIN_GLOBAL`: Ve todas las sedes, sin poder crear Super Admins ni ver Informe de Logs
 * - `ADMIN_SEDE`: Ve únicamente la información de su sede administrativa asignada
 * - `COORDINADOR_PACIENTES`: Gestiona, monitorea y exporta exclusivamente Pacientes Simulados (en todas las sedes o en una sede asignada)
 */
export function extractAdminTier(
  rawPermissions: string[] | null | undefined,
  effectiveRole: "SUPER_ADMIN" | "ADMIN_SECUNDARIO",
  fallbackCampusId?: string | null
): AdminTier {
  if (effectiveRole === "SUPER_ADMIN") {
    return "SUPER_ADMIN"
  }
  if (Array.isArray(rawPermissions)) {
    const tierToken = rawPermissions.find((p) => p.startsWith(TIER_PREFIX))
    if (tierToken) {
      const t = tierToken.slice(TIER_PREFIX.length) as AdminTier
      if (
        t === "SUPER_ADMIN" ||
        t === "ADMIN_GLOBAL" ||
        t === "ADMIN_SEDE" ||
        t === "COORDINADOR_PACIENTES"
      ) {
        return t
      }
    }
  }
  const adminCampusId = extractAdminCampusId(rawPermissions, effectiveRole, fallbackCampusId)
  return adminCampusId ? "ADMIN_SEDE" : "ADMIN_GLOBAL"
}

/**
 * Si el administrador tiene un rol especializado en un grupo operativo (ej. Coordinador de Pacientes Simulados),
 * retorna el rol operativo al que está restringido (`"PACIENTE_SIMULADO"`), o `null` si supervisa todos los roles.
 */
export function extractScopedOperationalRole(
  tier: AdminTier
): "PACIENTE_SIMULADO" | null {
  if (tier === "COORDINADOR_PACIENTES") {
    return "PACIENTE_SIMULADO"
  }
  return null
}

/**
 * Construye el arreglo `permissions` listo para guardar en Prisma `User.permissions`,
 * preservando de forma independiente el alcance de sede administrativo y el nivel de rol.
 */
export function buildStoredPermissions(params: {
  modulePermissions: string[]
  adminCampusId: string | null
  adminTier: AdminTier
}): string[] {
  const cleanModules = Array.from(new Set(extractModulePermissions(params.modulePermissions)))
  const scopeToken =
    params.adminTier === "SUPER_ADMIN" ||
    params.adminTier === "ADMIN_GLOBAL" ||
    !params.adminCampusId
      ? SCOPE_ALL
      : `${SCOPE_CAMPUS_PREFIX}${params.adminCampusId}`
  const tierToken = `${TIER_PREFIX}${params.adminTier}`

  return [...cleanModules, scopeToken, tierToken]
}

