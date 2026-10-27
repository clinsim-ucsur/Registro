"use server"

import prisma from "@/lib/prisma"
import { Role, Shift } from "@prisma/client"
import { DEFAULT_SHIFT_TIMES } from "@/lib/schedule-constants"

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
      else if (roleRaw === 'COORDINADOR' || roleRaw === 'ADMIN_SECUNDARIO') userRole = Role.ADMIN_SECUNDARIO
      else if (roleRaw === 'SUPER_ADMIN') userRole = Role.SUPER_ADMIN

      // Mapeo inteligente y creación de Sede si no existe
      let finalCampusId = null
      if (item.campus && item.campus.toString().trim() !== "") {
        const campusName = item.campus.toString().trim()
        const cleanLookup = campusName
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/campus\s+/i, "")
          .replace(/sede\s+/i, "")
          .trim()

        // 1. Coincidencia exacta o normalizada
        for (const [cName, cId] of campusMap.entries()) {
          const cleanExisting = cName
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/campus\s+/i, "")
            .replace(/sede\s+/i, "")
            .trim()

          if (cName === campusName.toLowerCase() || cleanExisting === cleanLookup || cleanExisting.includes(cleanLookup) || cleanLookup.includes(cleanExisting)) {
            finalCampusId = cId
            break
          }
        }

        // 2. Si no existió coincidencia previa, crear con nombre adecuado
        if (!finalCampusId) {
          const formattedName = campusName.toLowerCase().startsWith("campus ")
            ? campusName
            : `Campus ${campusName.charAt(0).toUpperCase() + campusName.slice(1)}`
          const newCampus = await prisma.campus.create({ data: { name: formattedName } })
          campusMap.set(formattedName.toLowerCase(), newCampus.id)
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

export async function editUserAction(
  oldDni: string,
  data: {
    name: string
    dni: string
    role: Role
    campusId?: string | null
    defaultShift?: "MANANA" | "INTERMEDIO" | "TARDE" | "NOCHE" | null
  }
) {
  try {
    const updatedUser = await prisma.user.update({
      where: { dni: oldDni },
      data: {
        name: data.name,
        dni: data.dni,
        role: data.role,
        campusId: data.campusId !== undefined ? (data.campusId || null) : undefined,
        defaultShift: data.defaultShift !== undefined ? (data.defaultShift || null) : undefined,
      }
    })

    // Si el usuario es TÉCNICO y se modificó su turno o sede,
    // sincronizar inmediatamente su asignación de HOY en TechnicianSchedule para efecto instantáneo en la marcación
    if ((updatedUser.role === Role.TECNICO || data.role === Role.TECNICO) && (data.defaultShift || data.campusId !== undefined)) {
      const now = new Date()
      const limaDateStr = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now)

      const targetShift = (data.defaultShift || updatedUser.defaultShift || Shift.MANANA) as Shift
      const def = DEFAULT_SHIFT_TIMES[targetShift] || DEFAULT_SHIFT_TIMES.MANANA

      // Buscar si existe regla específica en ToleranceRule para este turno
      const matchingRule = await prisma.toleranceRule.findFirst({
        where: {
          role: Role.TECNICO,
          OR: [
            { shift: targetShift },
            { shift: null },
          ],
        },
        orderBy: [{ campusId: "desc" }],
      })

      const entryTime = matchingRule?.expectedEntryTime || def.entry
      const early = matchingRule?.earlyEntryToleranceMinutes ?? def.early
      const grace = matchingRule?.gracePeriodMinutes ?? def.grace
      const late = matchingRule?.lateToleranceMinutes ?? def.late
      const enableEarly = matchingRule?.enableEarlyTolerance ?? true
      const enableLate = matchingRule?.enableLateTolerance ?? true

      const todaySched = await prisma.technicianSchedule.findUnique({
        where: {
          userId_date: {
            userId: updatedUser.id,
            date: limaDateStr,
          },
        },
      })

      if (todaySched) {
        await prisma.technicianSchedule.update({
          where: { id: todaySched.id },
          data: {
            shift: targetShift,
            expectedEntryTime: entryTime,
            earlyEntryToleranceMinutes: early,
            gracePeriodMinutes: grace,
            lateToleranceMinutes: late,
            enableEarlyTolerance: enableEarly,
            enableLateTolerance: enableLate,
            campusId: updatedUser.campusId || todaySched.campusId,
          },
        })
      }
    }

    try {
      revalidatePath("/dashboard")
      revalidatePath("/")
    } catch (err) {
      // Ignore static generation store missing error outside request context
    }
    return { success: true, message: "Usuario actualizado correctamente." }
  } catch (error) {
    console.error(error)
    return { success: false, message: "Error al actualizar usuario. ¿Quizá el nuevo DNI ya existe?" }
  }
}

