import { cookies } from "next/headers"
import prisma from "@/lib/prisma"

export type AdminSession = {
  id: string | null
  name: string
  role: "SUPER_ADMIN" | "ADMIN_SECUNDARIO"
  campusId: string | null
  campusName: string | null
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
    return { id: null, name: "Super Admin", role: "SUPER_ADMIN", campusId: null, campusName: null }
  }

  const user = await prisma.user.findUnique({
    where: { id: token },
    select: { id: true, name: true, role: true, campusId: true, campus: { select: { name: true } } },
  })

  if (!user || (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN_SECUNDARIO")) return null

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    campusId: user.campusId,
    campusName: user.campus?.name ?? null,
  }
}

/** Lanza un error si no hay sesión de administrador. Úsalo dentro de Server Actions. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession()
  if (!session) throw new Error("No autorizado")
  return session
}
