"use server"

import prisma from "@/lib/prisma"
import { Role, Shift } from "@prisma/client"
import { DEFAULT_SHIFT_TIMES } from "@/lib/schedule-constants"
import { revalidatePath } from "next/cache"
import { getAdminSession } from "@/lib/session"
import { recordAuditLog } from "@/lib/audit-log"
import {
  buildStoredPermissions,
  extractModulePermissions,
  type AdminTier,
} from "@/lib/admin-scope"

export async function bulkUploadUsersAction(data: { name: string, dni: string, role: string, campus?: string }[]) {
  try {
    let insertedCount = 0
    let updatedCount = 0
    let errorCount = 0

    const session = await getAdminSession().catch(() => null)
    const lockedRole = session?.scopedRole

    // Obtenemos todas las sedes y usuarios existentes en lote para evitar consultas repetitivas
    const dnis = data.map((d) => d.dni?.toString().trim()).filter((d) => d && d.length === 8)
    const [campuses, existingUsers] = await Promise.all([
      prisma.campus.findMany(),
      prisma.user.findMany({
        where: { dni: { in: dnis } },
        select: { id: true, dni: true },
      }),
    ])

    const campusMap = new Map(campuses.map(c => [c.name.trim().toLowerCase(), c.id]))
    const existingDniSet = new Set(existingUsers.map((u) => u.dni))
    const writeOperations: (() => Promise<any>)[] = []

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

      // Mapeo seguro de Rol (Si es Coordinador de Pacientes Simulados, fuerza PACIENTE_SIMULADO)
      const roleRaw = item.role ? item.role.toString().toUpperCase().trim().replace(' ', '_') : 'DOCENTE'
      let userRole: Role = Role.DOCENTE
      if (lockedRole === "PACIENTE_SIMULADO") {
        userRole = Role.PACIENTE_SIMULADO
      } else if (roleRaw === 'TECNICO' || roleRaw === 'TÉCNICO') userRole = Role.TECNICO
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

      // Encolar operaciones concurrentes
      if (existingDniSet.has(dniStr)) {
        writeOperations.push(() =>
          prisma.user.update({
            where: { dni: dniStr },
            data: { name: item.name.toString().trim(), role: userRole, campusId: finalCampusId },
          })
        )
        updatedCount++
      } else {
        writeOperations.push(() =>
          prisma.user.create({
            data: { name: item.name.toString().trim(), dni: dniStr, role: userRole, campusId: finalCampusId },
          })
        )
        insertedCount++
      }
    }

    // Ejecutar en lotes concurrentes para optimizar tiempos de respuesta
    const BATCH_SIZE = 25
    for (let i = 0; i < writeOperations.length; i += BATCH_SIZE) {
      await Promise.all(writeOperations.slice(i, i + BATCH_SIZE).map((fn) => fn()))
    }

    await recordAuditLog({
      actorName: session?.name || "Administrador",
      actorDni: session?.dni || "—",
      actorRole: session?.role || "SUPER_ADMIN",
      category: "USERS",
      action: "Carga Masiva de Personal (Excel)",
      details: `${insertedCount} usuarios nuevos creados y ${updatedCount} actualizados (Omitidos: ${errorCount}).`,
    })

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
    const session = await getAdminSession().catch(() => null)
    const effectiveRole = session?.scopedRole === "PACIENTE_SIMULADO" ? Role.PACIENTE_SIMULADO : data.role

    const updatedUser = await prisma.user.update({
      where: { dni: oldDni },
      data: {
        name: data.name,
        dni: data.dni,
        role: effectiveRole,
        campusId: data.campusId !== undefined ? (data.campusId || null) : undefined,
        defaultShift: data.defaultShift !== undefined ? (data.defaultShift || null) : undefined,
      }
    })

    // Si el usuario es TÉCNICO y se modificó su turno o sede,
    // sincronizar inmediatamente su asignación de HOY en TechnicianSchedule para efecto instantáneo en la marcación
    if ((updatedUser.role === Role.TECNICO || effectiveRole === Role.TECNICO) && (data.defaultShift || data.campusId !== undefined)) {
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

    await recordAuditLog({
      actorName: session?.name || "Administrador",
      actorDni: session?.dni || "—",
      actorRole: session?.role || "SUPER_ADMIN",
      category: "USERS",
      action: "Edición de Personal Operativo",
      target: `${data.name} (${data.dni})`,
      details: `Rol operativo: ${effectiveRole}${data.defaultShift ? ` | Turno: ${data.defaultShift}` : ""}`,
    })

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
    const session = await getAdminSession().catch(() => null)
    const effectiveRole = session?.scopedRole === "PACIENTE_SIMULADO" ? Role.PACIENTE_SIMULADO : data.role

    const existing = await prisma.user.findUnique({ where: { dni: data.dni } })
    if (existing) return { success: false, message: "El DNI ya se encuentra registrado." }

    await prisma.user.create({
      data: {
        name: data.name,
        dni: data.dni,
        role: effectiveRole,
        campusId: data.campusId || null,
        defaultShift: data.defaultShift || null,
      }
    })

    await recordAuditLog({
      actorName: session?.name || "Administrador",
      actorDni: session?.dni || "—",
      actorRole: session?.role || "SUPER_ADMIN",
      category: "USERS",
      action: "Registro de Nuevo Personal Operativo",
      target: `${data.name} (${data.dni})`,
      details: `Alta manual con rol operativo: ${effectiveRole}.`,
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

    const session = await getAdminSession().catch(() => null)
    await recordAuditLog({
      actorName: session?.name || "Administrador",
      actorDni: session?.dni || "—",
      actorRole: session?.role || "SUPER_ADMIN",
      category: "USERS",
      action: "Baja de Personal Operativo",
      target: `${user.name} (${user.dni})`,
      details: `Se eliminó la ficha del colaborador (${user.role}).`,
    })

    revalidatePath("/dashboard")
    return { success: true, message: "Usuario eliminado definitivamente." }
  } catch (error) {
    console.error(error)
    return { success: false, message: "Ocurrió un error al intentar eliminar al usuario." }
  }
}

// ---------------------------------------------
// CRUD: CREAR ADMINISTRADOR (CON ALCANCE DE SEDE INDEPENDIENTE Y NIVELES)
// ---------------------------------------------
export async function createAdminAction(data: {
  name: string
  dni: string
  role: Role
  adminTier?: AdminTier
  password?: string
  campusId?: string | null
  permissions?: string[]
}) {
  try {
    const session = await getAdminSession().catch(() => null)

    // Determinar el nivel administrativo solicitado
    const requestedTier: AdminTier =
      data.adminTier ||
      (data.role === Role.SUPER_ADMIN
        ? "SUPER_ADMIN"
        : data.campusId
        ? "ADMIN_SEDE"
        : "ADMIN_GLOBAL")

    const effectiveAdminRole: Role =
      requestedTier === "SUPER_ADMIN" ? Role.SUPER_ADMIN : Role.ADMIN_SECUNDARIO

    // REGLA DE JERARQUÍA: Solo un SUPER_ADMIN puede designar nuevos SUPER_ADMIN
    if (effectiveAdminRole === Role.SUPER_ADMIN && session && session.role !== "SUPER_ADMIN") {
      return {
        success: false,
        message:
          "Acceso denegado: Solo un Super Administrador con acceso total puede designar cuentas de rango Super Admin.",
      }
    }

    if (requestedTier === "ADMIN_SEDE" && !data.campusId) {
      return {
        success: false,
        message: "Para el rol 'Admin por Sede' debe seleccionar la sede que administrará.",
      }
    }

    const existing = await prisma.user.findUnique({ where: { dni: data.dni } })

    let baseModules = extractModulePermissions(data.permissions)
    if (baseModules.length === 0) {
      if (requestedTier === "SUPER_ADMIN") {
        baseModules = ["overview", "analytics", "reports", "rules", "users", "catalogs", "admins", "kiosk", "logs"]
      } else if (requestedTier === "ADMIN_GLOBAL") {
        baseModules = ["overview", "analytics", "reports", "rules", "users", "catalogs"]
      } else {
        baseModules = ["overview", "analytics", "reports", "users"]
      }
    }

    // Los roles no-SuperAdmin nunca pueden tener el módulo de logs de auditoría
    if (requestedTier !== "SUPER_ADMIN") {
      baseModules = baseModules.filter((m) => m !== "logs")
    }

    const targetAdminCampusId =
      requestedTier === "SUPER_ADMIN" || requestedTier === "ADMIN_GLOBAL"
        ? null
        : data.campusId || null

    const storedPermissions = buildStoredPermissions({
      modulePermissions: baseModules,
      adminCampusId: targetAdminCampusId,
      adminTier: requestedTier,
    })

    if (existing) {
      // Si el usuario ya existe (por ejemplo TÉCNICO, DOCENTE o PACIENTE_SIMULADO),
      // se le otorga adminRole y su alcance de sede administrativo en `permissions`,
      // SIN alterar su `role` operativo ni su `campusId` operativo (ej. Técnico de Campus Villa).
      const isPureAdmin =
        existing.role === Role.SUPER_ADMIN || existing.role === Role.ADMIN_SECUNDARIO

      const newPass =
        data.password && data.password.trim() !== ""
          ? data.password.trim()
          : existing.password

      await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: data.name || existing.name,
          adminRole: effectiveAdminRole,
          ...(isPureAdmin ? { role: effectiveAdminRole, campusId: targetAdminCampusId } : {}),
          password: newPass,
          mustChangePassword: true,
          permissions: storedPermissions,
        },
      })

      await recordAuditLog({
        actorName: session?.name || "Super Admin",
        actorDni: session?.dni || "—",
        actorRole: session?.role || "SUPER_ADMIN",
        category: "ADMINS",
        action: "Promoción a Administrador",
        target: `${existing.name} (${existing.dni})`,
        details: `Nivel asignado: ${requestedTier} | Alcance Admin: ${targetAdminCampusId ? "Sede específica" : "Todas las sedes"} (Sede operativa ${existing.role} preservada).`,
      })

      const tierFriendlyName =
        requestedTier === "SUPER_ADMIN"
          ? "Super Admin"
          : requestedTier === "ADMIN_GLOBAL"
          ? "Admin General"
          : requestedTier === "COORDINADOR_PACIENTES"
          ? "Coordinador de Pacientes Simulados"
          : "Admin por Sede"

      revalidatePath("/dashboard")
      return {
        success: true,
        message: `¡Usuario ${existing.name} promovido a ${tierFriendlyName} sin alterar su perfil operativo!`,
      }
    }

    const cleanPass = data.password && data.password.trim() !== "" ? data.password.trim() : null

    // Si es un administrativo neto nuevo, su role y adminRole son administrativos (nunca PACIENTE_SIMULADO)
    await prisma.user.create({
      data: {
        name: data.name.trim(),
        dni: data.dni.trim(),
        role: effectiveAdminRole,
        adminRole: effectiveAdminRole,
        password: cleanPass,
        mustChangePassword: true,
        campusId: targetAdminCampusId,
        permissions: storedPermissions,
      },
    })

    await recordAuditLog({
      actorName: session?.name || "Super Admin",
      actorDni: session?.dni || "—",
      actorRole: session?.role || "SUPER_ADMIN",
      category: "ADMINS",
      action: "Creación de Administrador Neto",
      target: `${data.name.trim()} (${data.dni.trim()})`,
      details: `Nivel asignado: ${requestedTier} | Alcance: ${targetAdminCampusId ? "Sede asignada" : "Todas las sedes"}`,
    })

    revalidatePath("/dashboard")
    return { success: true, message: "Cuenta administrativa creada exitosamente." }
  } catch (error: any) {
    console.error("[createAdminAction] Error:", error)
    return { success: false, message: error.message || "Error al crear administrador." }
  }
}