// ---------------------------------------------
// CRUD: CREAR USUARIO INDIVIDUAL
// ---------------------------------------------
export async function createUserAction(data: {
  name: string
  dni: string
  role: Role
  campusId?: string | null
  defaultShift?: "MANANA" | "INTERMEDIO" | "TARDE" | "NOCHE" | null
}) {
  try {
    const existing = await prisma.user.findUnique({ where: { dni: data.dni } })
    if (existing) return { success: false, message: "El DNI ya se encuentra registrado." }

    await prisma.user.create({
      data: {
        name: data.name,
        dni: data.dni,
        role: data.role,
        campusId: data.campusId || null,
        defaultShift: data.defaultShift || null,
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
export async function createAdminAction(data: {
  name: string
  dni: string
  role: Role
  password?: string
  campusId?: string | null
  permissions?: string[]
}) {
  try {
    const existing = await prisma.user.findUnique({ where: { dni: data.dni } })

    // Plantilla estándar por defecto si no se especifican permisos manualmente
    let finalPermissions = data.permissions || []
    if (finalPermissions.length === 0) {
      if (data.role === Role.SUPER_ADMIN) {
        finalPermissions = ["overview", "analytics", "reports", "rules", "users", "catalogs", "admins"]
      } else {
        // Plantilla estándar para Admin Secundario: Vista básica, reportes y personal operativo
        finalPermissions = ["overview", "reports", "users"]
      }
    }

    if (existing) {
      // Si el usuario ya existe (por ejemplo docente, paciente o técnico),
      // se le otorga adminRole sin alterar su rol operativo (DOCENTE, TECNICO, PACIENTE_SIMULADO)
      // preservando su historial de marcaciones y su aparición en las listas de personal operativo.
      const newPass = data.password && data.password.trim() !== "" ? data.password.trim() : existing.password
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: data.name || existing.name,
          adminRole: data.role, // Guarda el rol administrativo aquí
          password: newPass,
          mustChangePassword: true,
          campusId: data.campusId !== undefined ? (data.campusId || null) : existing.campusId,
          permissions: finalPermissions,
        }
      })

      revalidatePath("/dashboard")
      return {
        success: true,
        message: `¡Usuario ${existing.name} promovido exitosamente a Administrador con acceso al Dashboard!`
      }
    }

    const cleanPass = data.password && data.password.trim() !== "" ? data.password.trim() : null

    await prisma.user.create({
      data: {
        name: data.name.trim(),
        dni: data.dni.trim(),
        role: data.role,
        adminRole: data.role,
        password: cleanPass,
        mustChangePassword: true,
        campusId: data.campusId || null,
        permissions: finalPermissions,
      }
    })

    revalidatePath("/dashboard")
    return { success: true, message: "Administrador creado exitosamente." }
  } catch (error: any) {
    console.error("[createAdminAction] Error:", error)
    return { success: false, message: error.message || "Error al crear administrador." }
  }
}

// ---------------------------------------------
// CRUD: REVOCAR PRIVILEGIOS DE ADMINISTRADOR
// (Sin eliminar el usuario ni sus asistencias de la BD)
// ---------------------------------------------
export async function revokeAdminAction(dni: string, fallbackRole?: Role) {
  try {
    const user = await prisma.user.findUnique({ where: { dni } })
    if (!user) return { success: false, message: "Usuario no encontrado." }

    const updateData: any = {
      adminRole: null,
      password: null,
      permissions: [],
    }

    // Si el usuario tenía como rol operativo SUPER_ADMIN o ADMIN_SECUNDARIO original,
    // se le asigna el fallbackRole para que no quede con rol admin inválido
    if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN_SECUNDARIO) {
      updateData.role = fallbackRole || Role.PACIENTE_SIMULADO
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    })

    revalidatePath("/dashboard")
    return { success: true, message: `Acceso administrativo revocado para ${user.name}.` }
  } catch (error: any) {
    console.error("[revokeAdminAction] Error:", error)
    return { success: false, message: error.message || "Error al revocar privilegios." }
  }
}

// ---------------------------------------------
// CRUD: EDITAR ADMINISTRADOR
// ---------------------------------------------
export async function editAdminAction(oldDni: string, data: {
  name: string
  dni: string
  role: Role
  password?: string
  campusId?: string | null
  permissions?: string[]
}) {
  try {
    const updateData: any = {
      name: data.name,
      dni: data.dni,
      adminRole: data.role,
    }

    if (data.campusId !== undefined) {
      updateData.campusId = data.campusId || null
    }

    if (data.permissions !== undefined) {
      updateData.permissions = data.permissions
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
  } catch (error: any) {
    console.error("[editAdminAction] Error:", error)
    return { success: false, message: error.message || "Error al actualizar administrador." }
  }
}
