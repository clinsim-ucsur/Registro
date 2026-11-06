import prisma from "@/lib/prisma"

export type AuditLogCategory =
  | "AUTH"
  | "ADMINS"
  | "USERS"
  | "SCHEDULES"
  | "RULES"
  | "CATALOGS"
  | "KIOSK"

export type AuditLogEntry = {
  id: string
  timestamp: string
  actorName: string
  actorDni: string
  actorRole: string
  category: AuditLogCategory
  action: string
  target?: string
  details: string
}

const AUDIT_LOGS_KEY = "SYSTEM_AUDIT_LOGS"
const MAX_LOGS_STORED = 800

/**
 * Registra un evento en la bitácora de auditoría del sistema (PostgreSQL SystemSetting).
 * Nunca lanza excepciones para no interrumpir la operación principal.
 */
export async function recordAuditLog(params: {
  actorName: string
  actorDni?: string
  actorRole?: string
  category: AuditLogCategory
  action: string
  target?: string
  details: string
}): Promise<void> {
  try {
    const newEntry: AuditLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      actorName: params.actorName || "Sistema",
      actorDni: params.actorDni || "—",
      actorRole: params.actorRole || "SUPER_ADMIN",
      category: params.category,
      action: params.action,
      target: params.target,
      details: params.details,
    }

    const existing = await prisma.systemSetting.findUnique({
      where: { key: AUDIT_LOGS_KEY },
    })

    let list: AuditLogEntry[] = []
    if (existing?.value) {
      try {
        const parsed = JSON.parse(existing.value)
        if (Array.isArray(parsed)) list = parsed
      } catch {
        list = []
      }
    }

    const updated = [newEntry, ...list].slice(0, MAX_LOGS_STORED)

    await prisma.systemSetting.upsert({
      where: { key: AUDIT_LOGS_KEY },
      update: {
        value: JSON.stringify(updated),
        description: "Historial de auditoría y eventos de seguridad del sistema",
      },
      create: {
        key: AUDIT_LOGS_KEY,
        value: JSON.stringify(updated),
        description: "Historial de auditoría y eventos de seguridad del sistema",
      },
    })
  } catch (error) {
    console.error("[recordAuditLog] Error:", error)
  }
}

/**
 * Obtiene todos los registros de auditoría almacenados.
 * Si aún no hay registros previos, reconstruye los eventos iniciales a partir de la base de datos.
 */
export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  try {
    const existing = await prisma.systemSetting.findUnique({
      where: { key: AUDIT_LOGS_KEY },
    })

    if (existing?.value) {
      try {
        const parsed = JSON.parse(existing.value)
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
        }
      } catch {}
    }

    // Semilla inicial de auditoría basada en cuentas de administradores y reglas actuales
    const [admins, rules] = await Promise.all([
      prisma.user.findMany({
        where: {
          OR: [
            { adminRole: { not: null } },
            { role: { in: ["SUPER_ADMIN", "ADMIN_SECUNDARIO"] } },
          ],
        },
        include: { campus: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.toleranceRule.findMany({
        include: { campus: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
    ])

    const seeded: AuditLogEntry[] = []

    for (const a of admins) {
      const effRole = a.adminRole || a.role
      seeded.push({
        id: `seed_admin_${a.id}`,
        timestamp: a.updatedAt.toISOString(),
        actorName: "Jean Pieer Pinchi Bernuy Ortiz",
        actorDni: "72455873",
        actorRole: "SUPER_ADMIN",
        category: "ADMINS",
        action: "Configuración de Cuenta Administrativa",
        target: `${a.name} (${a.dni})`,
        details: `Rol administrativo activo: ${effRole === "SUPER_ADMIN" ? "Super Admin" : "Administrador"} | Rol base: ${a.role}`,
      })
    }

    for (const r of rules) {
      seeded.push({
        id: `seed_rule_${r.id}`,
        timestamp: r.updatedAt.toISOString(),
        actorName: "Jean Pieer Pinchi Bernuy Ortiz",
        actorDni: "72455873",
        actorRole: "SUPER_ADMIN",
        category: "RULES",
        action: "Regla de Horario / Tolerancia",
        target: r.name || `Regla ${r.shift || "General"}`,
        details: `Entrada oficial: ${r.expectedEntryTime} | Gracia: ${r.gracePeriodMinutes}m | Tolerancia máx: ${r.lateToleranceMinutes}m (${r.campus?.name || "Todas las sedes"})`,
      })
    }

    seeded.sort((x, y) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime())

    if (seeded.length > 0) {
      await prisma.systemSetting.upsert({
        where: { key: AUDIT_LOGS_KEY },
        update: { value: JSON.stringify(seeded) },
        create: {
          key: AUDIT_LOGS_KEY,
          value: JSON.stringify(seeded),
          description: "Historial de auditoría y eventos de seguridad del sistema",
        },
      })
    }

    return seeded
  } catch (error) {
    console.error("[getAuditLogs] Error:", error)
    return []
  }
}

