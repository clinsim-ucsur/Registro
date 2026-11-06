import { cookies } from "next/headers"
import prisma from "@/lib/prisma"
import {
  extractAdminCampusId,
  extractAdminTier,
  extractModulePermissions,
  extractScopedOperationalRole,
  type AdminTier,
} from "@/lib/admin-scope"

export type AdminSession = {
  id: string | null
  name: string
  dni: string
  role: "SUPER_ADMIN" | "ADMIN_SECUNDARIO"
  adminTier: AdminTier
  scopedRole: "PACIENTE_SIMULADO" | null
  campusId: string | null
  campusName: string | null
  operationalCampusId: string | null
  operationalRole: string
  permissions: string[]
  mustChangePassword?: boolean
}

/**
 * Obtiene el administrador autenticado a partir de la cookie `auth_token`.
 * Separa la Sede Operativa (`user.campusId` para marcación) de la Sede de Vista Administrativa (`session.campusId`).
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("auth_token")?.value
  if (!token) return null

  // Sesión de respaldo (cuenta maestra)
  if (token === "superadmin_session") {
    return {
      id: null,
      name: "Super Admin Principal",
      dni: "admin.clinsim",
      role: "SUPER_ADMIN",
      adminTier: "SUPER_ADMIN",
      scopedRole: null,
      campusId: null,
      campusName: null,
      operationalCampusId: null,
      operationalRole: "SUPER_ADMIN",
      permissions: ["overview", "analytics", "reports", "rules", "users", "catalogs", "admins", "kiosk", "logs"],
      mustChangePassword: false,
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: token },
    select: {
      id: true,
      name: true,
      dni: true,
      role: true,
      adminRole: true,
      permissions: true,
      campusId: true,
      mustChangePassword: true,
      campus: { select: { name: true } },
    },
  })

  const effectiveAdminRole = (
    user?.adminRole ||
    (user?.role === "SUPER_ADMIN" || user?.role === "ADMIN_SECUNDARIO" ? user.role : null)
  ) as "SUPER_ADMIN" | "ADMIN_SECUNDARIO" | null

  if (!user || !effectiveAdminRole) return null

  const adminTier = extractAdminTier(user.permissions, effectiveAdminRole, user.campusId)
  const adminCampusId = extractAdminCampusId(user.permissions, effectiveAdminRole, user.campusId)
  const scopedRole = extractScopedOperationalRole(adminTier)

  let adminCampusName: string | null = null
  if (adminCampusId) {
    if (adminCampusId === user.campusId && user.campus?.name) {
      adminCampusName = user.campus.name
    } else {
      const foundCampus = await prisma.campus.findUnique({
        where: { id: adminCampusId },
        select: { name: true },
      })
      adminCampusName = foundCampus?.name ?? null
    }
  }

  const cleanModulePerms = extractModulePermissions(user.permissions)

  return {
    id: user.id,
    name: user.name,
    dni: user.dni,
    role: effectiveAdminRole,
    adminTier,
    scopedRole,
    campusId: adminCampusId,
    campusName: adminCampusName,
    operationalCampusId: user.campusId,
    operationalRole: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    permissions:
      effectiveAdminRole === "SUPER_ADMIN"
        ? ["overview", "analytics", "reports", "rules", "users", "catalogs", "admins", "kiosk", "logs"]
        : cleanModulePerms,
  }
}

/** Lanza un error si no hay sesión de administrador. Úsalo dentro de Server Actions. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession()
  if (!session) throw new Error("No autorizado")
  return session
}
