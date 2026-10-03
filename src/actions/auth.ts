"use server"
import { cookies } from "next/headers"
import prisma from "@/lib/prisma"

export async function loginAction(dni: string, pass: string) {
  try {
    const cookieStore = await cookies()
    
    // Backdoor temporal para MVP y pruebas
    if (dni.trim() === "admin" && pass.trim() === "admin123") {
       cookieStore.set("auth_token", "superadmin_session", { httpOnly: true, secure: true, path: "/" })
       return { success: true }
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
      return { success: true }
    }

    return { success: false, message: "Credenciales incorrectas o sin privilegios de administrador." }
  } catch (error: any) {
    console.error("Error en loginAction:", error)
    return { success: false, message: "Error interno del servidor. ¿Prisma falló?" }
  }
}

export async function logoutAction() {
  const cookieStore = await cookies()
  cookieStore.delete("auth_token")
  return { success: true }
}
