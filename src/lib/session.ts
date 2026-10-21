import { cookies } from "next/headers"
import prisma from "@/lib/prisma"

export type AdminSession = {
  id: string | null
  name: string
  role: "SUPER_ADMIN" | "ADMIN_SECUNDARIO"
  campusId: string | null
  campusName: string | null
  permissions: string[]
  mustChangePassword?: boolean
}

/**
 * Obtiene el administrador autenticado a partir de la cookie `auth_token`.
 * Devuelve null si no hay sesión válida o si el usuario no es administrador.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("auth_token")?.value
  if (!token) return null

  // Sesión de respaldo (backdoor MVP)
  if (token === "superadmin_session") {
    return {
      id: null,
      name: "Super Admin",
      role: "SUPER_ADMIN",
      campusId: null,
      campusName: null,
      permissions: ["overview", "analytics", "reports", "rules", "users", "catalogs", "admins"],
      mustChangePassword: false,
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: token },
    select: { id: true, name: true, role: true, adminRole: true, permissions: true, campusId: true, mustChangePassword: true, campus: { select: { name: true } } },
  })

  const effectiveAdminRole = (user?.adminRole || (user?.role === "SUPER_ADMIN" || user?.role === "ADMIN_SECUNDARIO" ? user.role : null)) as ("SUPER_ADMIN" | "ADMIN_SECUNDARIO" | null)

  if (!user || !effectiveAdminRole) return null

  return {
    id: user.id,
    name: user.name,
    role: effectiveAdminRole,
    campusId: user.campusId,
    campusName: user.campus?.name ?? null,
    mustChangePassword: Boolean(user.mustChangePassword),
    permissions: effectiveAdminRole === "SUPER_ADMIN" && (!user.permissions || user.permissions.length === 0)
      ? ["overview", "analytics", "reports", "rules", "users", "catalogs", "admins"]
      : (user.permissions ?? []),
  }
}

/** Lanza un error si no hay sesión de administrador. Úsalo dentro de Server Actions. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession()
  if (!session) throw new Error("No autorizado")
  return session
}
