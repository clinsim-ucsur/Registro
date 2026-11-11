"use server"

import { Role } from "@prisma/client"
import prisma from "@/lib/prisma"
import {
  fetchDailyProgramSessions,
  forceRefreshDailyProgramSessions,
  getDailyProgramSyncMeta,
  matchDailyProgramFromSessions,
  resolveUserModulesState,
  getCurrentLimaMinutes,
  isSamePersonName,
  formatAmbienteName,
  type NormalizedProgramSession,
  type ResolvedModuleStatus,
  type TodayAttendanceRecordLite,
} from "@/lib/daily-program-api"
import { invalidateAttendanceDirectoryCache } from "@/actions/attendance"

export interface LivePersonScheduleItem {
  key: string
  excelName: string
  dbUser: {
    id: string
    name: string
    dni: string
    campusName: string | null
  } | null
  role: "PACIENTE_SIMULADO" | "DOCENTE"
  campusName: string
  entryTime: string
  exitTime: string
  rawSessionCount: number
  mergedModuleCount: number
  modules: ResolvedModuleStatus[]
  rawModules: {
    horaInicio: string
    horaFin: string
    ambiente: string
    piso: string
    sesion: string
    courseName: string
    campusName: string
  }[]
  todayRecordsCount: number
  lastRecordType: "ENTRADA" | "SALIDA" | null
  currentStatus: "COMPLETADO" | "EN_CURSO" | "PENDIENTE"
}

export interface LiveDailyProgramOverviewResponse {
  success: boolean
  syncedAtIso: string
  source: "API_1_JSON_LIVE" | "API_2_CSV_BACKUP" | "NONE"
  totalRawSessions: number
  currentLimaTimeStr: string
  patients: LivePersonScheduleItem[]
  docentes: LivePersonScheduleItem[]
  rawSessions: {
    horaInicio: string
    horaFin: string
    piso: string
    ambiente: string
    sesion: string
    courseName: string
    campusName: string
    docenteLider: string
    docentesColaboradores: string
    pacientesEstandarizados: string
  }[]
}

function splitNamesFromCell(cell: string): string[] {
  if (!cell || !cell.trim()) return []
  return cell
    .split(/\s*(?:\/|;|\||\n|\r)+\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !/^(ninguno|no aplica|n\/a|-+|\.+)$/i.test(s))
}

