"use client"

import { useState, useTransition, useMemo, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  FileText, FileSpreadsheet, DownloadCloud, Filter, Calendar, Search, RefreshCw,
  Building2, Users, CheckCircle2, Clock, AlertTriangle, ShieldAlert, Sparkles, Loader2,
  FileDown, Layers, BarChart3, TrendingUp, TrendingDown, Sun, Sunset, Moon, Coffee,
  Award, AlertCircle, FileCode, CheckSquare, Eye, ArrowUpDown, ArrowRight,
  Sliders, Timer, ShieldCheck, Settings, Check, X
} from "lucide-react"
import * as XLSX from "xlsx"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { toast } from "sonner"
import { Role, RecordType, RecordStatus, Shift } from "@prisma/client"
import { fetchFilteredRecordsAction, type ReportFilterParams } from "@/actions/reports"
import { formatLimaDate, formatLimaTime, limaDayKey, addDaysToKey } from "@/lib/timezone"
import { DEFAULT_SHIFT_TIMES } from "@/lib/schedule-constants"
import {
  DEFAULT_OVERTIME_SETTINGS,
  type OvertimeSettings,
  computeOvertimeForRecords,
  formatMinutesToHoursAndMins,
} from "@/lib/overtime"
import {
  getOvertimeSettingsAction,
  updateOvertimeSettingsAction,
} from "@/actions/overtime"

export type AttendanceItem = {
  id: string
  timestamp: string | Date
  type: RecordType
  status: RecordStatus
  user: {
    id: string
    name: string
    dni: string
    role: Role
    defaultShift?: Shift | null
    campus?: { id: string; name: string } | null
  }
  campus: { id: string; name: string } | null
  course: { id: string; name: string } | null
}

export type StaffConsolidated = {
  userId: string
  name: string
  dni: string
  role: Role
  shift: Shift | "SIN_TURNO"
  campusName: string
  totalEntradas: number
  totalSalidas: number
  aTiempo: number
  tardanzas: number
  faltas: number
  excepciones: number
  punctualityRate: number
  statusLevel: "EXCELENTE" | "REGULAR" | "CRITICO"
  rawOvertimeMinutes: number
  rawOvertimeHours: number
  countedOvertimeMinutes: number
  countedOvertimeHours: number
  formattedRawTime: string
  formattedCountedHours: string
  daysWithOvertime: number
}

const ROLE_LABELS: Record<string, string> = {
  DOCENTE: "Docente",
  TECNICO: "Técnico",
  PACIENTE_SIMULADO: "Paciente Sim.",
  SUPER_ADMIN: "Super Admin",
  ADMIN_SECUNDARIO: "Coordinador",
}

