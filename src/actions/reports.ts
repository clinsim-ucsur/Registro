"use server"

import prisma from "@/lib/prisma"
import { requireAdmin } from "@/lib/session"
import { startOfLimaDay, addDaysToKey, isValidDayKey } from "@/lib/timezone"
import { Role, RecordType, RecordStatus } from "@prisma/client"

export type ReportFilterParams = {
  startDate?: string // "YYYY-MM-DD"
  endDate?: string // "YYYY-MM-DD"
  campusId?: string // Campus ID o ""
  role?: Role | "ALL"
  type?: RecordType | "ALL"
  status?: RecordStatus | "ALL"
  search?: string
}

export async function fetchFilteredRecordsAction(filters: ReportFilterParams) {
  try {
    await requireAdmin()

    const where: any = {}

    // Filtro por Fechas (en zona horaria Lima)
    if (filters.startDate && isValidDayKey(filters.startDate)) {
      const gte = startOfLimaDay(filters.startDate)
      where.timestamp = { ...(where.timestamp || {}), gte }
    }
    if (filters.endDate && isValidDayKey(filters.endDate)) {
      // Menor que el inicio del día siguiente para incluir todo el día final
      const lt = startOfLimaDay(addDaysToKey(filters.endDate, 1))
      where.timestamp = { ...(where.timestamp || {}), lt }
    }

    // Filtro por Sede
    if (filters.campusId && filters.campusId.trim() !== "") {
      where.campusId = filters.campusId
    }

    // Filtro por Rol
    if (filters.role && filters.role !== "ALL") {
      where.user = { ...(where.user || {}), role: filters.role }
    }

    // Filtro por Tipo (Entrada / Salida)
    if (filters.type && filters.type !== "ALL") {
      where.type = filters.type
    }

    // Filtro por Estado (A_TIEMPO, TARDANZA, FALTA, EXCEPCION)
    if (filters.status && filters.status !== "ALL") {
      where.status = filters.status
    }

    // Búsqueda por Nombre o DNI
    if (filters.search && filters.search.trim() !== "") {
      const q = filters.search.trim()
      where.user = {
        ...(where.user || {}),
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { dni: { contains: q } },
        ],
      }
    }

    const records = await prisma.attendanceRecord.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: 2000, // Límite amplio para consolidación de reportes
      include: {
        user: { select: { id: true, name: true, dni: true, role: true } },
        campus: { select: { id: true, name: true } },
        course: { select: { id: true, name: true } },
      },
    })

    return { success: true, records }
  } catch (error: any) {
    console.error("[fetchFilteredRecordsAction]", error)
    return { success: false, message: error.message || "Error al consultar registros de asistencia." }
  }
}