// ---------------------------------------------
// CRUD: REVOCAR PRIVILEGIOS DE ADMINISTRADOR
// (Corrige el bug que convertía administrativos netos en PACIENTE_SIMULADO)
// ---------------------------------------------
export async function revokeAdminAction(dni: string) {
  try {
    const session = await getAdminSession().catch(() => null)
    const user = await prisma.user.findUnique({
      where: { dni },
      include: { _count: { select: { records: true } } },
    })
    if (!user) return { success: false, message: "Usuario no encontrado." }

    const targetIsSuperAdmin =
      user.adminRole === Role.SUPER_ADMIN || user.role === Role.SUPER_ADMIN
    if (targetIsSuperAdmin && session && session.role !== "SUPER_ADMIN") {
      return {
        success: false,
        message: "Solo un Super Administrador puede revocar a otro Super Administrador.",
      }
    }

    const isPureAdmin =
      user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN_SECUNDARIO

    if (isPureAdmin) {
      // Si es un administrativo neto (no es docente, ni técnico, ni paciente simulado):
      // Si no tiene asistencias operativas, eliminamos la cuenta administrativa para que NUNCA pase a la lista de Pacientes.
      if (user._count.records === 0) {
        await prisma.user.delete({ where: { id: user.id } })
      } else {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            role: Role.ADMIN_SECUNDARIO,
            adminRole: null,
            password: null,
            permissions: [],
          },
        })
      }
    } else {
      // Si es un Técnico, Docente o Paciente Simulado que tenía permisos de Admin,
      // solo le quitamos el acceso al Dashboard conservando intacto su rol y sede operativa.
      await prisma.user.update({
        where: { id: user.id },
        data: {
          adminRole: null,
          password: null,
          permissions: [],
        },
      })
    }

    await recordAuditLog({
      actorName: session?.name || "Super Admin",
      actorDni: session?.dni || "—",
      actorRole: session?.role || "SUPER_ADMIN",
      category: "ADMINS",
      action: "Revocación de Privilegios Administrativos",
      target: `${user.name} (${user.dni})`,
      details: isPureAdmin
        ? "Se dio de baja la cuenta administrativa neta."
        : `Se retiró el acceso administrativo preservando su ficha operativa (${user.role}).`,
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
// (Preserva intacta la sede operativa de Técnicos/Docentes/Pacientes)
// ---------------------------------------------
export async function editAdminAction(
  oldDni: string,
  data: {
    name: string
    dni: string
    role: Role
    adminTier?: AdminTier
    password?: string
    campusId?: string | null
    permissions?: string[]
  }
) {
  try {
    const session = await getAdminSession().catch(() => null)
    const existing = await prisma.user.findUnique({ where: { dni: oldDni } })
    if (!existing) {
      return { success: false, message: "Administrador no encontrado." }
    }

    const requestedTier: AdminTier =
      data.adminTier ||
      (data.role === Role.SUPER_ADMIN
        ? "SUPER_ADMIN"
        : data.campusId
        ? "ADMIN_SEDE"
        : "ADMIN_GLOBAL")

    const effectiveAdminRole: Role =
      requestedTier === "SUPER_ADMIN" ? Role.SUPER_ADMIN : Role.ADMIN_SECUNDARIO

    const existingWasSuperAdmin =
      existing.adminRole === Role.SUPER_ADMIN || existing.role === Role.SUPER_ADMIN

    // Solo un SUPER_ADMIN puede otorgar o modificar cuentas SUPER_ADMIN
    if (
      (effectiveAdminRole === Role.SUPER_ADMIN || existingWasSuperAdmin) &&
      session &&
      session.role !== "SUPER_ADMIN"
    ) {
      return {
        success: false,
        message:
          "Acceso denegado: Solo un Super Administrador puede modificar o asignar el rango de Super Admin.",
      }
    }

    if (requestedTier === "ADMIN_SEDE" && !data.campusId) {
      return {
        success: false,
        message: "Para el rol 'Admin por Sede' debe seleccionar una sede asignada.",
      }
    }

    const targetAdminCampusId =
      requestedTier === "SUPER_ADMIN" || requestedTier === "ADMIN_GLOBAL"
        ? null
        : data.campusId || null

    let cleanModules = extractModulePermissions(data.permissions ?? existing.permissions)
    if (requestedTier !== "SUPER_ADMIN") {
      cleanModules = cleanModules.filter((m) => m !== "logs")
    }

    const storedPermissions = buildStoredPermissions({
      modulePermissions: cleanModules,
      adminCampusId: targetAdminCampusId,
      adminTier: requestedTier,
    })

    const isPureAdmin =
      existing.role === Role.SUPER_ADMIN || existing.role === Role.ADMIN_SECUNDARIO

    const updateData: any = {
      name: data.name,
      dni: data.dni,
      adminRole: effectiveAdminRole,
      permissions: storedPermissions,
    }

    // IMPORTANTE: Solo si es un administrativo neto actualizamos `user.campusId` y `user.role`.
    // Si es un Técnico, Docente o Paciente Simulado (ej. Jean Pieer Técnico de Campus Villa),
    // SU `user.campusId` OPERATIVO NO SE TOCA NUNCA al cambiar qué sede ve como Admin.
    if (isPureAdmin) {
      updateData.role = effectiveAdminRole
      updateData.campusId = targetAdminCampusId
    }

    if (data.password && data.password.trim() !== "") {
      updateData.password = data.password.trim()
    }

    await prisma.user.update({
      where: { dni: oldDni },
      data: updateData,
    })

    await recordAuditLog({
      actorName: session?.name || "Super Admin",
      actorDni: session?.dni || "—",
      actorRole: session?.role || "SUPER_ADMIN",
      category: "ADMINS",
      action: "Actualización de Permisos / Alcance de Admin",
      target: `${data.name} (${data.dni})`,
      details: `Nivel: ${requestedTier} | Vista Admin: ${targetAdminCampusId ? "Sede específica" : "Todas las sedes"} | Módulos: ${cleanModules.join(", ")}`,
    })

    revalidatePath("/dashboard")
    return { success: true, message: "Configuración del administrador actualizada." }
  } catch (error: any) {
    console.error("[editAdminAction] Error:", error)
    return { success: false, message: error.message || "Error al actualizar administrador." }
  }
}