const STATUS_LABELS: Record<string, { label: string; color: string; badge: string }> = {
  A_TIEMPO: { label: "A Tiempo", color: "#10b981", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  TARDANZA: { label: "Tardanza", color: "#f59e0b", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  FALTA: { label: "Falta", color: "#f43f5e", badge: "bg-rose-50 text-rose-700 border-rose-200" },
  EXCEPCION: { label: "Excepción", color: "#8b5cf6", badge: "bg-purple-50 text-purple-700 border-purple-200" },
}

const SHIFT_LABELS: Record<Shift, { label: string; icon: any; color: string }> = {
  MANANA: { label: "Mañana (06:00 / 08:00)", icon: Sun, color: "text-amber-600 bg-amber-50 border-amber-200" },
  INTERMEDIO: { label: "Intermedio (09:00 / 11:00)", icon: Coffee, color: "text-blue-600 bg-blue-50 border-blue-200" },
  TARDE: { label: "Tarde (13:00 / 14:00)", icon: Sunset, color: "text-orange-600 bg-orange-50 border-orange-200" },
  NOCHE: { label: "Noche (19:00 / 21:00)", icon: Moon, color: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  DESCANSO: { label: "Descanso / Libre", icon: Coffee, color: "text-slate-500 bg-slate-50 border-slate-200" },
}

export function DashboardReports({
  initialRecords,
  campuses,
  initialOvertimeSettings,
}: {
  initialRecords: any[]
  campuses: { id: string; name: string }[]
  initialOvertimeSettings?: OvertimeSettings
}) {
  const [records, setRecords] = useState<AttendanceItem[]>(initialRecords)
  const [isPending, startTransition] = useTransition()

  // Configuración de Horas Extras
  const [overtimeSettings, setOvertimeSettings] = useState<OvertimeSettings>(
    initialOvertimeSettings || DEFAULT_OVERTIME_SETTINGS
  )
  const [isOvertimeModalOpen, setIsOvertimeModalOpen] = useState(false)
  const [isSavingOvertime, setIsSavingOvertime] = useState(false)
  const [tempMinMinutes, setTempMinMinutes] = useState(overtimeSettings.minMinutes)
  const [tempRoundingMode, setTempRoundingMode] = useState<"DECIMAL" | "HORAS_COMPLETAS">(overtimeSettings.roundingMode)
  const [tempWorkdayHours, setTempWorkdayHours] = useState(overtimeSettings.workdayHours)

  // Sincronizar configuración si cambia desde el servidor
  useEffect(() => {
    if (initialOvertimeSettings) {
      setOvertimeSettings(initialOvertimeSettings)
      setTempMinMinutes(initialOvertimeSettings.minMinutes)
      setTempRoundingMode(initialOvertimeSettings.roundingMode)
      setTempWorkdayHours(initialOvertimeSettings.workdayHours)
    } else {
      getOvertimeSettingsAction().then((s) => {
        if (s) {
          setOvertimeSettings(s)
          setTempMinMinutes(s.minMinutes)
          setTempRoundingMode(s.roundingMode)
          setTempWorkdayHours(s.workdayHours)
        }
      })
    }
  }, [initialOvertimeSettings])

  // Vista activa de la tabla: "DETALLADO" | "CONSOLIDADO"
  const [activeViewTab, setActiveViewTab] = useState<"DETALLADO" | "CONSOLIDADO">("DETALLADO")

  // Filtros de fecha (por defecto: últimos 30 días hasta hoy)
  const todayKey = useMemo(() => limaDayKey(new Date()), [])
  const thirtyDaysAgoKey = useMemo(() => addDaysToKey(todayKey, -30), [todayKey])

  const [startDate, setStartDate] = useState(thirtyDaysAgoKey)
  const [endDate, setEndDate] = useState(todayKey)
  const [campusId, setCampusId] = useState("")
  const [role, setRole] = useState<Role | "ALL">("ALL")
  const [shift, setShift] = useState<Shift | "ALL">("ALL")
  const [type, setType] = useState<RecordType | "ALL">("ALL")
  const [status, setStatus] = useState<RecordStatus | "ALL">("ALL")
  const [searchTerm, setSearchTerm] = useState("")

  // Ordenamiento en la vista de consolidado
  const [consolidatedSort, setConsolidatedSort] = useState<"tardanzas" | "faltas" | "puntualidad" | "nombre" | "horasExtras">("tardanzas")

  // Aplicar filtros en el servidor
  const handleApplyFilters = () => {
    startTransition(async () => {
      const res = await fetchFilteredRecordsAction({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        campusId: campusId || undefined,
        role,
        shift,
        type,
        status,
        search: searchTerm || undefined,
      })

      if (res.success && res.records) {
        setRecords(res.records as AttendanceItem[])
        toast.success(`Se encontraron ${res.records.length} registros.`)
      } else {
        toast.error(res.message || "Error al aplicar filtros.")
      }
    })
  }

  // Atajos rápidos de fecha
  const setDatePreset = (preset: "today" | "week" | "month" | "all") => {
    if (preset === "today") {
      setStartDate(todayKey)
      setEndDate(todayKey)
    } else if (preset === "week") {
      setStartDate(addDaysToKey(todayKey, -7))
      setEndDate(todayKey)
    } else if (preset === "month") {
      setStartDate(thirtyDaysAgoKey)
      setEndDate(todayKey)
    } else if (preset === "all") {
      setStartDate("")
      setEndDate("")
    }
  }

  // Limpiar filtros
  const handleResetFilters = () => {
    setStartDate(thirtyDaysAgoKey)
    setEndDate(todayKey)
    setCampusId("")
    setRole("ALL")
    setShift("ALL")
    setType("ALL")
    setStatus("ALL")
    setSearchTerm("")
    startTransition(async () => {
      const res = await fetchFilteredRecordsAction({
        startDate: thirtyDaysAgoKey,
        endDate: todayKey,
      })
      if (res.success && res.records) {
        setRecords(res.records as AttendanceItem[])
        toast.info("Filtros restablecidos a los últimos 30 días.")
      }
    })
  }

  // =====================================================================
  // CÁLCULO DE HORAS EXTRAS Y AUDITORÍA
  // =====================================================================
  const overtimeResult = useMemo(() => {
    return computeOvertimeForRecords(records, new Map(), overtimeSettings)
  }, [records, overtimeSettings])

  const handleSaveOvertimeSettings = async () => {
    setIsSavingOvertime(true)
    try {
      const res = await updateOvertimeSettingsAction({
        minMinutes: Number(tempMinMinutes),
        roundingMode: tempRoundingMode,
        workdayHours: Number(tempWorkdayHours),
      })
      if (res.success && res.settings) {
        setOvertimeSettings(res.settings as OvertimeSettings)
        toast.success(res.message)
        setIsOvertimeModalOpen(false)
      } else {
        toast.error(res.message || "Error al actualizar la configuración.")
      }
    } catch (e: any) {
      toast.error(e.message || "Error de conexión.")
    } finally {
      setIsSavingOvertime(false)
    }
  }

  // =====================================================================
  // MÉTRICAS DE CONTROL CALCULADAS DINÁMICAMENTE
  // =====================================================================
  const controlMetrics = useMemo(() => {
    const total = records.length
    const entradas = records.filter((r) => r.type === "ENTRADA").length
    const salidas = records.filter((r) => r.type === "SALIDA").length
    const aTiempo = records.filter((r) => r.status === "A_TIEMPO" || r.status === "EXCEPCION").length
    const tardanzas = records.filter((r) => r.status === "TARDANZA").length
    const faltas = records.filter((r) => r.status === "FALTA").length
    const excepciones = records.filter((r) => r.status === "EXCEPCION").length

    const punctualityRate = entradas > 0 ? Math.round((aTiempo / entradas) * 1000) / 10 : 100
    const tardinessRate = entradas > 0 ? Math.round((tardanzas / entradas) * 1000) / 10 : 0
    const absenceRate = entradas > 0 ? Math.round((faltas / entradas) * 1000) / 10 : 0
    const exitCoverage = entradas > 0 ? Math.round((salidas / entradas) * 1000) / 10 : 0

    const activeUsers = new Set(records.map((r) => r.user.id))

    return {
      total,
      entradas,
      salidas,
      aTiempo,
      tardanzas,
      faltas,
      excepciones,
      punctualityRate,
      tardinessRate,
      absenceRate,
      exitCoverage,
      uniqueStaff: activeUsers.size,
      totalCountedOvertimeHours: overtimeResult.totalCountedHours,
      totalRawOvertimeHours: overtimeResult.totalRawHours,
      totalStaffWithOvertime: overtimeResult.totalStaffWithOvertime,
      minOvertimeMinutes: overtimeSettings.minMinutes,
    }
  }, [records, overtimeResult, overtimeSettings])

  // =====================================================================
  // CONSOLIDADO POR COLABORADOR (AUDITORÍA RRHH Y NÓMINA)
  // =====================================================================
  const staffConsolidated = useMemo(() => {
    const map = new Map<string, StaffConsolidated>()
    const staffOtMap = new Map(overtimeResult.staffSummaries.map((s) => [s.userId, s]))

    for (const r of records) {
      const u = r.user
      const existing = map.get(u.id) || {
        userId: u.id,
        name: u.name || "Sin nombre",
        dni: u.dni || "-",
        role: u.role,
        shift: u.defaultShift || "SIN_TURNO",
        campusName: r.campus?.name || u.campus?.name || "Sin sede",
        totalEntradas: 0,
        totalSalidas: 0,
        aTiempo: 0,
        tardanzas: 0,
        faltas: 0,
        excepciones: 0,
        punctualityRate: 100,
        statusLevel: "EXCELENTE" as const,
        rawOvertimeMinutes: 0,
        rawOvertimeHours: 0,
        countedOvertimeMinutes: 0,
        countedOvertimeHours: 0,
        formattedRawTime: "0 min",
        formattedCountedHours: "0 hrs",
        daysWithOvertime: 0,
      }

      if (r.type === "SALIDA") {
        existing.totalSalidas++
      } else {
        existing.totalEntradas++
        if (r.status === "A_TIEMPO") existing.aTiempo++
        else if (r.status === "TARDANZA") existing.tardanzas++
        else if (r.status === "FALTA") existing.faltas++
        else if (r.status === "EXCEPCION") {
          existing.excepciones++
          existing.aTiempo++
        }
      }

      map.set(u.id, existing)
    }

    const list = Array.from(map.values()).map((item) => {
      const rate = item.totalEntradas > 0
        ? Math.round((item.aTiempo / item.totalEntradas) * 1000) / 10
        : 100
      let statusLevel: "EXCELENTE" | "REGULAR" | "CRITICO" = "EXCELENTE"
      if (rate < 80 || item.faltas >= 2) statusLevel = "CRITICO"
      else if (rate < 95 || item.tardanzas >= 2) statusLevel = "REGULAR"

      const ot = staffOtMap.get(item.userId)

      return {
        ...item,
        punctualityRate: rate,
        statusLevel,
        rawOvertimeMinutes: ot?.totalRawExtraMinutes || 0,
        rawOvertimeHours: ot?.totalRawHours || 0,
        countedOvertimeMinutes: ot?.totalCountedExtraMinutes || 0,
        countedOvertimeHours: ot?.totalCountedHours || 0,
        formattedRawTime: ot?.formattedRawTime || "0 min",
        formattedCountedHours: ot?.formattedCountedHours || "0 hrs",
        daysWithOvertime: ot?.totalDaysWithOvertime || 0,
      }
    })

    // Ordenamiento configurable
    return list.sort((a, b) => {
      if (consolidatedSort === "horasExtras") return b.countedOvertimeHours - a.countedOvertimeHours || b.rawOvertimeHours - a.rawOvertimeHours
      if (consolidatedSort === "tardanzas") return b.tardanzas - a.tardanzas
      if (consolidatedSort === "faltas") return b.faltas - a.faltas
      if (consolidatedSort === "puntualidad") return a.punctualityRate - b.punctualityRate
      return a.name.localeCompare(b.name)
    })
  }, [records, consolidatedSort, overtimeResult])

  // =====================================================================
  // RESUMEN DE CONTROL POR SEDE
  // =====================================================================
  const campusSummary = useMemo(() => {
    const map = new Map<string, { name: string; entradas: number; salidas: number; aTiempo: number; tardanzas: number; faltas: number }>()

    for (const r of records) {
      const cName = r.campus?.name || "Sin sede"
      const item = map.get(cName) || { name: cName, entradas: 0, salidas: 0, aTiempo: 0, tardanzas: 0, faltas: 0 }
      if (r.type === "SALIDA") item.salidas++
      else {
        item.entradas++
        if (r.status === "A_TIEMPO" || r.status === "EXCEPCION") item.aTiempo++
        else if (r.status === "TARDANZA") item.tardanzas++
        else if (r.status === "FALTA") item.faltas++
      }
      map.set(cName, item)
    }

    return Array.from(map.values()).map((c) => ({
      ...c,
      rate: c.entradas > 0 ? Math.round((c.aTiempo / c.entradas) * 1000) / 10 : 100,
    })).sort((a, b) => b.entradas - a.entradas)
  }, [records])

  // =====================================================================
  // RESUMEN DE CONTROL POR TURNO
  // =====================================================================
  const shiftSummary = useMemo(() => {
    const map = new Map<string, { shiftName: string; entradas: number; aTiempo: number; tardanzas: number; faltas: number }>()

    for (const r of records) {
      if (r.type !== "ENTRADA") continue
      const s = r.user.defaultShift || "NO_ASIGNADO"
      const sLabel = s === "NO_ASIGNADO" ? "Sin turno específico" : (SHIFT_LABELS[s as Shift]?.label || s)
      const item = map.get(sLabel) || { shiftName: sLabel, entradas: 0, aTiempo: 0, tardanzas: 0, faltas: 0 }
      item.entradas++
      if (r.status === "A_TIEMPO" || r.status === "EXCEPCION") item.aTiempo++
      else if (r.status === "TARDANZA") item.tardanzas++
      else if (r.status === "FALTA") item.faltas++
      map.set(sLabel, item)
    }

    return Array.from(map.values()).map((s) => ({
      ...s,
      rate: s.entradas > 0 ? Math.round((s.aTiempo / s.entradas) * 1000) / 10 : 100,
    })).sort((a, b) => b.entradas - a.entradas)
  }, [records])

  // =====================================================================
  // EXPORTACIÓN 1: EXCEL MULTI-HOJA COMPLETO (.XLSX)
  // =====================================================================
  const handleExportExcelFull = () => {
    if (!records || records.length === 0) {
      toast.error("No hay registros en el listado para exportar.")
      return
    }

    try {
      const workbook = XLSX.utils.book_new()

      // HOJA 1: Marcaciones Detalladas
      const detailedData = records.map((record) => {
        const dateObj = new Date(record.timestamp)
        const dateStr = formatLimaDate(dateObj)
        const timeStr = formatLimaTime(dateObj)
        const st = STATUS_LABELS[record.status]?.label || record.status
        const shiftStr = record.user?.defaultShift
          ? (SHIFT_LABELS[record.user.defaultShift]?.label || record.user.defaultShift)
          : "No asignado"

        return {
          "Fecha": dateStr,
          "Hora": timeStr,
          "DNI": record.user?.dni || "-",
          "Nombre Completo": record.user?.name || "Desconocido",
          "Rol": ROLE_LABELS[record.user?.role] || record.user?.role || "-",
          "Turno Base": shiftStr,
          "Tipo": record.type === "ENTRADA" ? "Ingreso" : "Salida",
          "Estado Asistencia": st,
          "Sede": record.campus?.name || "No especificada",
          "Curso / Actividad": record.course?.name || "No especificado",
        }
      })
      const wsDetailed = XLSX.utils.json_to_sheet(detailedData)
      wsDetailed["!cols"] = [
        { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 40 }, { wch: 20 },
        { wch: 26 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 34 },
      ]
      XLSX.utils.book_append_sheet(workbook, wsDetailed, "1. Detalle Asistencias")

      // HOJA 2: Consolidado por Colaborador (RRHH)
      const consolidatedData = staffConsolidated.map((staff) => ({
        "DNI": staff.dni,
        "Colaborador": staff.name,
        "Rol": ROLE_LABELS[staff.role] || staff.role,
        "Turno": staff.shift === "SIN_TURNO" ? "No asignado" : (SHIFT_LABELS[staff.shift]?.label || staff.shift),
        "Sede Principal": staff.campusName,
        "Total Entradas": staff.totalEntradas,
        "A Tiempo": staff.aTiempo,
        "Tardanzas": staff.tardanzas,
        "Faltas": staff.faltas,
        "Total Salidas": staff.totalSalidas,
        "% Puntualidad": `${staff.punctualityRate}%`,
        "H. Extras Realizadas (Total)": staff.formattedRawTime,
        [`H. Extras Contabilizadas (Mín. ${overtimeSettings.minMinutes}m)`]: staff.countedOvertimeHours,
        "Días con H. Extras": staff.daysWithOvertime,
        "Nivel Cumplimiento": staff.statusLevel === "EXCELENTE" ? "Excelente" : staff.statusLevel === "REGULAR" ? "Regular" : "Crítico / En Alerta",
      }))
      const wsConsolidated = XLSX.utils.json_to_sheet(consolidatedData)
      wsConsolidated["!cols"] = [
        { wch: 14 }, { wch: 40 }, { wch: 18 }, { wch: 26 }, { wch: 24 },
        { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
        { wch: 16 }, { wch: 26 }, { wch: 30 }, { wch: 18 }, { wch: 22 },
      ]
      XLSX.utils.book_append_sheet(workbook, wsConsolidated, "2. Consolidado RRHH")

      // HOJA 3: Detalle de Horas Extras de Técnicos
      const overtimeDetailData = overtimeResult.pairs.map((pair) => ({
        "Fecha": pair.date,
        "DNI": pair.userDni,
        "Colaborador": pair.userName,
        "Turno": pair.shift,
        "Sede": pair.campusName,
        "Hora Ingreso": pair.entryTime,
        "Hora Salida": pair.exitTime,
        "Salida Programada": pair.scheduledExitTime,
        "Exceso Real": formatMinutesToHoursAndMins(pair.rawExtraMinutes),
        [`Supera Umbral (${overtimeSettings.minMinutes}m)`]: pair.qualifies ? "SÍ (Computable)" : `NO (< ${overtimeSettings.minMinutes}m)`,
        "Horas Contabilizadas": pair.countedHours,
      }))
      const wsOvertime = XLSX.utils.json_to_sheet(
        overtimeDetailData.length > 0
          ? overtimeDetailData
          : [{ "Información": "No se registraron jornadas con exceso de jornada en el rango seleccionado." }]
      )
      wsOvertime["!cols"] = [
        { wch: 14 }, { wch: 14 }, { wch: 38 }, { wch: 18 }, { wch: 22 },
        { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 26 }, { wch: 22 },
      ]
      XLSX.utils.book_append_sheet(workbook, wsOvertime, "3. Horas Extras Detalladas")

      // HOJA 4: Resumen por Sede
      const campusData = campusSummary.map((c) => ({
        "Sede Universitaria": c.name,
        "Total Ingresos": c.entradas,
        "Ingresos A Tiempo": c.aTiempo,
        "Tardanzas": c.tardanzas,
        "Faltas": c.faltas,
        "Salidas": c.salidas,
        "Índice Puntualidad": `${c.rate}%`,
      }))
      const wsCampus = XLSX.utils.json_to_sheet(campusData)
      wsCampus["!cols"] = [{ wch: 30 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 20 }]
      XLSX.utils.book_append_sheet(workbook, wsCampus, "4. Resumen por Sede")

      // HOJA 5: Resumen por Turno
      const shiftData = shiftSummary.map((s) => ({
        "Turno": s.shiftName,
        "Total Ingresos": s.entradas,
        "A Tiempo": s.aTiempo,
        "Tardanzas": s.tardanzas,
        "Faltas": s.faltas,
        "Índice Puntualidad": `${s.rate}%`,
      }))
      const wsShift = XLSX.utils.json_to_sheet(shiftData)
      wsShift["!cols"] = [{ wch: 32 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 20 }]
      XLSX.utils.book_append_sheet(workbook, wsShift, "5. Resumen por Turno")

      // HOJA 6: Métricas de Control (KPIs)
      const kpiData = [
        { "Métrica de Control": "Rango de Fechas Consultado", "Valor": `${startDate || "Inicio"} al ${endDate || "Hoy"}` },
        { "Métrica de Control": "Total de Registros Procesados", "Valor": controlMetrics.total },
        { "Métrica de Control": "Total de Entradas (Ingresos)", "Valor": controlMetrics.entradas },
        { "Métrica de Control": "Total de Salidas (Egresos)", "Valor": controlMetrics.salidas },
        { "Métrica de Control": "Tasa Global de Puntualidad", "Valor": `${controlMetrics.punctualityRate}%` },
        { "Métrica de Control": "Tasa de Incidencias de Tardanza", "Valor": `${controlMetrics.tardinessRate}% (${controlMetrics.tardanzas} tardanzas)` },
        { "Métrica de Control": "Tasa de Faltas Injustificadas", "Valor": `${controlMetrics.absenceRate}% (${controlMetrics.faltas} faltas)` },
        { "Métrica de Control": "Cobertura de Salidas Registradas", "Valor": `${controlMetrics.exitCoverage}%` },
        { "Métrica de Control": "Total de Personal Único Activo", "Valor": controlMetrics.uniqueStaff },
        { "Métrica de Control": "Parámetro Corte H. Extras", "Valor": `Mínimo ${overtimeSettings.minMinutes} minutos (>= 1 hora)` },
        { "Métrica de Control": "H. Extras Realizadas en Bruto", "Valor": `${controlMetrics.totalRawOvertimeHours} horas` },
        { "Métrica de Control": "H. Extras Contabilizadas (Reconocidas)", "Valor": `${controlMetrics.totalCountedOvertimeHours} horas reconocidas` },
        { "Métrica de Control": "Personal con Horas Extras Reconocidas", "Valor": `${controlMetrics.totalStaffWithOvertime} colaboradores` },
        { "Métrica de Control": "Fecha y Hora de Emisión", "Valor": new Date().toLocaleString("es-PE") },
      ]
      const wsKpis = XLSX.utils.json_to_sheet(kpiData)
      wsKpis["!cols"] = [{ wch: 42 }, { wch: 38 }]
      XLSX.utils.book_append_sheet(workbook, wsKpis, "6. Métricas de Control")

      const dateTag = `${startDate || "inicio"}_al_${endDate || "fin"}`
      const fileName = `Reporte_UCSUR_Consolidado_Asistencia_${dateTag}.xlsx`
      XLSX.writeFile(workbook, fileName)
      toast.success("Libro Excel completo con 6 hojas generado con éxito.")
    } catch (e) {
      console.error(e)
      toast.error("Hubo un error al generar el archivo Excel multi-hoja.")
    }
  }

  // =====================================================================
  // EXPORTACIÓN 2: CSV UNIVERSAL (UTF-8 CON BOM)
  // =====================================================================
  const handleExportCSV = () => {
    if (!records || records.length === 0) {
      toast.error("No hay registros en el listado para exportar.")
      return
    }

    try {
      const headers = ["Fecha", "Hora", "DNI", "Nombre", "Rol", "Turno", "Tipo", "Estado", "Sede", "Curso"]
      const rows = records.map((record) => {
        const dateObj = new Date(record.timestamp)
        const dateStr = formatLimaDate(dateObj)
        const timeStr = formatLimaTime(dateObj)
        const st = STATUS_LABELS[record.status]?.label || record.status
        const shiftStr = record.user?.defaultShift
          ? (SHIFT_LABELS[record.user.defaultShift]?.label || record.user.defaultShift)
          : "No asignado"

        return [
          `"${dateStr}"`,
          `"${timeStr}"`,
          `"${record.user?.dni || "-"}"`,
          `"${(record.user?.name || "Desconocido").replace(/"/g, '""')}"`,
          `"${ROLE_LABELS[record.user?.role] || record.user?.role || "-"}"`,
          `"${shiftStr.replace(/"/g, '""')}"`,
          `"${record.type === "ENTRADA" ? "Ingreso" : "Salida"}"`,
          `"${st}"`,
          `"${(record.campus?.name || "Sin sede").replace(/"/g, '""')}"`,
          `"${(record.course?.name || "Sin curso").replace(/"/g, '""')}"`,
        ].join(",")
      })

      const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n")
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      const dateTag = `${startDate || "inicio"}_al_${endDate || "fin"}`
      link.setAttribute("href", url)
      link.setAttribute("download", `UCSUR_Asistencia_${dateTag}.csv`)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success("CSV universal exportado con éxito (compatible con Excel/PowerBI).")
    } catch (e) {
      console.error(e)
      toast.error("Error al exportar CSV.")
    }
  }

  // =====================================================================
  // EXPORTACIÓN 3: PDF INSTITUCIONAL CON REPORTE DE CONTROL
  // =====================================================================
  const handleExportPDF = () => {
    if (!records || records.length === 0) {
      toast.error("No hay registros en el listado para exportar.")
      return
    }

    try {
      const doc = new jsPDF("landscape")

      // Encabezado Corporativo UCSUR
      doc.setFillColor(11, 27, 61) // #0B1B3D
      doc.rect(0, 0, 297, 28, "F")

      doc.setFont("helvetica", "bold")
      doc.setFontSize(16)
      doc.setTextColor(255, 255, 255)
      doc.text("UNIVERSIDAD CIENTÍFICA DEL SUR", 14, 13)

      doc.setFont("helvetica", "normal")
      doc.setFontSize(10)
      doc.setTextColor(147, 197, 253) // blue-300
      doc.text("Centro de Simulación Clínica | Reporte Ejecutivo de Control de Asistencia y Puntualidad", 14, 21)

      // Recuadro Resumen de Métricas de Control
      doc.setFillColor(248, 250, 252) // slate-50
      doc.setDrawColor(226, 232, 240) // slate-200
      doc.roundedRect(14, 32, 269, 24, 2, 2, "FD")

      doc.setFont("helvetica", "bold")
      doc.setFontSize(9)
      doc.setTextColor(30, 41, 59)

      const rangeText = startDate && endDate ? `Del ${startDate} al ${endDate}` : "Todos los periodos"
      doc.text(`Rango: ${rangeText}`, 18, 39)
      doc.text(`Sede: ${campusId ? campuses.find(c => c.id === campusId)?.name || "Filtrada" : "Todas las sedes"}`, 18, 46)
      doc.text(`H. Extras Contab.: ${controlMetrics.totalCountedOvertimeHours} hrs (Mín. ${overtimeSettings.minMinutes}m) | Realiz.: ${controlMetrics.totalRawOvertimeHours}h`, 18, 52)

      doc.text(`Puntualidad: ${controlMetrics.punctualityRate}%`, 130, 39)
      doc.text(`Total Entradas: ${controlMetrics.entradas}`, 130, 46)
      doc.text(`Total Salidas: ${controlMetrics.salidas}`, 130, 52)

      doc.text(`Tardanzas: ${controlMetrics.tardanzas}`, 195, 39)
      doc.text(`Faltas: ${controlMetrics.faltas}`, 195, 46)

      doc.text(`Personal Activo: ${controlMetrics.uniqueStaff}`, 240, 39)
      doc.text(`Total Filas: ${records.length}`, 240, 46)

      // Tabla de Registros
      const tableRows = records.slice(0, 1000).map((record) => {
        const dateObj = new Date(record.timestamp)
        const dateStr = formatLimaDate(dateObj)
        const timeStr = formatLimaTime(dateObj)
        const st = STATUS_LABELS[record.status]?.label || record.status
        const shiftStr = record.user?.defaultShift ? (record.user.defaultShift) : "-"

        return [
          dateStr,
          timeStr,
          record.user?.dni || "-",
          record.user?.name || "Desconocido",
          ROLE_LABELS[record.user?.role] || record.user?.role || "-",
          shiftStr,
          record.type === "ENTRADA" ? "Ingreso" : "Salida",
          st,
          record.campus?.name || "Sin sede",
        ]
      })

      autoTable(doc, {
        startY: 59,
        head: [["Fecha", "Hora", "DNI", "Nombre Completo", "Rol", "Turno", "Tipo", "Estado", "Sede"]],
        body: tableRows,
        theme: "grid",
        headStyles: {
          fillColor: [25, 103, 210], // #1967D2
          fontSize: 8.5,
          fontStyle: "bold",
          textColor: 255,
          halign: "left",
        },
        styles: {
          fontSize: 8,
          cellPadding: 2,
          textColor: [30, 41, 59],
        },
        columnStyles: {
          0: { cellWidth: 20 },
          1: { cellWidth: 16 },
          2: { cellWidth: 18 },
          3: { cellWidth: 55 },
          4: { cellWidth: 24 },
          5: { cellWidth: 22 },
          6: { cellWidth: 18 },
          7: { cellWidth: 22 },
          8: { cellWidth: "auto" },
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didDrawPage: (dataInfo) => {
          const pageCount = (doc as any).internal.getNumberOfPages()
          doc.setFontSize(8)
          doc.setTextColor(148, 163, 184)
          doc.text(
            `Página ${dataInfo.pageNumber} de ${pageCount} — Documento oficial emitido por el Sistema de Asistencia UCSUR el ${new Date().toLocaleString("es-PE")}`,
            14,
            202
          )
        },
      })

      const dateTag = `${startDate || "inicio"}_al_${endDate || "fin"}`
      const fileName = `Reporte_Oficial_Asistencia_UCSUR_${dateTag}.pdf`
      doc.save(fileName)
      toast.success("PDF oficial generado y descargado con éxito.")
    } catch (e) {
      console.error(e)
      toast.error("Hubo un error al generar el archivo PDF.")
    }
  }

  return (
    <div className="space-y-6 animate-fade-in-up pb-12">
      {/* ================================================================= */}
      {/* BANNER PRINCIPAL DE CONTROL Y EXPORTACIÓN */}
      {/* ================================================================= */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B1B3D] via-[#12306b] to-[#1967D2] p-8 text-white shadow-xl shadow-blue-900/20">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />

        <div className="relative flex flex-col xl:flex-row xl:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.25em] text-blue-200">
              <DownloadCloud size={16} /> Centro de Control y Exportación de Datos
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Métricas de Asistencia y Reportes Oficiales</h2>
            <p className="mt-2 text-sm text-blue-100/80 max-w-2xl font-medium">
              Supervisión de puntualidad, control de ausentismo por turno y exportación multipropósito en Excel multi-hoja, CSV universal y PDF corporativo.
            </p>
          </div>

          {/* Botones de Exportación Rápida */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              onClick={handleExportExcelFull}
              disabled={isPending || records.length === 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black h-11 px-5 rounded-2xl shadow-lg shadow-emerald-950/30 transition-transform hover:scale-105"
            >
              <FileSpreadsheet className="mr-2" size={18} /> Excel Completo (.xlsx)
            </Button>
            <Button
              onClick={handleExportCSV}
              disabled={isPending || records.length === 0}
              className="bg-sky-600 hover:bg-sky-700 text-white font-black h-11 px-4 rounded-2xl shadow-lg shadow-sky-950/30 transition-transform hover:scale-105"
            >
              <FileCode className="mr-2" size={18} /> CSV (.csv)
            </Button>
            <Button
              onClick={handleExportPDF}
              disabled={isPending || records.length === 0}
              className="bg-rose-600 hover:bg-rose-700 text-white font-black h-11 px-4 rounded-2xl shadow-lg shadow-rose-950/30 transition-transform hover:scale-105"
            >
              <FileText className="mr-2" size={18} /> PDF Oficial (.pdf)
            </Button>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* FILTROS AVANZADOS */}
      {/* ================================================================= */}
      <Card className="rounded-3xl border border-slate-200/80 bg-white p-6 md:p-8 shadow-sm shadow-slate-200/50 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-[#1967D2] rounded-xl">
              <Filter size={20} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">Filtros de Búsqueda y Rango Temporal</h3>
              <p className="text-xs text-slate-400 font-medium">Ajusta los parámetros para enfocar el análisis y la exportación</p>
            </div>
          </div>

          {/* Atajos rápidos de fecha */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-slate-400 mr-1 hidden sm:inline">Rango rápido:</span>
            <button
              type="button"
              onClick={() => setDatePreset("today")}
              className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => setDatePreset("week")}
              className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
            >
              Últimos 7 días
            </button>
            <button
              type="button"
              onClick={() => setDatePreset("month")}
              className="text-xs font-bold px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#1967D2] transition-colors"
            >
              Últimos 30 días
            </button>
            <button
              type="button"
              onClick={() => setDatePreset("all")}
              className="text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
            >
              Histórico Total
            </button>
          </div>
        </div>

        {/* Inputs de Filtro (Grid Responsivo) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Fecha Inicio */}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <Calendar size={13} className="text-[#1967D2]" /> Fecha Desde
            </label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-11 rounded-xl bg-slate-50 border-slate-200 font-bold text-slate-700 text-sm"
            />
          </div>

          {/* Fecha Fin */}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <Calendar size={13} className="text-[#1967D2]" /> Fecha Hasta
            </label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-11 rounded-xl bg-slate-50 border-slate-200 font-bold text-slate-700 text-sm"
            />
          </div>

          {/* Sede */}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <Building2 size={13} className="text-[#1967D2]" /> Sede Universitaria
            </label>
            <select
              value={campusId}
              onChange={(e) => setCampusId(e.target.value)}
              className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2]"
            >
              <option value="">Todas las sedes</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Rol */}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <Users size={13} className="text-[#1967D2]" /> Rol Operativo
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2]"
            >
              <option value="ALL">Todos los roles</option>
              <option value="DOCENTE">Docentes</option>
              <option value="TECNICO">Técnicos</option>
              <option value="PACIENTE_SIMULADO">Pacientes Simulados</option>
            </select>
          </div>

          {/* Turno Base */}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <Sun size={13} className="text-amber-600" /> Turno Base
            </label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value as any)}
              className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2]"
            >
              <option value="ALL">Todos los turnos</option>
              <option value="MANANA">Mañana (06:00 / 08:00)</option>
              <option value="INTERMEDIO">Intermedio (09:00 / 11:00)</option>
              <option value="TARDE">Tarde (13:00 / 14:00)</option>
            </select>
          </div>

          {/* Tipo de Registro */}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <Clock size={13} className="text-[#1967D2]" /> Tipo de Marcación
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2]"
            >
              <option value="ALL">Entradas y Salidas</option>
              <option value="ENTRADA">Solo Entradas (Ingreso)</option>
              <option value="SALIDA">Solo Salidas</option>
            </select>
          </div>

          {/* Estado de Puntualidad */}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-[#1967D2]" /> Estado de Asistencia
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2]"
            >
              <option value="ALL">Todos los estados</option>
              <option value="A_TIEMPO">A Tiempo</option>
              <option value="TARDANZA">Tardanza</option>
              <option value="FALTA">Falta</option>
              <option value="EXCEPCION">Excepción</option>
            </select>
          </div>

          {/* Buscador de Nombre o DNI */}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <Search size={13} className="text-[#1967D2]" /> Búsqueda por Nombre / DNI
            </label>
            <Input
              placeholder="Ej: 72849102 o Jean..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleApplyFilters()}
              className="h-11 rounded-xl bg-slate-50 border-slate-200 text-sm font-semibold"
            />
          </div>
        </div>

        {/* Barra de Acciones */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="text-xs text-slate-500 font-bold flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#1967D2]" />
            Registros encontrados: <span className="text-slate-800 font-black text-sm">{records.length}</span>
            <span className="text-slate-300">•</span>
            Colaboradores únicos: <span className="text-slate-800 font-black text-sm">{controlMetrics.uniqueStaff}</span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              onClick={handleResetFilters}
              disabled={isPending}
              className="h-11 px-4 rounded-xl font-bold border-slate-200 text-slate-600 hover:bg-slate-100 flex-1 sm:flex-none"
            >
              <RefreshCw size={15} className={`mr-1.5 ${isPending ? "animate-spin" : ""}`} /> Restablecer
            </Button>
            <Button
              type="button"
              onClick={handleApplyFilters}
              disabled={isPending}
              className="h-11 px-6 rounded-xl font-black bg-[#1967D2] hover:bg-blue-800 text-white shadow-md shadow-blue-500/20 flex-1 sm:flex-none"
            >
              {isPending ? <Loader2 size={16} className="animate-spin mr-1.5" /> : <Filter size={16} className="mr-1.5" />}
              Aplicar Filtros
            </Button>
          </div>
        </div>
      </Card>

      {/* ================================================================= */}
      {/* PANEL DE MÉTRICAS DE CONTROL (KPIS CLAVE) */}
      {/* ================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3.5">
        {/* KPI 1: Puntualidad General */}
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-[10px] font-black uppercase tracking-wider">Índice Puntualidad</span>
            <CheckCircle2 size={16} />
          </div>
          <p className="text-2xl font-black text-emerald-800 mt-1 tabular-nums">{controlMetrics.punctualityRate}%</p>
          <div className="mt-1 flex items-center gap-1">
            <span className={`inline-block w-2 h-2 rounded-full ${controlMetrics.punctualityRate >= 90 ? "bg-emerald-500" : controlMetrics.punctualityRate >= 80 ? "bg-amber-500" : "bg-rose-500"}`} />
            <span className="text-[11px] font-bold text-slate-500">
              {controlMetrics.punctualityRate >= 90 ? "Sobresaliente" : controlMetrics.punctualityRate >= 80 ? "Aceptable" : "En Riesgo"}
            </span>
          </div>
        </div>

        {/* KPI 2: Total Entradas */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-blue-700">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Ingresos</span>
            <Clock size={16} />
          </div>
          <p className="text-2xl font-black text-slate-800 mt-1 tabular-nums">{controlMetrics.entradas}</p>
          <p className="text-[11px] font-medium text-slate-400 mt-1">{controlMetrics.aTiempo} a tiempo</p>
        </div>

        {/* KPI 3: Total Salidas */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Salidas</span>
            <ArrowRight size={16} />
          </div>
          <p className="text-2xl font-black text-slate-800 mt-1 tabular-nums">{controlMetrics.salidas}</p>
          <p className="text-[11px] font-medium text-slate-500 mt-1">{controlMetrics.exitCoverage}% cobertura</p>
        </div>

        {/* KPI 4: Tardanzas */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-xs">
          <div className="flex items-center justify-between text-amber-700">
            <span className="text-[10px] font-black uppercase tracking-wider">Tardanzas</span>
            <AlertTriangle size={16} />
          </div>
          <p className="text-2xl font-black text-amber-900 mt-1 tabular-nums">{controlMetrics.tardanzas}</p>
          <p className="text-[11px] font-bold text-amber-700 mt-1">{controlMetrics.tardinessRate}% de ingresos</p>
        </div>

        {/* KPI 5: Faltas */}
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4 shadow-xs">
          <div className="flex items-center justify-between text-rose-700">
            <span className="text-[10px] font-black uppercase tracking-wider">Faltas</span>
            <ShieldAlert size={16} />
          </div>
          <p className="text-2xl font-black text-rose-900 mt-1 tabular-nums">{controlMetrics.faltas}</p>
          <p className="text-[11px] font-bold text-rose-700 mt-1">{controlMetrics.absenceRate}% ausentismo</p>
        </div>

        {/* KPI 6: HORAS EXTRAS TÉCNICOS (NUEVO) */}
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/80 to-white p-4 shadow-xs relative overflow-hidden group">
          <div className="flex items-center justify-between text-violet-700">
            <span className="text-[10px] font-black uppercase tracking-wider">H. Extras Técnicos</span>
            <button
              type="button"
              onClick={() => {
                setTempMinMinutes(overtimeSettings.minMinutes)
                setTempRoundingMode(overtimeSettings.roundingMode)
                setTempWorkdayHours(overtimeSettings.workdayHours)
                setIsOvertimeModalOpen(true)
              }}
              title="Configurar umbral de horas extras"
              className="p-1 rounded-lg bg-violet-100 hover:bg-violet-200 text-violet-700 transition-colors"
            >
              <Sliders size={13} />
            </button>
          </div>
          <p className="text-2xl font-black text-violet-900 mt-1 tabular-nums">
            {controlMetrics.totalCountedOvertimeHours} <span className="text-xs font-bold text-violet-600">hrs</span>
          </p>
          <div className="mt-1 flex items-center justify-between gap-1 text-[11px]">
            <span className="text-slate-500 font-medium">Realiz.: {controlMetrics.totalRawOvertimeHours}h</span>
            <span className="font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded text-[10px]">
              Mín. {overtimeSettings.minMinutes}m
            </span>
          </div>
        </div>

        {/* KPI 7: Personal Evaluado */}
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-xs">
          <div className="flex items-center justify-between text-indigo-700">
            <span className="text-[10px] font-black uppercase tracking-wider">Colaboradores</span>
            <Users size={16} />
          </div>
          <p className="text-2xl font-black text-indigo-900 mt-1 tabular-nums">{controlMetrics.uniqueStaff}</p>
          <p className="text-[11px] font-medium text-indigo-700 mt-1">Con actividad</p>
        </div>
      </div>

      {/* ================================================================= */}
      {/* BANNER INFORMATIVO: CONTROL Y REGLA DE HORAS EXTRAS */}
      {/* ================================================================= */}
      <div className="rounded-2xl border border-violet-200/90 bg-gradient-to-r from-violet-50/90 via-indigo-50/50 to-white p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="p-2.5 bg-violet-600 text-white rounded-xl shadow-md shadow-violet-500/20 shrink-0">
            <Timer size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-black text-slate-800">Control Oficial de Horas Extras</h4>
              <span className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-0.5 rounded-full bg-violet-100 text-violet-800 border border-violet-200">
                <ShieldCheck size={12} /> Umbral de Reconocimiento: Mínimo {overtimeSettings.minMinutes} min (1 hora)
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-1">
              Las horas extras se contabilizan <strong>únicamente</strong> cuando la permanencia excede como mínimo {overtimeSettings.minMinutes} minutos de la jornada oficial (9h). Los excesos menores a {overtimeSettings.minMinutes} min no se contabilizan (0 horas).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 self-end md:self-auto shrink-0">
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total a Computar</p>
            <p className="text-lg font-black text-violet-700 tabular-nums">
              {controlMetrics.totalCountedOvertimeHours} hrs{" "}
              <span className="text-xs text-slate-400 font-normal">({controlMetrics.totalStaffWithOvertime} con extras)</span>
            </p>
          </div>
          <Button
            type="button"
            onClick={() => {
              setTempMinMinutes(overtimeSettings.minMinutes)
              setTempRoundingMode(overtimeSettings.roundingMode)
              setTempWorkdayHours(overtimeSettings.workdayHours)
              setIsOvertimeModalOpen(true)
            }}
            className="h-9 px-3.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs shadow-sm flex items-center gap-1.5"
          >
            <Sliders size={14} /> Configurar Parámetro
          </Button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* RESÚMENES EJECUTIVOS POR SEDE Y TURNO */}
      {/* ================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Resumen por Sede */}
        <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
            <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <Building2 size={16} className="text-[#1967D2]" />
              Control de Puntualidad por Sede
            </h4>
            <span className="text-xs text-slate-400 font-bold">{campusSummary.length} sedes con actividad</span>
          </div>

          <div className="space-y-2.5">
            {campusSummary.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2">Sin datos para las sedes seleccionadas.</p>
            ) : (
              campusSummary.map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-3 text-xs p-2 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="font-bold text-slate-700 truncate max-w-[160px]">{c.name}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-slate-500 font-semibold">{c.entradas} ingresos</span>
                    <span className="text-amber-600 font-bold">{c.tardanzas} tard.</span>
                    <span className="text-rose-600 font-bold">{c.faltas} falt.</span>
                    <span className={`font-black px-2 py-0.5 rounded-md ${c.rate >= 90 ? "bg-emerald-100 text-emerald-800" : c.rate >= 80 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>
                      {c.rate}%
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Resumen por Turno */}
        <Card className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
            <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <Sun size={16} className="text-amber-500" />
              Control de Cumplimiento por Turno Base
            </h4>
            <span className="text-xs text-slate-400 font-bold">{shiftSummary.length} turnos evaluados</span>
          </div>

          <div className="space-y-2.5">
            {shiftSummary.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2">Sin registros por turno en este rango.</p>
            ) : (
              shiftSummary.map((s) => (
                <div key={s.shiftName} className="flex items-center justify-between gap-3 text-xs p-2 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="font-bold text-slate-700 truncate max-w-[180px]">{s.shiftName}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-slate-500 font-semibold">{s.entradas} ingresos</span>
                    <span className="text-amber-600 font-bold">{s.tardanzas} tard.</span>
                    <span className="text-rose-600 font-bold">{s.faltas} falt.</span>
                    <span className={`font-black px-2 py-0.5 rounded-md ${s.rate >= 90 ? "bg-emerald-100 text-emerald-800" : s.rate >= 80 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>
                      {s.rate}%
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* ================================================================= */}
      {/* VISTAS DE TABLA: DETALLADO VS CONSOLIDADO */}
      {/* ================================================================= */}
      <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/50 overflow-hidden">
        {/* Cabecera con selector de modo de vista */}
        <div className="py-4 px-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveViewTab("DETALLADO")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeViewTab === "DETALLADO"
                  ? "bg-[#1967D2] text-white shadow-md shadow-blue-500/20"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              <Layers size={15} /> Marcaciones Detalladas ({records.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveViewTab("CONSOLIDADO")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeViewTab === "CONSOLIDADO"
                  ? "bg-[#1967D2] text-white shadow-md shadow-blue-500/20"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              <Users size={15} /> Consolidado por Colaborador (RRHH: {staffConsolidated.length})
            </button>
          </div>

          {/* Opciones auxiliares según tab */}
          {activeViewTab === "CONSOLIDADO" && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-400">Ordenar por:</span>
              <select
                value={consolidatedSort}
                onChange={(e) => setConsolidatedSort(e.target.value as any)}
                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 outline-none"
              >
                <option value="horasExtras">Más Horas Extras (Contabilizadas)</option>
                <option value="tardanzas">Más Tardanzas</option>
                <option value="faltas">Más Faltas</option>
                <option value="puntualidad">Menor Puntualidad</option>
                <option value="nombre">Nombre Alfabético</option>
              </select>
            </div>
          )}
        </div>

        {/* CONTENIDO TAB 1: MARCACIONES DETALLADAS */}
        {activeViewTab === "DETALLADO" && (
          <CardContent className="p-0">
            <div className="max-h-[520px] overflow-y-auto no-scrollbar">
              <Table>
                <TableHeader className="bg-slate-50/90 sticky top-0 z-10 backdrop-blur-sm">
                  <TableRow className="border-slate-100">
                    <TableHead className="font-bold text-slate-600 text-xs px-6">Colaborador / DNI</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs">Rol</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs">Turno Base</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs">Tipo</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs">Estado</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs">Sede / Curso</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs text-right px-6">Fecha y Hora</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-slate-400 font-medium">
                        No se encontraron registros que coincidan con los filtros seleccionados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    records.map((r) => {
                      const st = STATUS_LABELS[r.status] || { label: r.status, badge: "bg-slate-100 text-slate-700 border-slate-200" }
                      const shiftCfg = r.user.defaultShift ? SHIFT_LABELS[r.user.defaultShift] : null

                      return (
                        <TableRow key={r.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                          <TableCell className="px-6 py-3.5">
                            <p className="font-bold text-slate-800 text-sm">{r.user?.name || "Sin nombre"}</p>
                            <p className="text-[11px] text-slate-400 font-mono font-medium">DNI: {r.user?.dni || "-"}</p>
                          </TableCell>
                          <TableCell className="text-xs font-bold text-slate-600">
                            {ROLE_LABELS[r.user?.role] || r.user?.role || "-"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {shiftCfg ? (
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md font-bold text-[11px] border ${shiftCfg.color}`}>
                                {shiftCfg.label.split("(")[0].trim()}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs italic">No asignado</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider ${r.type === "ENTRADA" ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-700"}`}>
                              {r.type}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black border ${st.badge}`}>
                              ● {st.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">
                            <p className="font-bold text-slate-700">{r.campus?.name || "Sin sede"}</p>
                            <p className="text-[11px] text-slate-400 truncate max-w-[200px]">{r.course?.name || "Sin curso"}</p>
                          </TableCell>
                          <TableCell className="px-6 text-right text-xs font-bold text-slate-700">
                            <p>{formatLimaDate(new Date(r.timestamp))}</p>
                            <p className="text-[11px] text-slate-400">{formatLimaTime(new Date(r.timestamp))}</p>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}

        {/* CONTENIDO TAB 2: CONSOLIDADO POR COLABORADOR */}
        {activeViewTab === "CONSOLIDADO" && (
          <CardContent className="p-0">
            <div className="max-h-[520px] overflow-y-auto no-scrollbar">
              <Table>
                <TableHeader className="bg-slate-50/90 sticky top-0 z-10 backdrop-blur-sm">
                  <TableRow className="border-slate-100">
                    <TableHead className="font-bold text-slate-600 text-xs px-6">Colaborador / DNI</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs">Rol & Turno</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs">Sede Base</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs text-center">Entradas</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs text-center">A Tiempo</TableHead>
                    <TableHead className="font-bold text-amber-700 text-xs text-center">Tardanzas</TableHead>
                    <TableHead className="font-bold text-rose-700 text-xs text-center">Faltas</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs text-center">Salidas</TableHead>
                    <TableHead className="font-bold text-violet-700 text-xs text-center">H. Extras Realiz.</TableHead>
                    <TableHead className="font-bold text-emerald-700 text-xs text-center">H. Extras Contab.</TableHead>
                    <TableHead className="font-bold text-slate-600 text-xs text-right px-6">Puntualidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {staffConsolidated.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-12 text-slate-400 font-medium">
                        No hay personal con actividad en el periodo consultado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    staffConsolidated.map((s) => {
                      const levelBg = s.statusLevel === "EXCELENTE"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : s.statusLevel === "REGULAR"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-rose-50 text-rose-700 border-rose-200"

                      return (
                        <TableRow key={s.userId} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                          <TableCell className="px-6 py-3.5">
                            <p className="font-bold text-slate-800 text-sm">{s.name}</p>
                            <p className="text-[11px] text-slate-400 font-mono font-medium">DNI: {s.dni}</p>
                          </TableCell>
                          <TableCell className="text-xs">
                            <p className="font-bold text-slate-700">{ROLE_LABELS[s.role] || s.role}</p>
                            <p className="text-[11px] text-slate-500">
                              {s.shift === "SIN_TURNO" ? "Sin turno" : s.shift}
                            </p>
                          </TableCell>
                          <TableCell className="text-xs font-bold text-slate-600">
                            {s.campusName}
                          </TableCell>
                          <TableCell className="text-center font-bold text-slate-800 text-sm">
                            {s.totalEntradas}
                          </TableCell>
                          <TableCell className="text-center font-bold text-emerald-700 text-sm">
                            {s.aTiempo}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`px-2 py-0.5 rounded-md text-xs font-black ${s.tardanzas > 0 ? "bg-amber-100 text-amber-900" : "text-slate-400"}`}>
                              {s.tardanzas}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`px-2 py-0.5 rounded-md text-xs font-black ${s.faltas > 0 ? "bg-rose-100 text-rose-900" : "text-slate-400"}`}>
                              {s.faltas}
                            </span>
                          </TableCell>
                          <TableCell className="text-center font-bold text-slate-500 text-sm">
                            {s.totalSalidas}
                          </TableCell>
                          {/* Horas Extras Realizadas (Total bruto) */}
                          <TableCell className="text-center">
                            <span className="text-xs font-semibold text-slate-600">
                              {s.formattedRawTime}
                            </span>
                          </TableCell>
                          {/* Horas Extras Contabilizadas (Superó umbral) */}
                          <TableCell className="text-center">
                            {s.countedOvertimeHours > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                                <Sparkles size={11} /> +{s.countedOvertimeHours} hrs
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-slate-400">0 hrs</span>
                            )}
                          </TableCell>
                          <TableCell className="px-6 text-right">
                            <span className={`px-3 py-1 rounded-full text-xs font-black border ${levelBg}`}>
                              {s.punctualityRate}%
                            </span>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ================================================================= */}
      {/* MODAL: CONFIGURACIÓN DE PARÁMETROS DE HORAS EXTRAS */}
      {/* ================================================================= */}
      {isOvertimeModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in-up p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 md:p-8 shadow-2xl border border-slate-100 space-y-6">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-violet-100 text-violet-700 rounded-2xl shadow-sm">
                  <Sliders size={22} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-800">Parámetros de Horas Extras</h3>
                  <p className="text-xs text-slate-500 font-medium">Configura las reglas de cómputo para nómina de técnicos</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOvertimeModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Alerta explicativa de la regla */}
            <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-black text-violet-900">
                <ShieldCheck size={16} /> Política de Corte Mínimo
              </div>
              <p className="text-violet-800/90 leading-relaxed font-medium">
                Solo se computarán y reconocerán horas extras cuando el colaborador haya excedido como mínimo el tiempo configurado. Si se retira con menos tiempo de exceso, se contabilizarán <strong>0 horas extras</strong>.
              </p>
            </div>

            <div className="space-y-4">
              {/* Umbral mínimo en minutos */}
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center justify-between mb-1.5">
                  <span>Umbral Mínimo Requerido (Minutos)</span>
                  <span className="text-violet-600 font-black text-sm">{tempMinMinutes} min ({Math.round((tempMinMinutes / 60) * 10) / 10} h)</span>
                </label>
                <Input
                  type="number"
                  min="0"
                  max="300"
                  step="5"
                  value={tempMinMinutes}
                  onChange={(e) => setTempMinMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="h-11 rounded-xl bg-slate-50 border-slate-200 font-bold text-slate-800 text-base"
                />

                {/* Atajos rápidos de minutos */}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold text-slate-400">Atajos:</span>
                  {[
                    { label: "30 min", value: 30 },
                    { label: "45 min", value: 45 },
                    { label: "60 min (1 hora)", value: 60 },
                    { label: "90 min (1.5 h)", value: 90 },
                    { label: "120 min (2 h)", value: 120 },
                  ].map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setTempMinMinutes(preset.value)}
                      className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all ${
                        tempMinMinutes === preset.value
                          ? "bg-violet-600 text-white shadow-sm"
                          : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Modo de Redondeo */}
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-1.5">
                  Formato de Liquidación de Horas
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTempRoundingMode("DECIMAL")}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      tempRoundingMode === "DECIMAL"
                        ? "border-violet-600 bg-violet-50 text-violet-900 shadow-sm"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                    }`}
                  >
                    <p className="text-xs font-black">Decimal Proporcional</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Ej: 75 min = 1.25 hrs, 90 min = 1.5 hrs</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTempRoundingMode("HORAS_COMPLETAS")}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      tempRoundingMode === "HORAS_COMPLETAS"
                        ? "border-violet-600 bg-violet-50 text-violet-900 shadow-sm"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                    }`}
                  >
                    <p className="text-xs font-black">Horas Completas</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Ej: 75 min = 1.0 hr, 119 min = 1.0 hr</p>
                  </button>
                </div>
              </div>

              {/* Jornada laboral estándar */}
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-1.5">
                  Jornada Laboral Oficial Diaria (Horas)
                </label>
                <Input
                  type="number"
                  min="6"
                  max="14"
                  value={tempWorkdayHours}
                  onChange={(e) => setTempWorkdayHours(Math.max(6, parseInt(e.target.value, 10) || 9))}
                  className="h-11 rounded-xl bg-slate-50 border-slate-200 font-bold text-slate-800 text-sm"
                />
                <p className="text-[11px] text-slate-400 mt-1 font-medium">
                  Estándar institucional: 9 horas (8 horas laborales + 1 hora de refrigerio).
                </p>
              </div>
            </div>

            {/* Botones de acción */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOvertimeModalOpen(false)}
                disabled={isSavingOvertime}
                className="rounded-xl h-11 px-5 border-slate-200 font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleSaveOvertimeSettings}
                disabled={isSavingOvertime}
                className="rounded-xl h-11 px-6 bg-violet-600 hover:bg-violet-700 text-white font-black shadow-md shadow-violet-500/20"
              >
                {isSavingOvertime ? (
                  <>
                    <Loader2 size={16} className="animate-spin mr-2" /> Guardando...
                  </>
                ) : (
                  <>
                    <Check size={16} className="mr-2" /> Guardar Parámetros
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
