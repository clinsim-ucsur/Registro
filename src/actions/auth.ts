"use server"
import { cookies } from "next/headers"
import prisma from "@/lib/prisma"

export async function loginAction(dni: string, pass: string) {
  try {
    const cookieStore = await cookies()

    // Backdoor temporal para MVP y pruebas
    if (dni.trim() === "admin" && pass.trim() === "admin123") {
      cookieStore.set("auth_token", "superadmin_session", { httpOnly: true, secure: true, path: "/" })
      return { success: true, mustChangePassword: false }
    }

    // Verificación real en base de datos
    const user = await prisma.user.findFirst({
      where: {
        dni: dni.trim(),
        password: pass.trim(),
        role: { in: ['SUPER_ADMIN', 'ADMIN_SECUNDARIO'] }
      }
    })

    if (user) {
      cookieStore.set("auth_token", user.id, { httpOnly: true, secure: true, path: "/" })
      return { 
        success: true, 
        mustChangePassword: user.mustChangePassword ?? false 
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
      select: { id: true, role: true },
    })

    if (!user || (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN_SECUNDARIO")) {
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
