"use server"

import prisma from "@/lib/prisma"
import { Role } from "@prisma/client"

export async function bulkUploadUsersAction(data: { name: string, dni: string, role: string, campus?: string }[]) {
  try {
    let insertedCount = 0
    let updatedCount = 0
    let errorCount = 0

    // Obtenemos todas las sedes actuales para no crear duplicados
    const campuses = await prisma.campus.findMany()
    const campusMap = new Map(campuses.map(c => [c.name.trim().toLowerCase(), c.id]))

    for (const item of data) {
      // Validación básica
      if (!item.dni || !item.name) {
        errorCount++
        continue
      }
      
      const dniStr = item.dni.toString().trim()
      if (dniStr.length !== 8) {
        errorCount++
        continue
      }

      // Mapeo seguro de Rol
      const roleRaw = item.role ? item.role.toString().toUpperCase().trim().replace(' ', '_') : 'DOCENTE'
      let userRole: Role = Role.DOCENTE
      if (roleRaw === 'TECNICO' || roleRaw === 'TÉCNICO') userRole = Role.TECNICO
      else if (roleRaw === 'PACIENTE_SIMULADO' || roleRaw === 'PACIENTE') userRole = Role.PACIENTE_SIMULADO
      else if (roleRaw === 'COORDINADOR') userRole = Role.COORDINADOR
      else if (roleRaw === 'SUPER_ADMIN') userRole = Role.SUPER_ADMIN

      // Mapeo y creación de Sede si no existe
      let finalCampusId = null
      if (item.campus) {
        const campusName = item.campus.toString().trim()
        const lookup = campusName.toLowerCase()
        if (campusMap.has(lookup)) {
          finalCampusId = campusMap.get(lookup)
        } else {
           const newCampus = await prisma.campus.create({ data: { name: campusName }})
           campusMap.set(lookup, newCampus.id)
           finalCampusId = newCampus.id
        }
      }

      // Upsert: Si existe actualiza, si no, crea.
      const existing = await prisma.user.findUnique({ where: { dni: dniStr } })
      
      if (existing) {
        await prisma.user.update({
          where: { dni: dniStr },
          data: { name: item.name.toString().trim(), role: userRole, campusId: finalCampusId }
        })
        updatedCount++
      } else {
        await prisma.user.create({
          data: { name: item.name.toString().trim(), dni: dniStr, role: userRole, campusId: finalCampusId }
        })
        insertedCount++
      }
    }

    return { 
      success: true, 
      message: `¡Carga exitosa! ${insertedCount} usuarios creados, ${updatedCount} actualizados. (Errores/Omitidos: ${errorCount})` 
    }

  } catch (error: any) {
    return { success: false, message: error.message || "Error grave al procesar el archivo en el servidor." }
  }
}

// ---------------------------------------------
// CRUD: EDITAR USUARIO
// ---------------------------------------------
import { revalidatePath } from "next/cache"

export async function editUserAction(oldDni: string, data: { name: string, dni: string, role: Role }) {
  try {
    await prisma.user.update({
      where: { dni: oldDni },
      data: {
        name: data.name,
        dni: data.dni,
        role: data.role
      }
    })
    revalidatePath("/dashboard")
    return { success: true, message: "Usuario actualizado correctamente." }
  } catch (error) {
    console.error(error)
    return { success: false, message: "Error al actualizar usuario. ¿Quizá el nuevo DNI ya existe?" }
  }
}

// ---------------------------------------------
// CRUD: CREAR USUARIO INDIVIDUAL
// ---------------------------------------------
export async function createUserAction(data: { name: string, dni: string, role: Role }) {
  try {
    const existing = await prisma.user.findUnique({ where: { dni: data.dni } })
    if (existing) return { success: false, message: "El DNI ya se encuentra registrado." }

    await prisma.user.create({
      data: {
        name: data.name,
        dni: data.dni,
        role: data.role
      }
    })

    revalidatePath("/dashboard")
    return { success: true, message: "Usuario creado con éxito." }
  } catch (error) {
    console.error(error)
    return { success: false, message: "Error crítico al intentar crear el usuario." }
  }
}

// ---------------------------------------------
// CRUD: ELIMINAR USUARIO
// ---------------------------------------------
export async function deleteUserAction(dni: string) {
  try {
    const user = await prisma.user.findUnique({ where: { dni } })
    if (!user) return { success: false, message: "Usuario no encontrado." }

    // Borramos registros asociados primero para no romper la llave foránea
    await prisma.attendanceRecord.deleteMany({ where: { userId: user.id } })
    // Borramos al usuario
    await prisma.user.delete({ where: { id: user.id } })

    revalidatePath("/dashboard")
    return { success: true, message: "Usuario eliminado definitivamente." }
  } catch (error) {
    console.error(error)
    return { success: false, message: "Ocurrió un error al intentar eliminar al usuario." }
  }
}

// ---------------------------------------------
// CRUD: CREAR ADMINISTRADOR
// ---------------------------------------------
export async function createAdminAction(data: { name: string, dni: string, role: Role, password?: string }) {
  try {
    const existing = await prisma.user.findUnique({ where: { dni: data.dni } })
    if (existing) return { success: false, message: "El DNI/Usuario ya existe." }

    await prisma.user.create({
      data: {
        name: data.name,
        dni: data.dni,
        role: data.role,
        password: data.password || null
      }
    })

    revalidatePath("/dashboard")
    return { success: true, message: "Administrador creado exitosamente." }
  } catch (error) {
    return { success: false, message: "Error al crear administrador." }
  }
}

// ---------------------------------------------
// CRUD: EDITAR ADMINISTRADOR
// ---------------------------------------------
export async function editAdminAction(oldDni: string, data: { name: string, dni: string, role: Role, password?: string }) {
  try {
    const updateData: any = {
      name: data.name,
      dni: data.dni,
      role: data.role
    }
    
    // Solo actualiza la contraseña si se ingresó algo
    if (data.password && data.password.trim() !== "") {
      updateData.password = data.password.trim()
    }

    await prisma.user.update({
      where: { dni: oldDni },
      data: updateData
    })
    
    revalidatePath("/dashboard")
    return { success: true, message: "Administrador actualizado." }
  } catch (error) {
    return { success: false, message: "Error al actualizar administrador." }
  }
}