export async function getLiveDailyProgramOverviewAction(
  forceRefresh = false,
  campusFilterName?: string | null
): Promise<LiveDailyProgramOverviewResponse> {
  try {
    const sessions: NormalizedProgramSession[] = forceRefresh
      ? await forceRefreshDailyProgramSessions()
      : await fetchDailyProgramSessions(3500, true)

    if (forceRefresh) {
      await invalidateAttendanceDirectoryCache()
    }

    const syncMeta = getDailyProgramSyncMeta()
    const now = new Date()
    const currentLimaMins = getCurrentLimaMinutes(now)
    const currentLimaTimeStr = new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now)

    const limaOffset = -5 * 60 * 60 * 1000
    const limaToday = new Date(now.getTime() + limaOffset)
    limaToday.setUTCHours(0, 0, 0, 0)
    const startOfDayUTC = new Date(limaToday.getTime() - limaOffset)
    const endOfDayUTC = new Date(startOfDayUTC.getTime() + 24 * 60 * 60 * 1000)

    const [dbUsers, todayRecords] = await Promise.all([
      prisma.user.findMany({
        where: {
          role: { in: [Role.PACIENTE_SIMULADO, Role.DOCENTE] },
        },
        select: {
          id: true,
          name: true,
          dni: true,
          role: true,
          campus: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      }),
      prisma.attendanceRecord.findMany({
        where: {
          timestamp: { gte: startOfDayUTC, lt: endOfDayUTC },
        },
        orderBy: { timestamp: "asc" },
        select: {
          userId: true,
          type: true,
          timestamp: true,
          course: { select: { name: true } },
        },
      }),
    ])

    const recordsByUserId = new Map<string, TodayAttendanceRecordLite[]>()
    for (const r of todayRecords) {
      const list = recordsByUserId.get(r.userId) || []
      list.push({
        type: r.type,
        timestamp: r.timestamp.toISOString(),
        courseName: r.course?.name || null,
      })
      recordsByUserId.set(r.userId, list)
    }

    const dbPatients = dbUsers.filter((u) => u.role === Role.PACIENTE_SIMULADO)
    const dbDocentes = dbUsers.filter((u) => u.role === Role.DOCENTE)

    // 1. Extraer todos los nombres únicos de Pacientes Simulados que figuran hoy en el Excel
    const distinctPatientExcelNames: string[] = []
    for (const s of sessions) {
      const names = splitNamesFromCell(s.pacientesEstandarizados)
      for (const candidate of names) {
        const alreadyAdded = distinctPatientExcelNames.some((existing) =>
          isSamePersonName(existing, candidate)
        )
        if (!alreadyAdded) {
          distinctPatientExcelNames.push(candidate)
        }
      }
    }

    // 2. Construir la programación de cada Paciente Simulado del día
    const patientsList: LivePersonScheduleItem[] = []
    const matchedDbPatientIds = new Set<string>()

    for (const excelName of distinctPatientExcelNames) {
      const matchedDb =
        dbPatients.find((u) => isSamePersonName(u.name, excelName)) || null
      if (matchedDb) {
        matchedDbPatientIds.add(matchedDb.id)
      }

      const lookupName = matchedDb ? matchedDb.name : excelName
      const defaultCampus = matchedDb?.campus?.name || "Campus Villa"
      const prog = matchDailyProgramFromSessions(
        sessions,
        lookupName,
        Role.PACIENTE_SIMULADO,
        defaultCampus
      )

      if (!prog.found || prog.sessions.length === 0) continue
      if (
        campusFilterName &&
        prog.campusName.toLowerCase() !== campusFilterName.toLowerCase()
      ) {
        continue
      }

      const userRecs = matchedDb ? recordsByUserId.get(matchedDb.id) || [] : []
      const resolution = resolveUserModulesState(
        prog.sessions,
        userRecs,
        currentLimaMins,
        Role.PACIENTE_SIMULADO
      )

      const hasInCourse = resolution.modules.some((m) => m.status === "EN_CURSO")
      const allDone =
        resolution.modules.length > 0 &&
        resolution.modules.every((m) => m.status === "COMPLETADO")
      const lastRec = userRecs.length > 0 ? userRecs[userRecs.length - 1] : null

      patientsList.push({
        key: matchedDb ? `db_${matchedDb.id}` : `excel_pat_${excelName}`,
        excelName,
        dbUser: matchedDb
          ? {
              id: matchedDb.id,
              name: matchedDb.name,
              dni: matchedDb.dni,
              campusName: matchedDb.campus?.name || null,
            }
          : null,
        role: "PACIENTE_SIMULADO",
        campusName: prog.campusName,
        entryTime: prog.entryTime,
        exitTime: prog.exitTime,
        rawSessionCount: prog.sessions.length,
        mergedModuleCount: resolution.modules.length,
        modules: resolution.modules.map((m) => ({
          ...m,
          ambiente: formatAmbienteName(m.ambiente),
        })),
        rawModules: prog.sessions.map((s) => ({
          horaInicio: s.horaInicio,
          horaFin: s.horaFin,
          ambiente: formatAmbienteName(s.ambiente),
          piso: s.piso,
          sesion: s.sesion,
          courseName: s.courseName,
          campusName: s.campusName,
        })),
        todayRecordsCount: userRecs.length,
        lastRecordType: lastRec?.type ?? null,
        currentStatus: allDone ? "COMPLETADO" : hasInCourse ? "EN_CURSO" : "PENDIENTE",
      })
    }

    // 3. Extraer todos los nombres únicos de Docentes que figuran hoy en el Excel
    const distinctDocenteExcelNames: string[] = []
    for (const s of sessions) {
      const names = [
        ...splitNamesFromCell(s.docenteLider),
        ...splitNamesFromCell(s.docentesColaboradores),
      ]
      for (const candidate of names) {
        const alreadyAdded = distinctDocenteExcelNames.some((existing) =>
          isSamePersonName(existing, candidate)
        )
        if (!alreadyAdded) {
          distinctDocenteExcelNames.push(candidate)
        }
      }
    }

    const docentesList: LivePersonScheduleItem[] = []
    for (const excelName of distinctDocenteExcelNames) {
      const matchedDb =
        dbDocentes.find((u) => isSamePersonName(u.name, excelName)) || null
      const lookupName = matchedDb ? matchedDb.name : excelName
      const defaultCampus = matchedDb?.campus?.name || "Campus Villa"
      const prog = matchDailyProgramFromSessions(
        sessions,
        lookupName,
        Role.DOCENTE,
        defaultCampus
      )

      if (!prog.found || prog.sessions.length === 0) continue
      if (
        campusFilterName &&
        prog.campusName.toLowerCase() !== campusFilterName.toLowerCase()
      ) {
        continue
      }

      const userRecs = matchedDb ? recordsByUserId.get(matchedDb.id) || [] : []
      const resolution = resolveUserModulesState(
        prog.sessions,
        userRecs,
        currentLimaMins,
        Role.DOCENTE
      )

      const hasInCourse = resolution.modules.some((m) => m.status === "EN_CURSO")
      const allDone =
        resolution.modules.length > 0 &&
        resolution.modules.every((m) => m.status === "COMPLETADO")
      const lastRec = userRecs.length > 0 ? userRecs[userRecs.length - 1] : null

      docentesList.push({
        key: matchedDb ? `db_${matchedDb.id}` : `excel_doc_${excelName}`,
        excelName,
        dbUser: matchedDb
          ? {
              id: matchedDb.id,
              name: matchedDb.name,
              dni: matchedDb.dni,
              campusName: matchedDb.campus?.name || null,
            }
          : null,
        role: "DOCENTE",
        campusName: prog.campusName,
        entryTime: prog.entryTime,
        exitTime: prog.exitTime,
        rawSessionCount: prog.sessions.length,
        mergedModuleCount: resolution.modules.length,
        modules: resolution.modules.map((m) => ({
          ...m,
          ambiente: formatAmbienteName(m.ambiente),
        })),
        rawModules: prog.sessions.map((s) => ({
          horaInicio: s.horaInicio,
          horaFin: s.horaFin,
          ambiente: formatAmbienteName(s.ambiente),
          piso: s.piso,
          sesion: s.sesion,
          courseName: s.courseName,
          campusName: s.campusName,
        })),
        todayRecordsCount: userRecs.length,
        lastRecordType: lastRec?.type ?? null,
        currentStatus: allDone ? "COMPLETADO" : hasInCourse ? "EN_CURSO" : "PENDIENTE",
      })
    }

    patientsList.sort((a, b) => a.entryTime.localeCompare(b.entryTime) || a.excelName.localeCompare(b.excelName))
    docentesList.sort((a, b) => a.entryTime.localeCompare(b.entryTime) || a.excelName.localeCompare(b.excelName))

    const filteredRawSessions = sessions
      .filter((s) =>
        campusFilterName
          ? s.campusName.toLowerCase() === campusFilterName.toLowerCase()
          : true
      )
      .sort((a, b) => a.startMinutes - b.startMinutes || a.ambiente.localeCompare(b.ambiente))
      .map((s) => ({
        horaInicio: s.horaInicio,
        horaFin: s.horaFin,
        piso: s.piso,
        ambiente: formatAmbienteName(s.ambiente),
        sesion: s.sesion,
        courseName: s.courseName,
        campusName: s.campusName,
        docenteLider: s.docenteLider,
        docentesColaboradores: s.docentesColaboradores,
        pacientesEstandarizados: s.pacientesEstandarizados,
      }))

    return {
      success: true,
      syncedAtIso: syncMeta.syncedAt
        ? new Date(syncMeta.syncedAt).toISOString()
        : now.toISOString(),
      source: syncMeta.source ?? "NONE",
      totalRawSessions: filteredRawSessions.length,
      currentLimaTimeStr,
      patients: patientsList,
      docentes: docentesList,
      rawSessions: filteredRawSessions,
    }
  } catch (error) {
    console.error("[getLiveDailyProgramOverviewAction] Error:", error)
    return {
      success: false,
      syncedAtIso: new Date().toISOString(),
      source: "NONE",
      totalRawSessions: 0,
      currentLimaTimeStr: "",
      patients: [],
      docentes: [],
      rawSessions: [],
    }
  }
}

