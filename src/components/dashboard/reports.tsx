"use client"

import { useState, useTransition, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  FileText, FileSpreadsheet, DownloadCloud, Filter, Calendar, Search, RefreshCw,
  Building2, Users, CheckCircle2, Clock, AlertTriangle, ShieldAlert, Sparkles, Loader2, ArrowRight
} from "lucide-react"
import * as XLSX from "xlsx"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { toast } from "sonner"
import { Role, RecordType, RecordStatus } from "@prisma/client"
import { fetchFilteredRecordsAction, type ReportFilterParams } from "@/actions/reports"
import { formatLimaDate, formatLimaTime, limaDayKey, addDaysToKey } from "@/lib/timezone"

type AttendanceItem = {
  id: string
  timestamp: string | Date
  type: RecordType
  status: RecordStatus
  user: {
    id: string
    name: string
    dni: string
    role: Role
  }
  campus: { id: string; name: string } | null
  course: { id: string; name: string } | null
}

const ROLE_LABELS: Record<string, string> = {
  DOCENTE: "Docente",
  TECNICO: "Técnico",
  PACIENTE_SIMULADO: "Paciente Sim.",
}

const STATUS_LABELS: Record<string, { label: string; color: string; badge: string }> = {
  A_TIEMPO: { label: "A Tiempo", color: "#10b981", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  TARDANZA: { label: "Tardanza", color: "#f59e0b", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  FALTA: { label: "Falta", color: "#f43f5e", badge: "bg-rose-50 text-rose-700 border-rose-200" },
  EXCEPCION: { label: "Excepción", color: "#8b5cf6", badge: "bg-purple-50 text-purple-700 border-purple-200" },
}

export function DashboardReports({
  initialRecords,
  campuses,
}: {
  initialRecords: any[]
  campuses: { id: string; name: string }[]
}) {
  const [records, setRecords] = useState<AttendanceItem[]>(initialRecords)
  const [isPending, startTransition] = useTransition()

  // Preset de fechas (por defecto: últimos 30 días hasta hoy)
  const todayKey = useMemo(() => limaDayKey(new Date()), [])
  const thirtyDaysAgoKey = useMemo(() => addDaysToKey(todayKey, -30), [todayKey])

  const [startDate, setStartDate] = useState(thirtyDaysAgoKey)
  const [endDate, setEndDate] = useState(todayKey)
  const [campusId, setCampusId] = useState("")
  const [role, setRole] = useState<Role | "ALL">("ALL")
  const [type, setType] = useState<RecordType | "ALL">("ALL")
  const [status, setStatus] = useState<RecordStatus | "ALL">("ALL")
  const [searchTerm, setSearchTerm] = useState("")

  // Aplicar filtros en el servidor
  const handleApplyFilters = () => {
    startTransition(async () => {
      const res = await fetchFilteredRecordsAction({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        campusId: campusId || undefined,
        role,
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

  // Preparar datos tabulares para exportación
  const getFormattedData = () => {
    return records.map((record) => {
      const dateObj = new Date(record.timestamp)
      const dateStr = formatLimaDate(dateObj)
      const timeStr = formatLimaTime(dateObj)
      const st = STATUS_LABELS[record.status]?.label || record.status

      return {
        "Fecha": dateStr,
        "Hora": timeStr,
        "DNI": record.user?.dni || "-",
        "Nombre Completo": record.user?.name || "Desconocido",
        "Rol": ROLE_LABELS[record.user?.role] || record.user?.role || "-",
        "Tipo": record.type === "ENTRADA" ? "Ingreso" : "Salida",
        "Estado": st,
        "Sede": record.campus?.name || "No especificada",
        "Curso / Actividad": record.course?.name || "No especificado",
      }
    })
  }

  // EXPORTAR EXCEL (XLSX)
  const handleExportExcel = () => {
    if (!records || records.length === 0) {
      toast.error("No hay registros en el listado para exportar.")
      return
    }

    try {
      const data = getFormattedData()
      const worksheet = XLSX.utils.json_to_sheet(data)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, "Control Asistencia")

      // Auto-ajustar anchos de columna
      worksheet["!cols"] = [
        { wch: 14 }, // Fecha
        { wch: 14 }, // Hora
        { wch: 14 }, // DNI
        { wch: 42 }, // Nombre Completo
        { wch: 20 }, // Rol
        { wch: 14 }, // Tipo
        { wch: 16 }, // Estado
        { wch: 22 }, // Sede
        { wch: 34 }, // Curso
      ]

      const dateTag = `${startDate || "inicio"}_al_${endDate || "fin"}`
      const fileName = `Reporte_UCSUR_Asistencia_${dateTag}.xlsx`
      XLSX.writeFile(workbook, fileName)
      toast.success("Excel generado y descargado con éxito.")
    } catch (e) {
      console.error(e)
      toast.error("Hubo un error al generar el archivo Excel.")
    }
  }

  // EXPORTAR PDF OFICIAL CON MEMBRETE Y FORMATO CORPORATIVO
  const handleExportPDF = () => {
    if (!records || records.length === 0) {
      toast.error("No hay registros en el listado para exportar.")
      return
    }

    try {
      const doc = new jsPDF("landscape")
      const data = getFormattedData()

      // Header Corporativo
      doc.setFillColor(11, 27, 61) // #0B1B3D
      doc.rect(0, 0, 297, 28, "F")

      doc.setFont("helvetica", "bold")
      doc.setFontSize(16)
      doc.setTextColor(255, 255, 255)
      doc.text("UNIVERSIDAD CIENTÍFICA DEL SUR", 14, 13)

      doc.setFont("helvetica", "normal")
      doc.setFontSize(10)
      doc.setTextColor(147, 197, 253) // blue-300
      doc.text("Centro de Simulación Clínica | Reporte Consolidado de Asistencia y Accesos", 14, 21)

      // Metadatos del Reporte
      doc.setFontSize(9)
      doc.setTextColor(71, 85, 105) // slate-600
      const generatedAt = new Date().toLocaleString("es-PE")
      const rangeText = startDate && endDate ? `Del ${startDate} al ${endDate}` : "Todos los periodos disponibles"

      doc.text(`Rango consultado: ${rangeText}`, 14, 36)
      doc.text(`Sede: ${campusId ? campuses.find(c => c.id === campusId)?.name || "Filtrada" : "Todas las sedes"}`, 14, 41)
      doc.text(`Total registros: ${records.length}`, 220, 36)
      doc.text(`Fecha emisión: ${generatedAt}`, 220, 41)

      // Tabla de registros
      const tableRows = data.map((row) => [
        row.Fecha,
        row.Hora,
        row.DNI,
        row["Nombre Completo"],
        row.Rol,
        row.Tipo,
        row.Estado,
        row.Sede,
        row["Curso / Actividad"],
      ])

      autoTable(doc, {
        startY: 46,
        head: [["Fecha", "Hora", "DNI", "Nombre Completo", "Rol", "Tipo", "Estado", "Sede", "Curso / Actividad"]],
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
          cellPadding: 2.5,
          textColor: [30, 41, 59],
        },
        columnStyles: {
          0: { cellWidth: 20 },
          1: { cellWidth: 18 },
          2: { cellWidth: 18 },
          3: { cellWidth: 48 },
          4: { cellWidth: 24 },
          5: { cellWidth: 18 },
          6: { cellWidth: 22 },
          7: { cellWidth: 32 },
          8: { cellWidth: "auto" },
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didDrawPage: (dataInfo) => {
          // Footer
          const pageCount = (doc as any).internal.getNumberOfPages()
          doc.setFontSize(8)
          doc.setTextColor(148, 163, 184)
          doc.text(
            `Página ${dataInfo.pageNumber} de ${pageCount} — Documento oficial generado por el Sistema de Asistencia UCSUR`,
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

  // Contadores del conjunto filtrado
  const totalFiltrados = records.length
  const totalEntradas = records.filter((r) => r.type === "ENTRADA").length
  const totalSalidas = records.filter((r) => r.type === "SALIDA").length
  const totalTardanzas = records.filter((r) => r.status === "TARDANZA").length
  const totalFaltas = records.filter((r) => r.status === "FALTA").length

  return (
    <div className="space-y-6 animate-fade-in-up pb-12">
      {/* Banner Principal de Exportación */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B1B3D] via-[#12306b] to-[#1967D2] p-8 text-white shadow-xl shadow-blue-900/20">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.25em] text-blue-200">
              <DownloadCloud size={16} /> Módulo Unificado de Reportes
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Exportación Avanzada de Datos</h2>
            <p className="mt-2 text-sm text-blue-100/80 max-w-2xl font-medium">
              Filtra por fechas, sedes, roles y estados de puntualidad para generar reportes oficiales auditables en Excel y PDF con membrete institucional.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleExportExcel}
              disabled={isPending || records.length === 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black h-12 px-6 rounded-2xl shadow-lg shadow-emerald-950/30 transition-transform hover:scale-105"
            >
              <FileSpreadsheet className="mr-2" size={20} /> Exportar Excel (.xlsx)
            </Button>
            <Button
              onClick={handleExportPDF}
              disabled={isPending || records.length === 0}
              className="bg-rose-600 hover:bg-rose-700 text-white font-black h-12 px-6 rounded-2xl shadow-lg shadow-rose-950/30 transition-transform hover:scale-105"
            >
              <FileText className="mr-2" size={20} /> Generar PDF Oficial
            </Button>
          </div>
        </div>
      </div>

      {/* Tarjeta de Filtros Avanzados */}
      <Card className="rounded-3xl border border-slate-200/80 bg-white p-6 md:p-8 shadow-sm shadow-slate-200/50 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-[#1967D2] rounded-xl">
              <Filter size={20} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">Filtros de Búsqueda y Rango Temporal</h3>
              <p className="text-xs text-slate-400 font-medium">Personaliza los criterios antes de descargar</p>
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

        {/* Inputs de Filtro */}
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
          <div className="sm:col-span-2">
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1.5">
              <Search size={13} className="text-[#1967D2]" /> Búsqueda por Nombre o DNI
            </label>
            <div className="relative">
              <Input
                placeholder="Ej: 72849102 o Jean Pieer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleApplyFilters()}
                className="h-11 pl-4 rounded-xl bg-slate-50 border-slate-200 text-sm font-semibold"
              />
            </div>
          </div>
        </div>

        {/* Botones de Acción */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="text-xs text-slate-500 font-bold flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#1967D2]" />
            Registros encontrados: <span className="text-slate-800 font-black text-sm">{totalFiltrados}</span>
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

      {/* Resumen Métrico de los Filtros Actuales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Entradas</p>
          <p className="text-2xl font-black text-slate-800 mt-1 tabular-nums">{totalEntradas}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Salidas</p>
          <p className="text-2xl font-black text-slate-800 mt-1 tabular-nums">{totalSalidas}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Tardanzas</p>
          <p className="text-2xl font-black text-amber-900 mt-1 tabular-nums">{totalTardanzas}</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-rose-700">Faltas</p>
          <p className="text-2xl font-black text-rose-900 mt-1 tabular-nums">{totalFaltas}</p>
        </div>
      </div>

      {/* Tabla con Vista Previa de los Registros Filtrados */}
      <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/50 overflow-hidden">
        <CardHeader className="py-5 px-6 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-black text-slate-800">Vista Previa de Registros</CardTitle>
            <CardDescription className="text-xs font-medium">
              Mostrando los registros que se incluirán en la exportación (ordenados por fecha más reciente).
            </CardDescription>
          </div>
          <span className="text-xs font-black bg-slate-100 text-slate-700 px-3 py-1 rounded-full">
            {records.length} filas
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[480px] overflow-y-auto no-scrollbar">
            <Table>
              <TableHeader className="bg-slate-50/70 sticky top-0 z-10 backdrop-blur-sm">
                <TableRow className="border-slate-100">
                  <TableHead className="font-bold text-slate-600 text-xs px-6">Colaborador / DNI</TableHead>
                  <TableHead className="font-bold text-slate-600 text-xs">Rol</TableHead>
                  <TableHead className="font-bold text-slate-600 text-xs">Tipo</TableHead>
                  <TableHead className="font-bold text-slate-600 text-xs">Estado</TableHead>
                  <TableHead className="font-bold text-slate-600 text-xs">Sede / Curso</TableHead>
                  <TableHead className="font-bold text-slate-600 text-xs text-right px-6">Fecha y Hora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-slate-400 font-medium">
                      No se encontraron registros que coincidan con los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((r) => {
                    const st = STATUS_LABELS[r.status] || { label: r.status, badge: "bg-slate-100 text-slate-700 border-slate-200" }
                    return (
                      <TableRow key={r.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                        <TableCell className="px-6 py-3.5">
                          <p className="font-bold text-slate-800 text-sm">{r.user?.name || "Sin nombre"}</p>
                          <p className="text-[11px] text-slate-400 font-mono font-medium">DNI: {r.user?.dni || "-"}</p>
                        </TableCell>
                        <TableCell className="text-xs font-bold text-slate-600">
                          {ROLE_LABELS[r.user?.role] || r.user?.role || "-"}
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
      </Card>
    </div>
  )
}
