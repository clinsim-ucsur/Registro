"use server"
import { cookies } from "next/headers"
import prisma from "@/lib/prisma"

export async function loginAction(dni: string, pass: string) {
  try {
    const cookieStore = await cookies()

    const cleanInput = dni.trim()
    const cleanPass = pass.trim()

    // Credenciales predeterminadas y principal
    if (
      (cleanInput.toLowerCase() === "admin.clinsim" || cleanInput.toLowerCase() === "admin") && 
      cleanPass === "Simulacion.Ucsur26!"
    ) {
      cookieStore.set("auth_token", "superadmin_session", { httpOnly: true, secure: true, path: "/" })
      return { success: true, mustChangePassword: false }
    }

    // Verificación real en base de datos (por DNI o email/usuario)
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { dni: { equals: cleanInput, mode: "insensitive" } },
          { email: { equals: cleanInput, mode: "insensitive" } },
        ],
        password: cleanPass,
      }
    })

    const hasAdminPrivilege = user && (
      user.adminRole === "SUPER_ADMIN" ||
      user.adminRole === "ADMIN_SECUNDARIO" ||
      user.role === "SUPER_ADMIN" ||
      user.role === "ADMIN_SECUNDARIO"
    )

    if (user && hasAdminPrivilege) {
      cookieStore.set("auth_token", user.id, { httpOnly: true, secure: true, path: "/" })
      return { 
        success: true, 
        mustChangePassword: Boolean(user.mustChangePassword)
      }
    }

    return { success: false, message: "Credenciales incorrectas o sin privilegios de administrador." }
  } catch (error: any) {
    console.error("Error en loginAction:", error)
    return { success: false, message: "Error interno del servidor. ¿Prisma falló?" }
  }
}

export async function changeInitialPasswordAction(newPassword: string) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get("auth_token")?.value
    if (!token) {
      return { success: false, message: "No hay una sesión activa." }
    }

    if (token === "superadmin_session") {
      return { success: true, message: "Contraseña actualizada exitosamente." }
    }

    if (!newPassword || newPassword.trim().length < 6) {
      return { success: false, message: "La nueva contraseña debe tener al menos 6 caracteres." }
    }

    const user = await prisma.user.findUnique({
      where: { id: token },
      select: { id: true, role: true, adminRole: true },
    })

    const isAuthorized = user && (
      user.role === "SUPER_ADMIN" || 
      user.role === "ADMIN_SECUNDARIO" ||
      user.adminRole === "SUPER_ADMIN" ||
      user.adminRole === "ADMIN_SECUNDARIO"
    )

    if (!isAuthorized) {
      return { success: false, message: "Usuario no autorizado." }
    }

    await prisma.user.update({
      where: { id: token },
      data: {
        password: newPassword.trim(),
        mustChangePassword: false,
      },
    })

    return { success: true, message: "¡Tu nueva contraseña definitiva ha sido configurada con éxito!" }
  } catch (error: any) {
    console.error("Error en changeInitialPasswordAction:", error)
    return { success: false, message: "Error al actualizar la contraseña." }
  }
}

export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete("auth_token")
  return { success: true }
}
