"use client"

import { useState, useEffect, useMemo } from "react"
import {
  getLiveDailyProgramOverviewAction,
  type LiveDailyProgramOverviewResponse,
  type LivePersonScheduleItem,
} from "@/actions/daily-program"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import {
  RefreshCw,
  Search,
  Clock,
  MapPin,
  DoorOpen,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  Users,
  Table2,
  Sparkles,
  Loader2,
  CalendarClock,
} from "lucide-react"

interface DashboardDailyProgramProps {
  scopedCampusName?: string | null
  lockedOperationalRole?: "PACIENTE_SIMULADO" | null
}

function formatSyncTimeLima(isoStr: string): string {
  if (!isoStr) return "—"
  try {
    return new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(new Date(isoStr))
  } catch {
    return "—"
  }
}

function formatRecordHourLima(isoStr?: string | null): string {
  if (!isoStr) return ""
  try {
    return new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(isoStr))
  } catch {
    return ""
  }
}

export function DashboardDailyProgram({
  scopedCampusName,
  lockedOperationalRole,
}: DashboardDailyProgramProps) {
  const [data, setData] = useState<LiveDailyProgramOverviewResponse | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [activeView, setActiveView] = useState<"patients" | "docentes" | "raw">("patients")
  const [searchTerm, setSearchTerm] = useState<string>("")
  const [campusFilter, setCampusFilter] = useState<string>(scopedCampusName || "ALL")
  const [statusFilter, setStatusFilter] = useState<"ALL" | "MATCHED" | "UNMATCHED" | "EN_CURSO">("ALL")

  const loadProgram = async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    try {
      const res = await getLiveDailyProgramOverviewAction(
        forceRefresh,
        scopedCampusName || undefined
      )
      setData(res)
      if (forceRefresh) {
        if (res.success) {
          toast.success(
            `Excel sincronizado en vivo (${res.patients.length} pacientes y ${res.totalRawSessions} sesiones leídas).`
          )
        } else {
          toast.error("No se pudo conectar con el Excel en vivo.")
        }
      }
    } catch (err) {
      console.error("Error cargando programación diaria:", err)
      if (forceRefresh) {
        toast.error("Error al actualizar desde el Excel.")
      }
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void loadProgram(false)
  }, [scopedCampusName])

  const filteredPeople = useMemo(() => {
    if (!data) return []
    const baseList: LivePersonScheduleItem[] =
      activeView === "docentes" ? data.docentes : data.patients
    const q = searchTerm.trim().toLowerCase()

    return baseList.filter((item) => {
      if (campusFilter !== "ALL" && item.campusName.toLowerCase() !== campusFilter.toLowerCase()) {
        return false
      }
      if (statusFilter === "MATCHED" && !item.dbUser) return false
      if (statusFilter === "UNMATCHED" && item.dbUser) return false
      if (statusFilter === "EN_CURSO" && item.currentStatus !== "EN_CURSO") return false

      if (!q) return true
      const matchName = item.excelName.toLowerCase().includes(q)
      const matchDbName = item.dbUser?.name.toLowerCase().includes(q) ?? false
      const matchDni = item.dbUser?.dni.includes(q) ?? false
      const matchRoom = item.modules.some(
        (m) =>
          m.ambiente.toLowerCase().includes(q) ||
          m.courseName.toLowerCase().includes(q) ||
          m.sesion.toLowerCase().includes(q)
      )
      return matchName || matchDbName || matchDni || matchRoom
    })
  }, [data, activeView, searchTerm, campusFilter, statusFilter])

  const filteredRawSessions = useMemo(() => {
    if (!data) return []
    const q = searchTerm.trim().toLowerCase()
    return data.rawSessions.filter((s) => {
      if (campusFilter !== "ALL" && s.campusName.toLowerCase() !== campusFilter.toLowerCase()) {
        return false
      }
      if (!q) return true
      return (
        s.pacientesEstandarizados.toLowerCase().includes(q) ||
        s.docenteLider.toLowerCase().includes(q) ||
        s.docentesColaboradores.toLowerCase().includes(q) ||
        s.ambiente.toLowerCase().includes(q) ||
        s.courseName.toLowerCase().includes(q) ||
        s.sesion.toLowerCase().includes(q)
      )
    })
  }, [data, searchTerm, campusFilter])

  const patientStats = useMemo(() => {
    const list = data?.patients || []
    const matched = list.filter((p) => Boolean(p.dbUser)).length
    const unmatched = list.length - matched
    const activeNow = list.filter((p) => p.currentStatus === "EN_CURSO").length
    const completed = list.filter((p) => p.currentStatus === "COMPLETADO").length
    return { total: list.length, matched, unmatched, activeNow, completed }
  }, [data])

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Cabecera Principal con Botón de Sincronización en Vivo desde el Excel */}
      <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200/80 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0">
              <CalendarClock size={22} />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight">
                Horarios del Día en Vivo (Excel / Google Sheets)
              </h2>
              <p className="text-xs md:text-sm font-medium text-slate-500">
                Visualice la programación diaria de Pacientes Simulados y verifique al instante cualquier modificación de último momento en el Excel.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {data && (
            <div className="px-3.5 py-2 rounded-2xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-600 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>
                Última lectura:{" "}
                <strong className="text-slate-900">{formatSyncTimeLima(data.syncedAtIso)}</strong>
              </span>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-50 text-[#1967D2] border border-blue-200">
                {data.source === "API_1_JSON_LIVE" ? "JSON En Vivo" : "Hoja Excel"}
              </span>
            </div>
          )}

          <Button
            type="button"
            disabled={isRefreshing || isLoading}
            onClick={() => loadProgram(true)}
            className="h-11 px-5 rounded-2xl bg-[#1967D2] hover:bg-[#124b9c] text-white font-black text-xs md:text-sm shadow-md shadow-blue-600/20 cursor-pointer flex items-center gap-2"
          >
            <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
            {isRefreshing
              ? "Leyendo Excel en vivo..."
              : "Sincronizar Cambios del Excel Ahora"}
          </Button>
        </div>
      </div>

      {/* Tarjetas de Resumen Rápido de Pacientes Simulados Hoy */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Pacientes en Excel Hoy
            </p>
            <p className="text-2xl font-black text-slate-900 mt-1">{patientStats.total}</p>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              En {data?.totalRawSessions ?? 0} sesiones programadas
            </p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black">
            <Users size={22} />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Vinculados con DNI (BD)
            </p>
            <p className="text-2xl font-black text-emerald-600 mt-1">{patientStats.matched}</p>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              Listos para marcar con su DNI
            </p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <UserCheck size={22} />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              En Clase / Módulo Activo
            </p>
            <p className="text-2xl font-black text-[#1967D2] mt-1">{patientStats.activeNow}</p>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              {patientStats.completed} completados hoy
            </p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-blue-50 text-[#1967D2] flex items-center justify-center">
            <Clock size={22} />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Sin Coincidencia en BD
            </p>
            <p
              className={`text-2xl font-black mt-1 ${
                patientStats.unmatched > 0 ? "text-amber-600" : "text-slate-400"
              }`}
            >
              {patientStats.unmatched}
            </p>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              {patientStats.unmatched > 0
                ? "Verificar nombre o registrar DNI"
                : "Todos los nombres coinciden"}
            </p>
          </div>
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
              patientStats.unmatched > 0
                ? "bg-amber-50 text-amber-600"
                : "bg-slate-100 text-slate-400"
            }`}
          >
            <AlertTriangle size={22} />
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Selector de Vista */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveView("patients")}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
              activeView === "patients"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Users size={15} />
            Pacientes Simulados ({data?.patients.length ?? 0})
          </button>

          {lockedOperationalRole !== "PACIENTE_SIMULADO" && (
            <button
              type="button"
              onClick={() => setActiveView("docentes")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
                activeView === "docentes"
                  ? "bg-[#1967D2] text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <UserCheck size={15} />
              Docentes ({data?.docentes.length ?? 0})
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveView("raw")}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
              activeView === "raw"
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Table2 size={15} />
            Tabla Completa del Excel ({data?.rawSessions.length ?? 0})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 flex-1 lg:justify-end">
          {!scopedCampusName && (
            <select
              value={campusFilter}
              onChange={(e) => setCampusFilter(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700"
            >
              <option value="ALL">Todas las Sedes</option>
              <option value="Campus Villa">Campus Villa</option>
              <option value="Campus Norte">Campus Norte</option>
              <option value="Campus Ate">Campus Ate</option>
              <option value="Campus Aramburú">Campus Aramburú</option>
            </select>
          )}

          {activeView !== "raw" && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700"
            >
              <option value="ALL">Todos los estados</option>
              <option value="MATCHED">Vinculados en BD (con DNI)</option>
              <option value="UNMATCHED">Sin coincidencia en BD</option>
              <option value="EN_CURSO">En clase ahora (EN CURSO)</option>
            </select>
          )}

          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              placeholder="Buscar paciente, DNI, ambiente o curso..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 pl-9 pr-4 rounded-xl bg-slate-50 border-slate-200 text-xs font-semibold"
            />
          </div>
        </div>
      </div>

      {/* Contenido Principal */}
      {isLoading ? (
        <div className="bg-white rounded-3xl p-14 border border-slate-200/80 flex flex-col items-center justify-center gap-3 text-center">
          <Loader2 size={32} className="text-[#1967D2] animate-spin" />
          <p className="text-sm font-black text-slate-800">
            Consultando programación del día en vivo desde el Excel...
          </p>
          <p className="text-xs font-medium text-slate-500">
            Cruzando horarios, ambientes y módulos con la base de datos de personal
          </p>
        </div>
      ) : activeView === "raw" ? (
        /* VISTA 3: TABLA CRUDA COMPLETA DEL EXCEL EN VIVO */
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Sesiones Leídas Directamente del Excel Hoy ({filteredRawSessions.length})
              </h3>
              <p className="text-xs font-medium text-slate-500">
                Si agregó o modificó una fila en el Excel hace unos segundos, presione &quot;Sincronizar Cambios del Excel Ahora&quot; para verla reflejada aquí.
              </p>
            </div>
          </div>

          {filteredRawSessions.length === 0 ? (
            <div className="p-12 text-center text-sm font-semibold text-slate-500">
              No se encontraron filas en el Excel con los filtros seleccionados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                    <th className="py-3.5 px-4">Horario</th>
                    <th className="py-3.5 px-4">Sede / Piso</th>
                    <th className="py-3.5 px-4">Ambiente</th>
                    <th className="py-3.5 px-4">Curso / Sesión</th>
                    <th className="py-3.5 px-4">Pacientes Simulados (Excel)</th>
                    <th className="py-3.5 px-4">Docentes (Excel)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRawSessions.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-black text-slate-900 whitespace-nowrap">
                        {row.horaInicio} — {row.horaFin}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-800">{row.campusName}</div>
                        <div className="text-[11px] text-slate-500">{row.piso}</div>
                      </td>
                      <td className="py-3 px-4 font-bold text-emerald-700">
                        {row.ambiente}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-800">{row.courseName}</div>
                        <div className="text-[11px] text-slate-500">{row.sesion}</div>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {row.pacientesEstandarizados || (
                          <span className="text-slate-400 font-normal">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {row.docenteLider}
                        {row.docentesColaboradores ? ` / ${row.docentesColaboradores}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* VISTA 1 Y 2: TARJETAS DETALLADAS POR PACIENTE SIMULADO O DOCENTE */
        <div className="space-y-4">
          {filteredPeople.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 border border-slate-200/80 text-center space-y-2">
              <p className="text-base font-black text-slate-800">
                No se encontraron horarios programados con este filtro
              </p>
              <p className="text-xs font-medium text-slate-500">
                Si acaba de agregar un registro al Excel, pulse el botón azul &quot;Sincronizar Cambios del Excel Ahora&quot;.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {filteredPeople.map((person) => (
                <div
                  key={person.key}
                  className={`bg-white rounded-2xl p-5 border-2 transition-all shadow-xs space-y-4 ${
                    person.currentStatus === "EN_CURSO"
                      ? "border-blue-300 bg-gradient-to-br from-blue-50/30 to-white"
                      : !person.dbUser
                        ? "border-amber-200 bg-amber-50/10"
                        : "border-slate-200/80"
                  }`}
                >
                  {/* Cabecera del Paciente / Docente */}
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-black text-slate-900">
                          {person.dbUser ? person.dbUser.name : person.excelName}
                        </h3>
                        {person.dbUser ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 size={12} /> DNI: {person.dbUser.dni}
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black bg-amber-100 text-amber-800 border border-amber-300"
                            title="Este nombre aparece en el Excel pero no coincide con ningún usuario registrado en la base de datos"
                          >
                            <AlertTriangle size={12} /> Sin DNI en BD
                          </span>
                        )}
                      </div>

                      {person.dbUser &&
                        person.dbUser.name.toLowerCase() !== person.excelName.toLowerCase() && (
                          <p className="text-[11px] font-semibold text-slate-500">
                            Nombre en Excel: <span className="text-slate-700">{person.excelName}</span>
                          </p>
                        )}

                      <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-slate-600 pt-0.5">
                        <span className="flex items-center gap-1 text-slate-800">
                          <MapPin size={13} className="text-[#1967D2]" />
                          {person.campusName}
                        </span>
                        <span className="flex items-center gap-1 text-slate-800">
                          <Clock size={13} className="text-emerald-600" />
                          Jornada: {person.entryTime} a {person.exitTime}
                        </span>
                        {person.role === "PACIENTE_SIMULADO" &&
                          person.rawSessionCount > person.mergedModuleCount && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-black">
                              <Sparkles size={11} />
                              {person.rawSessionCount} módulos unidos en {person.mergedModuleCount}{" "}
                              {person.mergedModuleCount === 1 ? "bloque continuo" : "bloques"}
                            </span>
                          )}
                      </div>
                    </div>

                    {/* Estado General Hoy */}
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {person.currentStatus === "EN_CURSO" ? (
                        <span className="px-3 py-1 rounded-full text-[11px] font-black uppercase bg-blue-600 text-white shadow-xs">
                          En Clase Ahora
                        </span>
                      ) : person.currentStatus === "COMPLETADO" ? (
                        <span className="px-3 py-1 rounded-full text-[11px] font-black uppercase bg-emerald-600 text-white">
                          Jornada Completada
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-[11px] font-black uppercase bg-slate-100 text-slate-600 border border-slate-200">
                          Pendiente de Ingreso
                        </span>
                      )}
                      {person.todayRecordsCount > 0 && (
                        <span className="text-[11px] font-bold text-slate-500">
                          {person.todayRecordsCount} marcación(es) hoy
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Lista de Módulos / Bloques de Rotación del Día */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      {person.role === "PACIENTE_SIMULADO"
                        ? "Bloques de Marcación y Alarma de Rotación (Unificados si son seguidos en el mismo salón)"
                        : "Módulos de Clase del Día (Alarma al finalizar cada sección)"}
                    </p>

                    <div className="space-y-2">
                      {person.modules.map((mod) => (
                        <div
                          key={mod.moduleNumber}
                          className={`rounded-xl p-3 border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs ${
                            mod.status === "EN_CURSO"
                              ? "bg-blue-50/70 border-blue-300"
                              : mod.status === "COMPLETADO"
                                ? "bg-emerald-50/50 border-emerald-200"
                                : "bg-slate-50/80 border-slate-200/80"
                          }`}
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-black text-slate-900 bg-white px-2.5 py-0.5 rounded-lg border border-slate-200">
                                {mod.horaInicio} a {mod.horaFin}
                              </span>
                              <span className="font-black text-emerald-800 flex items-center gap-1">
                                <DoorOpen size={13} className="text-emerald-600 shrink-0" />
                                {mod.ambiente}
                              </span>
                              {mod.piso && (
                                <span className="text-[11px] font-semibold text-slate-500">
                                  ({mod.piso})
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                              <BookOpen size={12} className="text-[#1967D2] shrink-0" />
                              <span className="truncate">{mod.courseName}</span>
                              {mod.sesion && (
                                <span className="text-slate-400 truncate">• {mod.sesion}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {mod.status === "COMPLETADO" && (
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 font-black text-[11px]">
                                ✓ {formatRecordHourLima(mod.entryTimestamp)} -{" "}
                                {formatRecordHourLima(mod.exitTimestamp)}
                              </span>
                            )}
                            {mod.status === "EN_CURSO" && (
                              <span className="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-black text-[11px]">
                                Ingresó {formatRecordHourLima(mod.entryTimestamp)} • Alarma{" "}
                                {mod.horaFin}
                              </span>
                            )}
                            {mod.status === "PENDIENTE" && (
                              <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 font-bold text-[11px]">
                                Alarma fin: {mod.horaFin}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

