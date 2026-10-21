"use server"

import { revalidatePath } from "next/cache"
import prisma from "@/lib/prisma"
import { requireAdmin } from "@/lib/session"
import { Shift, Role } from "@prisma/client"

export type ToleranceRuleInput = {
  id?: string
  name?: string | null
  shift?: Shift | null
  daysOfWeek?: string | null
  campusId?: string | null
  role?: Role | null
  expectedEntryTime: string // "HH:mm"
  earlyEntryToleranceMinutes?: number
  gracePeriodMinutes: number
  lateToleranceMinutes: number
}

/**
 * Guarda o actualiza una regla de tolerancia en la base de datos.
 */
export async function upsertToleranceRuleAction(data: ToleranceRuleInput) {
  try {
    await requireAdmin()

    // Validar hora esperada
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/
    if (!timeRegex.test(data.expectedEntryTime)) {
      return { success: false, message: "El formato de hora debe ser HH:mm (ej: 08:00)" }
    }

    const early = data.earlyEntryToleranceMinutes !== undefined ? Number(data.earlyEntryToleranceMinutes) : 15
    const grace = Number(data.gracePeriodMinutes)
    const late = Number(data.lateToleranceMinutes)

    if (isNaN(early) || early < 0) {
      return { success: false, message: "Los minutos de anticipación permitida no pueden ser negativos." }
    }
    if (isNaN(grace) || grace < 0) {
      return { success: false, message: "Los minutos de gracia no pueden ser negativos." }
    }
    if (isNaN(late) || late < grace) {
      return { success: false, message: "La tolerancia de tardanza debe ser mayor o igual a los minutos de gracia." }
    }

    const cleanCampusId = data.campusId && data.campusId.trim() !== "" ? data.campusId : null
    const cleanRole = data.role ? data.role : null
    const cleanName = data.name && data.name.trim() !== "" ? data.name.trim() : null
    const cleanShift = data.shift ? data.shift : null
    const cleanDays = data.daysOfWeek && data.daysOfWeek.trim() !== "" ? data.daysOfWeek.trim() : null

    // Si tiene ID, actualizamos directamente
    if (data.id) {
      await prisma.toleranceRule.update({
        where: { id: data.id },
        data: {
          name: cleanName,
          shift: cleanShift,
          daysOfWeek: cleanDays,
          campusId: cleanCampusId,
          role: cleanRole,
          expectedEntryTime: data.expectedEntryTime,
          earlyEntryToleranceMinutes: early,
          gracePeriodMinutes: grace,
          lateToleranceMinutes: late,
        },
      })
      revalidatePath("/dashboard")
      return { success: true, message: "Regla de horario actualizada con éxito." }
    }

    // Si no tiene ID, verificamos si ya existe una regla con el mismo alcance (sede + rol + hora/turno + días)
    const existing = await prisma.toleranceRule.findFirst({
      where: {
        campusId: cleanCampusId,
        role: cleanRole,
        expectedEntryTime: data.expectedEntryTime,
        daysOfWeek: cleanDays,
      },
    })

    if (existing) {
      await prisma.toleranceRule.update({
        where: { id: existing.id },
        data: {
          name: cleanName ?? existing.name,
          shift: cleanShift ?? existing.shift,
          daysOfWeek: cleanDays ?? existing.daysOfWeek,
          earlyEntryToleranceMinutes: early,
          gracePeriodMinutes: grace,
          lateToleranceMinutes: late,
        },
      })
      revalidatePath("/dashboard")
      return { success: true, message: "Se actualizó la regla existente para este horario y alcance." }
    }

    await prisma.toleranceRule.create({
      data: {
        name: cleanName,
        shift: cleanShift,
        daysOfWeek: cleanDays,
        campusId: cleanCampusId,
        role: cleanRole,
        expectedEntryTime: data.expectedEntryTime,
        earlyEntryToleranceMinutes: early,
        gracePeriodMinutes: grace,
        lateToleranceMinutes: late,
      },
    })

    revalidatePath("/dashboard")
    return { success: true, message: "Nueva regla de tolerancia creada exitosamente." }
  } catch (error: any) {
    console.error("[upsertToleranceRuleAction]", error)
    return { success: false, message: error.message || "Error al guardar la regla de tolerancia." }
  }
}

/**
 * Elimina una regla de tolerancia.
 */
export async function deleteToleranceRuleAction(id: string) {
  try {
    await requireAdmin()

    await prisma.toleranceRule.delete({
      where: { id },
    })

    revalidatePath("/dashboard")
    return { success: true, message: "Regla de tolerancia eliminada correctamente." }
  } catch (error: any) {
    console.error("[deleteToleranceRuleAction]", error)
    return { success: false, message: error.message || "Error al eliminar la regla." }
  }
}

/**
 * Crea una regla global predeterminada si no existe ninguna.
 */
export async function seedDefaultToleranceRuleAction() {
  try {
    await requireAdmin()

    const existingGlobal = await prisma.toleranceRule.findFirst({
      where: { campusId: null, role: null },
    })

    if (existingGlobal) {
      return { success: false, message: "Ya existe una regla global predeterminada en el sistema." }
    }

    await prisma.toleranceRule.create({
      data: {
        campusId: null,
        role: null,
        expectedEntryTime: "08:00",
        earlyEntryToleranceMinutes: 15,
        gracePeriodMinutes: 10,
        lateToleranceMinutes: 30,
      },
    })

    revalidatePath("/dashboard")
    return { success: true, message: "Regla global creada: Entrada 08:00 AM (Anticipación: 15 min, Gracia: 10 min, Tardanza hasta 30 min)." }
  } catch (error: any) {
    console.error("[seedDefaultToleranceRuleAction]", error)
    return { success: false, message: error.message || "Error al inicializar la regla predeterminada." }
  }
}
