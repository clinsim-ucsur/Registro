"use server"

import prisma from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/session"
import { DEFAULT_CAMPUS_LOCATIONS } from "@/lib/geofence"

// -------------------------------------------------------------
// SEDES (CAMPUSES) CRUD
// -------------------------------------------------------------

export async function getCampusesAction() {
  try {
    const campuses = await prisma.campus.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { users: true, records: true, rules: true }
        }
      }
    })
    return { success: true, campuses }
  } catch (error: any) {
    console.error("[getCampusesAction] Error:", error)
    return { success: false, message: "No se pudieron obtener las sedes.", campuses: [] }
  }
}

export async function createCampusAction(name: string) {
  try {
    await requireAdmin()
    const cleanName = name.trim()
    if (!cleanName) return { success: false, message: "El nombre de la sede es obligatorio." }

    const existing = await prisma.campus.findFirst({
      where: { name: { equals: cleanName, mode: "insensitive" } }
    })
    if (existing) {
      return { success: false, message: "Ya existe una sede con este nombre." }
    }

    const campus = await prisma.campus.create({
      data: { name: cleanName }
    })

    revalidatePath("/dashboard")
    revalidatePath("/")
    return { success: true, message: `Sede "${cleanName}" agregada con éxito.`, campus }
  } catch (error: any) {
    console.error("[createCampusAction] Error:", error)
    return { success: false, message: error.message || "Error al crear la sede." }
  }
}

export async function updateCampusAction(id: string, newName: string) {
  try {
    await requireAdmin()
    const cleanName = newName.trim()
    if (!cleanName) return { success: false, message: "El nombre de la sede es obligatorio." }

    const duplicate = await prisma.campus.findFirst({
      where: { 
        name: { equals: cleanName, mode: "insensitive" },
        NOT: { id }
      }
    })
    if (duplicate) {
      return { success: false, message: "Ya existe otra sede con ese nombre." }
    }

    const campus = await prisma.campus.update({
      where: { id },
      data: { name: cleanName }
    })

    revalidatePath("/dashboard")
    revalidatePath("/")
    return { success: true, message: `Sede actualizada a "${cleanName}".`, campus }
  } catch (error: any) {
    console.error("[updateCampusAction] Error:", error)
    return { success: false, message: error.message || "Error al actualizar la sede." }
  }
}

export async function updateCampusGeoAction(
  id: string,
  geo: { geoEnforced: boolean; latitude: number | null; longitude: number | null; radiusMeters: number }
) {
  try {
    await requireAdmin()
    const { geoEnforced, latitude, longitude } = geo
    const radiusMeters = Math.round(geo.radiusMeters)

    if (geoEnforced && (latitude == null || longitude == null)) {
      return { success: false, message: "Ingrese latitud y longitud para activar el límite por ubicación." }
    }
    if (latitude != null && (latitude < -90 || latitude > 90)) {
      return { success: false, message: "La latitud debe estar entre -90 y 90." }
    }
    if (longitude != null && (longitude < -180 || longitude > 180)) {
      return { success: false, message: "La longitud debe estar entre -180 y 180." }
    }
    if (!Number.isFinite(radiusMeters) || radiusMeters < 30 || radiusMeters > 5000) {
      return { success: false, message: "El radio debe estar entre 30 y 5000 metros." }
    }

    const campus = await prisma.campus.update({
      where: { id },
      data: { geoEnforced, latitude, longitude, radiusMeters },
    })

    revalidatePath("/dashboard")
    revalidatePath("/")
    return {
      success: true,
      message: geoEnforced
        ? `Ubicación activada para "${campus.name}" (radio: ${radiusMeters} m).`
        : `Ubicación desactivada para "${campus.name}".`,
      campus,
    }
  } catch (error: any) {
    console.error("[updateCampusGeoAction] Error:", error)
    return { success: false, message: error.message || "Error al guardar la ubicación de la sede." }
  }
}

export async function toggleCampusGeoAction(id: string, geoEnforced: boolean) {
  try {
    await requireAdmin()
    const current = await prisma.campus.findUnique({ where: { id } })
    if (!current) return { success: false, message: "Sede no encontrada." }

    let lat = current.latitude
    let lng = current.longitude
    let radius = current.radiusMeters || 300

    // Si se activa y no tiene coordenadas, aplicar las coordenadas oficiales predeterminadas
    if (geoEnforced && (lat == null || lng == null)) {
      const def = DEFAULT_CAMPUS_LOCATIONS[current.name]
      if (def) {
        lat = def.latitude
        lng = def.longitude
        radius = def.radiusMeters
      } else {
        return {
          success: false,
          message: "Para activar la geocerca de esta sede, configure primero su latitud y longitud.",
        }
      }
    }

    const campus = await prisma.campus.update({
      where: { id },
      data: {
        geoEnforced,
        latitude: lat,
        longitude: lng,
        radiusMeters: radius,
      },
    })

    revalidatePath("/dashboard")
    revalidatePath("/")
    return {
      success: true,
      message: geoEnforced
        ? `Ubicación GPS activada para "${campus.name}" (${campus.radiusMeters} m).`
        : `Ubicación GPS desactivada para "${campus.name}".`,
      campus,
    }
  } catch (error: any) {
    console.error("[toggleCampusGeoAction] Error:", error)
    return { success: false, message: error.message || "Error al cambiar el estado de ubicación." }
  }
}

