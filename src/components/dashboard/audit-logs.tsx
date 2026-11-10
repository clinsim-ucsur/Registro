"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  ScrollText,
  Search,
  ShieldAlert,
  KeyRound,
  MonitorCheck,
  Clock,
  FileSpreadsheet,
  ShieldCheck,
  Activity,
} from "lucide-react"
import type { AuditLogEntry, AuditLogCategory } from "@/lib/audit-log"

const CATEGORY_META: Record<
  AuditLogCategory,
  { label: string; badgeClass: string }
> = {
  AUTH: {
    label: "Inicios de Sesión",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  ADMINS: {
    label: "Permisos & Admins",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  USERS: {
    label: "Personal Operativo",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  SCHEDULES: {
    label: "Cronogramas",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
  },
  RULES: {
    label: "Horarios & Reglas",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  },
  CATALOGS: {
    label: "Sedes & Cursos",
    badgeClass: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  KIOSK: {
    label: "Estación Fija",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
  },
}

export function DashboardAuditLogs({ initialLogs }: { initialLogs: AuditLogEntry[] }) {
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<"ALL" | AuditLogCategory>("ALL")

  const filteredLogs = useMemo(() => {
    return initialLogs.filter((log) => {
      const matchesCat = selectedCategory === "ALL" || log.category === selectedCategory
      const q = searchTerm.trim().toLowerCase()
      if (!q) return matchesCat
      const matchesText =
        log.actorName.toLowerCase().includes(q) ||
        log.actorDni.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        (log.target && log.target.toLowerCase().includes(q)) ||
        log.details.toLowerCase().includes(q)
      return matchesCat && matchesText
    })
  }, [initialLogs, searchTerm, selectedCategory])

  const stats = useMemo(() => {
    const total = initialLogs.length
    const authCount = initialLogs.filter((l) => l.category === "AUTH").length
    const adminCount = initialLogs.filter((l) => l.category === "ADMINS").length
    const opsCount = initialLogs.filter((l) =>
      ["USERS", "SCHEDULES", "RULES", "CATALOGS", "KIOSK"].includes(l.category)
    ).length
    return { total, authCount, adminCount, opsCount }
  }, [initialLogs])

  const formatLimaDateTime = (iso: string) => {
    try {
      const d = new Date(iso)
      return new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(d)
    } catch {
      return iso
    }
  }

  const handleExportExcel = async () => {
    const XLSX = await import("xlsx")
    const rows = filteredLogs.map((l) => ({
      "Fecha y Hora (Lima)": formatLimaDateTime(l.timestamp),
      "Autor / Usuario": l.actorName,
      "DNI Autor": l.actorDni,
      "Rol Autor": l.actorRole,
      Categoría: CATEGORY_META[l.category]?.label || l.category,
      Acción: l.action,
      "Usuario / Recurso Afectado": l.target || "—",
      Detalle: l.details,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Auditoria_Logs")
    XLSX.writeFile(wb, `Informe_Logs_Auditoria_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Tarjetas de resumen de auditoría */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-2xl border-slate-200/70 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">
              Eventos Registrados
            </CardTitle>
            <Activity className="text-indigo-600" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-slate-800">{stats.total}</div>
            <p className="text-xs text-slate-400 font-medium mt-1">Bitácora histórica activa</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/70 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">
              Inicios de Sesión
            </CardTitle>
            <KeyRound className="text-blue-600" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-slate-800">{stats.authCount}</div>
            <p className="text-xs text-slate-400 font-medium mt-1">Accesos y cierres de sesión</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/70 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">
              Cambios de Permisos
            </CardTitle>
            <ShieldCheck className="text-purple-600" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-slate-800">{stats.adminCount}</div>
            <p className="text-xs text-slate-400 font-medium mt-1">Altas, bajas y edición de admins</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/70 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">
              Cambios Operativos
            </CardTitle>
            <MonitorCheck className="text-emerald-600" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-slate-800">{stats.opsCount}</div>
            <p className="text-xs text-slate-400 font-medium mt-1">Personal, reglas y estaciones fijas</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla principal de Logs */}
      <Card className="border-slate-200/60 shadow-sm rounded-3xl bg-white overflow-hidden">
        <CardHeader className="border-b border-slate-100 py-6 px-8 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold uppercase tracking-wider mb-2">
                <ShieldAlert size={13} /> Exclusivo Super Administrador
              </div>
              <CardTitle className="text-2xl font-black text-slate-800 flex items-center gap-2">
                <ScrollText className="text-indigo-600" size={24} /> Informe de Logs y Auditoría del Sistema
              </CardTitle>
              <CardDescription className="text-sm font-medium mt-1 text-slate-500">
                Registro cronológico de inicios de sesión, cambios de permisos, modificaciones de personal y vinculación de estaciones fijas.
              </CardDescription>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <Input
                  placeholder="Buscar por usuario, DNI o acción..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-11 h-11 bg-slate-50 border-slate-200 rounded-xl font-medium"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleExportExcel}
                className="h-11 rounded-xl font-bold border-emerald-200 text-emerald-700 hover:bg-emerald-50 px-5 cursor-pointer"
              >
                <FileSpreadsheet size={18} className="mr-2" /> Exportar Logs
              </Button>
            </div>
          </div>

          {/* Filtros de categoría */}
          <div className="flex flex-wrap gap-2 pt-1">
            {[
              { id: "ALL", label: "Todos los Eventos" },
              { id: "AUTH", label: "Inicios de Sesión" },
              { id: "ADMINS", label: "Permisos & Admins" },
              { id: "USERS", label: "Personal Operativo" },
              { id: "KIOSK", label: "Estación Fija" },
              { id: "RULES", label: "Horarios & Reglas" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedCategory(tab.id as any)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                  selectedCategory === tab.id
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-y-auto no-scrollbar">
            <Table>
              <TableHeader className="bg-slate-50/90 sticky top-0 z-10 backdrop-blur-sm">
                <TableRow className="border-slate-100">
                  <TableHead className="px-6 py-4 font-bold text-slate-600">Fecha y Hora</TableHead>
                  <TableHead className="font-bold text-slate-600">Realizado por</TableHead>
                  <TableHead className="font-bold text-slate-600">Categoría</TableHead>
                  <TableHead className="font-bold text-slate-600">Acción / Evento</TableHead>
                  <TableHead className="font-bold text-slate-600">Objetivo</TableHead>
                  <TableHead className="px-6 font-bold text-slate-600">Detalle del Cambio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-16 text-slate-400 font-medium">
                      No se encontraron eventos de auditoría con los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log) => {
                    const cat = CATEGORY_META[log.category] || {
                      label: log.category,
                      badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
                    }
                    return (
                      <TableRow key={log.id} className="border-slate-100 hover:bg-slate-50/70">
                        <TableCell className="px-6 py-3.5 font-mono text-xs font-semibold text-slate-600 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <Clock size={12} className="text-slate-400" />
                            {formatLimaDateTime(log.timestamp)}
                          </span>
                        </TableCell>
                        <TableCell className="py-3.5">
                          <div className="font-bold text-slate-800 text-sm">{log.actorName}</div>
                          <div className="text-[11px] font-mono text-slate-400">
                            DNI: {log.actorDni} &bull; {log.actorRole}
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${cat.badgeClass}`}
                          >
                            {cat.label}
                          </span>
                        </TableCell>
                        <TableCell className="py-3.5 font-bold text-slate-800 text-xs sm:text-sm">
                          {log.action}
                        </TableCell>
                        <TableCell className="py-3.5 text-xs font-semibold text-slate-600">
                          {log.target || "—"}
                        </TableCell>
                        <TableCell className="px-6 py-3.5 text-xs text-slate-600 max-w-md">
                          {log.details}
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