export async function toggleAllCampusesGeoAction(geoEnforced: boolean) {
  try {
    await requireAdmin()
    await prisma.campus.updateMany({
      data: { geoEnforced },
    })

    revalidatePath("/dashboard")
    revalidatePath("/")
    return {
      success: true,
      message: geoEnforced
        ? "Ubicación GPS activada para todas las sedes."
        : "Ubicación GPS desactivada para todas las sedes.",
    }
  } catch (error: any) {
    console.error("[toggleAllCampusesGeoAction] Error:", error)
    return { success: false, message: error.message || "Error al actualizar las sedes." }
  }
}

export async function deleteCampusAction(id: string) {
  try {
    await requireAdmin()

    const campus = await prisma.campus.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, records: true, rules: true }
        }
      }
    })

    if (!campus) {
      return { success: false, message: "Sede no encontrada." }
    }

    if (campus._count.records > 0) {
      return {
        success: false,
        message: `No se puede eliminar la sede "${campus.name}" porque tiene ${campus._count.records} registros de asistencia vinculados.`
      }
    }

    if (campus._count.users > 0) {
      return {
        success: false,
        message: `No se puede eliminar la sede "${campus.name}" porque tiene ${campus._count.users} usuarios asignados. Reasígnalos primero.`
      }
    }

    // Si tiene reglas asociadas, limpiamos las reglas de esta sede
    if (campus._count.rules > 0) {
      await prisma.toleranceRule.deleteMany({ where: { campusId: id } })
    }

    await prisma.campus.delete({ where: { id } })

    revalidatePath("/dashboard")
    revalidatePath("/")
    return { success: true, message: `Sede "${campus.name}" eliminada correctamente.` }
  } catch (error: any) {
    console.error("[deleteCampusAction] Error:", error)
    return { success: false, message: error.message || "Error al eliminar la sede." }
  }
}

// -------------------------------------------------------------
// CURSOS (COURSES) CRUD
// -------------------------------------------------------------

export async function getCoursesAction() {
  try {
    const courses = await prisma.course.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { records: true }
        }
      }
    })
    return { success: true, courses }
  } catch (error: any) {
    console.error("[getCoursesAction] Error:", error)
    return { success: false, message: "No se pudieron obtener los cursos.", courses: [] }
  }
}

export async function createCourseAction(name: string) {
  try {
    await requireAdmin()
    const cleanName = name.trim()
    if (!cleanName) return { success: false, message: "El nombre del curso es obligatorio." }

    const existing = await prisma.course.findFirst({
      where: { name: { equals: cleanName, mode: "insensitive" } }
    })
    if (existing) {
      return { success: false, message: "Ya existe un curso con este nombre." }
    }

    const course = await prisma.course.create({
      data: { name: cleanName }
    })

    revalidatePath("/dashboard")
    revalidatePath("/")
    return { success: true, message: `Curso "${cleanName}" creado con éxito.`, course }
  } catch (error: any) {
    console.error("[createCourseAction] Error:", error)
    return { success: false, message: error.message || "Error al crear el curso." }
  }
}

export async function updateCourseAction(id: string, newName: string) {
  try {
    await requireAdmin()
    const cleanName = newName.trim()
    if (!cleanName) return { success: false, message: "El nombre del curso es obligatorio." }

    const duplicate = await prisma.course.findFirst({
      where: { 
        name: { equals: cleanName, mode: "insensitive" },
        NOT: { id }
      }
    })
    if (duplicate) {
      return { success: false, message: "Ya existe otro curso con ese nombre." }
    }

    const course = await prisma.course.update({
      where: { id },
      data: { name: cleanName }
    })

    revalidatePath("/dashboard")
    revalidatePath("/")
    return { success: true, message: `Curso actualizado a "${cleanName}".`, course }
  } catch (error: any) {
    console.error("[updateCourseAction] Error:", error)
    return { success: false, message: error.message || "Error al actualizar el curso." }
  }
}

export async function deleteCourseAction(id: string) {
  try {
    await requireAdmin()

    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        _count: {
          select: { records: true }
        }
      }
    })

    if (!course) {
      return { success: false, message: "Curso no encontrado." }
    }

    if (course._count.records > 0) {
      return {
        success: false,
        message: `No se puede eliminar el curso "${course.name}" porque tiene ${course._count.records} registros de asistencia vinculados.`
      }
    }

    await prisma.course.delete({ where: { id } })

    revalidatePath("/dashboard")
    revalidatePath("/")
    return { success: true, message: `Curso "${course.name}" eliminado correctamente.` }
  } catch (error: any) {
    console.error("[deleteCourseAction] Error:", error)
    return { success: false, message: error.message || "Error al eliminar el curso." }
  }
}
