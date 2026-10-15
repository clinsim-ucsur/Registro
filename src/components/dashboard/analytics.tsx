"use client"

import { useState, useTransition } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts"
import { toast } from "sonner"
import {
  Activity, AlarmClock, BookOpen, CalendarRange, CheckCircle2, Clock, Loader2, MapPin,
  TrendingDown, TrendingUp, Trophy, UserX, Users, Briefcase, Stethoscope, Wrench
} from "lucide-react"

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { getAnalyticsAction } from "@/actions/analytics"
import type { AnalyticsData, AnalyticsRange } from "@/lib/analytics-types"

const COLORS = {
  aTiempo: "#10b981",
  tardanza: "#f59e0b",
  falta: "#f43f5e",
  excepcion: "#8b5cf6",
  salidas: "#94a3b8",
  primary: "#1967D2",
}

const ROLE_STYLES: Record<string, { label: string; className: string }> = {
  DOCENTE: { label: "Docente", className: "bg-blue-50 text-blue-700 ring-blue-600/10" },
  TECNICO: { label: "Técnico", className: "bg-purple-50 text-purple-700 ring-purple-600/10" },
  PACIENTE_SIMULADO: { label: "Paciente Sim.", className: "bg-emerald-50 text-emerald-700 ring-emerald-600/10" },
}

const trendConfig = {
  aTiempo: { label: "A tiempo", color: COLORS.aTiempo },
  tardanza: { label: "Tardanza", color: COLORS.tardanza },
  falta: { label: "Falta", color: COLORS.falta },
} satisfies ChartConfig

const statusConfig = {
  value: { label: "Registros" },
  aTiempo: { label: "A tiempo", color: COLORS.aTiempo },
  tardanza: { label: "Tardanza", color: COLORS.tardanza },
  falta: { label: "Falta", color: COLORS.falta },
  excepcion: { label: "Excepción", color: COLORS.excepcion },
} satisfies ChartConfig

const campusConfig = {
  entradas: { label: "Entradas", color: COLORS.primary },
  tardanzas: { label: "Tardanzas", color: COLORS.tardanza },
  faltas: { label: "Faltas", color: COLORS.falta },
} satisfies ChartConfig

const hourConfig = {
  entradas: { label: "Entradas", color: COLORS.primary },
  salidas: { label: "Salidas", color: COLORS.salidas },
} satisfies ChartConfig

const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: 7, label: "7 días" },
  { value: 30, label: "30 días" },
  { value: 90, label: "90 días" },
]

function formatKey(key: string) {
  const [y, m, d] = key.split("-")
  return `${d}/${m}/${y}`
}

function Delta({ current, previous, suffix = "%", invert = false }: { current: number; previous: number; suffix?: string; invert?: boolean }) {
  if (previous === 0 && current === 0) {
    return <span className="text-[11px] font-bold text-slate-400">Sin datos previos</span>
  }
  const diff = suffix === "pts" ? current - previous : previous === 0 ? 100 : ((current - previous) / previous) * 100
  const rounded = Math.round(diff * 10) / 10
  const positive = invert ? rounded <= 0 : rounded >= 0
  const Icon = rounded >= 0 ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black ${positive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
      <Icon size={12} strokeWidth={3} />
      {rounded > 0 ? "+" : ""}{rounded}{suffix === "pts" ? " pts" : "%"}
      <span className="font-semibold text-slate-400 ml-0.5">vs. periodo anterior</span>
    </span>
  )
}

function KpiCard({
  title, value, icon: Icon, accent, children, delay = 0,
}: {
  title: string
  value: string | number
  icon: React.ComponentType<{ size?: number; className?: string }>
  accent: string
  children?: React.ReactNode
  delay?: number
}) {
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm shadow-slate-200/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-200/70 animate-fade-in-up opacity-0"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-10 blur-2xl transition-opacity group-hover:opacity-25" style={{ background: accent }} />
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{title}</p>
        <div className="rounded-xl p-2.5" style={{ background: `${accent}14`, color: accent }}>
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-3 text-4xl font-black tracking-tight text-slate-800 tabular-nums">{value}</p>
      <div className="mt-3 min-h-[22px]">{children}</div>
    </div>
  )
}

function Panel({ title, subtitle, icon: Icon, children, className = "", delay = 0 }: {
  title: string
  subtitle?: string
  icon?: React.ComponentType<{ size?: number; className?: string }>
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/50 animate-fade-in-up opacity-0 ${className}`}
      style={{ animationDelay: `${delay}s` }}
    >
      <header className="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
        {Icon && (
          <div className="rounded-xl bg-slate-50 p-2 text-slate-500">
            <Icon size={18} />
          </div>
        )}
        <div>
          <h3 className="text-base font-extrabold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs font-medium text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      </header>
      <div className="p-6">{children}</div>
    </section>
  )
}

function EmptyState({ message = "Sin registros en este periodo" }: { message?: string }) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-slate-400">
      <Activity size={28} className="opacity-50" />
      <p className="text-sm font-semibold">{message}</p>
    </div>
  )
}

export function DashboardAnalytics({ initialData, lockedCampus }: { initialData: AnalyticsData; lockedCampus?: string | null }) {
  const [data, setData] = useState(initialData)
  const [range, setRange] = useState<AnalyticsRange>(initialData.range.days as AnalyticsRange)
  const [campusId, setCampusId] = useState<string>(initialData.campusId ?? "")
  const [isPending, startTransition] = useTransition()

  const reload = (nextRange: AnalyticsRange, nextCampus: string) => {
    setRange(nextRange)
    setCampusId(nextCampus)
    startTransition(async () => {
      const res = await getAnalyticsAction(nextRange, nextCampus || null)
      if (res.success) setData(res.data)
      else toast.error(res.message)
    })
  }

  const { kpis } = data
  const statusData = data.statusBreakdown.filter((s) => s.value > 0)
  const maxCourse = Math.max(1, ...data.byCourse.map((c) => c.total))
  const hasRecords = kpis.total > 0

  return (
    <div className="space-y-6">
      {/* ---------- Cabecera y filtros ---------- */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B1B3D] via-[#12306b] to-[#1967D2] p-8 text-white shadow-xl shadow-blue-900/20 animate-fade-in-up">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-blue-200">Inteligencia de asistencia</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Métricas y Analítica</h2>
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-blue-100/80">
              <CalendarRange size={16} />
              {formatKey(data.range.fromKey)} — {formatKey(data.range.toKey)}
              {isPending && <Loader2 size={16} className="animate-spin ml-1" />}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex rounded-2xl bg-white/10 p-1 backdrop-blur-md ring-1 ring-white/15" role="group" aria-label="Rango de fechas">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  id={`analytics-range-${r.value}`}
                  type="button"
                  disabled={isPending}
                  onClick={() => reload(r.value, campusId)}
                  className={`rounded-xl px-4 py-2 text-sm font-bold transition-all ${range === r.value ? "bg-white text-[#0B1B3D] shadow-lg" : "text-blue-100 hover:bg-white/10"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {lockedCampus ? (
              <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2.5 text-sm font-bold ring-1 ring-white/15 backdrop-blur-md">
                <MapPin size={16} /> {lockedCampus}
              </div>
            ) : (
              <div className="relative">
                <MapPin size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-200" />
                <select
                  id="analytics-campus-filter"
                  value={campusId}
                  disabled={isPending}
                  onChange={(e) => reload(range, e.target.value)}
                  className="h-11 appearance-none rounded-2xl bg-white/10 pl-10 pr-10 text-sm font-bold text-white ring-1 ring-white/15 backdrop-blur-md outline-none focus:ring-2 focus:ring-white/40 [&>option]:text-slate-800"
                >
                  <option value="">Todas las sedes</option>
                  {data.campuses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-blue-200 text-xs">▼</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`space-y-6 transition-opacity duration-300 ${isPending ? "opacity-60" : "opacity-100"}`}>
        {/* ---------- KPIs ---------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:gap-6">
          <KpiCard title="Registros totales" value={kpis.total} icon={Activity} accent={COLORS.primary} delay={0.05}>
            <Delta current={kpis.total} previous={kpis.prevTotal} />
          </KpiCard>

          <KpiCard title="Puntualidad" value={`${kpis.punctualityRate}%`} icon={CheckCircle2} accent={COLORS.aTiempo} delay={0.1}>
            <div className="space-y-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-700" style={{ width: `${kpis.punctualityRate}%` }} />
              </div>
              <Delta current={kpis.punctualityRate} previous={kpis.prevPunctualityRate} suffix="pts" />
            </div>
          </KpiCard>

          <KpiCard title="Tardanzas" value={kpis.tardanzas} icon={AlarmClock} accent={COLORS.tardanza} delay={0.15}>
            <span className="text-xs font-bold text-slate-400">
              {kpis.entradas > 0 ? Math.round((kpis.tardanzas / kpis.entradas) * 100) : 0}% de las entradas
            </span>
          </KpiCard>

          <KpiCard title="Faltas" value={kpis.faltas} icon={UserX} accent={COLORS.falta} delay={0.2}>
            <span className="text-xs font-bold text-slate-400">
              <Users size={12} className="inline mr-1 -mt-0.5" />{kpis.activeUsers} usuarios activos en el periodo
            </span>
          </KpiCard>
        </div>

        {/* ---------- CENSO DE TRABAJADORES REGISTRADOS ---------- */}
        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 md:p-8 shadow-sm shadow-slate-200/50 animate-fade-in-up">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-[#1967D2]">
                <Users size={16} /> Censo Institucional
              </div>
              <h3 className="text-xl md:text-2xl font-black text-slate-800 mt-1">Personal Operativo Registrado</h3>
              <p className="text-xs md:text-sm text-slate-500 font-medium">
                Padrón activo en la base de datos para control de accesos y actividades clínicas de simulación.
              </p>
            </div>
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200/60 px-5 py-3 rounded-2xl w-fit">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Plantilla:</span>
              <span className="text-2xl font-black text-slate-800 tabular-nums">
                {data.registeredStaff?.total ?? 0} <span className="text-xs font-bold text-slate-400 font-normal">trabajadores</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6 mt-6">
            {/* DOCENTES */}
            <div className="relative overflow-hidden rounded-2xl border-2 border-blue-100 bg-gradient-to-br from-blue-50/60 to-white p-5 transition-all duration-300 hover:shadow-lg hover:border-blue-300 hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-blue-700">Docentes</span>
                <div className="p-2.5 bg-blue-600 text-white rounded-xl shadow-md shadow-blue-500/20">
                  <Briefcase size={20} />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl md:text-4xl font-black text-slate-800 tabular-nums">
                  {data.registeredStaff?.docentes ?? 0}
                </span>
                <span className="text-xs font-bold text-blue-600 bg-blue-100/70 px-2 py-0.5 rounded-full">
                  {data.registeredStaff?.total > 0 ? Math.round(((data.registeredStaff?.docentes ?? 0) / data.registeredStaff.total) * 100) : 0}%
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                <div 
                  className="h-full rounded-full bg-blue-600 transition-all duration-700" 
                  style={{ width: `${data.registeredStaff?.total > 0 ? ((data.registeredStaff?.docentes ?? 0) / data.registeredStaff.total) * 100 : 0}%` }} 
                />
              </div>
              <p className="mt-2 text-[11px] font-semibold text-slate-500">Catedráticos y médicos instructores</p>
            </div>

            {/* PACIENTES SIMULADOS */}
            <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-100 bg-gradient-to-br from-emerald-50/60 to-white p-5 transition-all duration-300 hover:shadow-lg hover:border-emerald-300 hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-emerald-700">Pacientes Simulados</span>
                <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-md shadow-emerald-500/20">
                  <Stethoscope size={20} />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl md:text-4xl font-black text-slate-800 tabular-nums">
                  {data.registeredStaff?.pacientes ?? 0}
                </span>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-100/70 px-2 py-0.5 rounded-full">
                  {data.registeredStaff?.total > 0 ? Math.round(((data.registeredStaff?.pacientes ?? 0) / data.registeredStaff.total) * 100) : 0}%
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-emerald-100">
                <div 
                  className="h-full rounded-full bg-emerald-600 transition-all duration-700" 
                  style={{ width: `${data.registeredStaff?.total > 0 ? ((data.registeredStaff?.pacientes ?? 0) / data.registeredStaff.total) * 100 : 0}%` }} 
                />
              </div>
              <p className="mt-2 text-[11px] font-semibold text-slate-500">Actores y pacientes para evaluación clínica</p>
            </div>

            {/* TÉCNICOS */}
            <div className="relative overflow-hidden rounded-2xl border-2 border-purple-100 bg-gradient-to-br from-purple-50/60 to-white p-5 transition-all duration-300 hover:shadow-lg hover:border-purple-300 hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-purple-700">Técnicos de Simulación</span>
                <div className="p-2.5 bg-purple-600 text-white rounded-xl shadow-md shadow-purple-500/20">
                  <Wrench size={20} />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl md:text-4xl font-black text-slate-800 tabular-nums">
                  {data.registeredStaff?.tecnicos ?? 0}
                </span>
                <span className="text-xs font-bold text-purple-600 bg-purple-100/70 px-2 py-0.5 rounded-full">
                  {data.registeredStaff?.total > 0 ? Math.round(((data.registeredStaff?.tecnicos ?? 0) / data.registeredStaff.total) * 100) : 0}%
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-purple-100">
                <div 
                  className="h-full rounded-full bg-purple-600 transition-all duration-700" 
                  style={{ width: `${data.registeredStaff?.total > 0 ? ((data.registeredStaff?.tecnicos ?? 0) / data.registeredStaff.total) * 100 : 0}%` }} 
                />
              </div>
              <p className="mt-2 text-[11px] font-semibold text-slate-500">Operadores de simulación y soporte</p>
            </div>
          </div>
        </div>

        {/* ---------- Tendencia + Distribución ---------- */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel title="Tendencia diaria de entradas" subtitle="Clasificación por estado de puntualidad" icon={TrendingUp} className="xl:col-span-2" delay={0.25}>
            {hasRecords ? (
              <ChartContainer config={trendConfig} className="aspect-auto h-[300px] w-full">
                <AreaChart data={data.daily} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    {(["aTiempo", "tardanza", "falta"] as const).map((k) => (
                      <linearGradient key={k} id={`fill-${k}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={`var(--color-${k})`} stopOpacity={0.45} />
                        <stop offset="95%" stopColor={`var(--color-${k})`} stopOpacity={0.03} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={24} tick={{ fontSize: 11, fontWeight: 600 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 600 }} />
                  <ChartTooltip cursor={{ stroke: "#cbd5e1", strokeDasharray: "4 4" }} content={<ChartTooltipContent indicator="dot" />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area dataKey="aTiempo" type="monotone" stackId="a" stroke="var(--color-aTiempo)" strokeWidth={2.5} fill="url(#fill-aTiempo)" animationDuration={900} />
                  <Area dataKey="tardanza" type="monotone" stackId="a" stroke="var(--color-tardanza)" strokeWidth={2.5} fill="url(#fill-tardanza)" animationDuration={900} />
                  <Area dataKey="falta" type="monotone" stackId="a" stroke="var(--color-falta)" strokeWidth={2.5} fill="url(#fill-falta)" animationDuration={900} />
                </AreaChart>
              </ChartContainer>
            ) : <EmptyState />}
          </Panel>

          <Panel title="Distribución de estados" subtitle="Sobre el total de entradas" icon={CheckCircle2} delay={0.3}>
            {statusData.length > 0 ? (
              <div className="flex flex-col items-center">
                <div className="relative w-full">
                  <ChartContainer config={statusConfig} className="mx-auto aspect-square h-[220px]">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
                      <Pie data={statusData} dataKey="value" nameKey="key" innerRadius={68} outerRadius={96} paddingAngle={3} cornerRadius={6} strokeWidth={0} animationDuration={900}>
                        {statusData.map((s) => (
                          <Cell key={s.key} fill={COLORS[s.key]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-black text-slate-800">{kpis.punctualityRate}%</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Puntualidad</span>
                  </div>
                </div>
                <div className="mt-4 grid w-full grid-cols-2 gap-2">
                  {data.statusBreakdown.map((s) => (
                    <div key={s.key} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                      <span className="flex items-center gap-2 text-xs font-bold text-slate-600">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[s.key] }} />
                        {s.label}
                      </span>
                      <span className="text-sm font-black text-slate-800 tabular-nums">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <EmptyState message="Sin entradas registradas" />}
          </Panel>
        </div>

        {/* ---------- Horas pico + Sedes ---------- */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title="Horas pico" subtitle="Volumen de marcaciones por hora (hora de Lima)" icon={Clock} delay={0.35}>
            {hasRecords ? (
              <ChartContainer config={hourConfig} className="aspect-auto h-[260px] w-full">
                <BarChart data={data.byHour} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="#e2e8f0" />
                  <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={10} tick={{ fontSize: 11, fontWeight: 600 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 600 }} />
                  <ChartTooltip cursor={{ fill: "#f1f5f9" }} content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="entradas" stackId="h" fill="var(--color-entradas)" radius={[0, 0, 4, 4]} animationDuration={900} />
                  <Bar dataKey="salidas" stackId="h" fill="var(--color-salidas)" radius={[4, 4, 0, 0]} animationDuration={900} />
                </BarChart>
              </ChartContainer>
            ) : <EmptyState />}
          </Panel>

          <Panel title="Rendimiento por sede" subtitle="Entradas, tardanzas y faltas por campus" icon={MapPin} delay={0.4}>
            {data.byCampus.length > 0 ? (
              <ChartContainer config={campusConfig} className="aspect-auto h-[260px] w-full">
                <BarChart data={data.byCampus} layout="vertical" margin={{ top: 0, right: 16, left: 10, bottom: 0 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="4 4" stroke="#e2e8f0" />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 600 }} />
                  <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 11, fontWeight: 700 }} />
                  <ChartTooltip cursor={{ fill: "#f1f5f9" }} content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="entradas" fill="var(--color-entradas)" radius={[0, 6, 6, 0]} barSize={12} animationDuration={900} />
                  <Bar dataKey="tardanzas" fill="var(--color-tardanzas)" radius={[0, 6, 6, 0]} barSize={12} animationDuration={900} />
                  <Bar dataKey="faltas" fill="var(--color-faltas)" radius={[0, 6, 6, 0]} barSize={12} animationDuration={900} />
                </BarChart>
              </ChartContainer>
            ) : <EmptyState message="Aún no hay entradas asociadas a una sede" />}
          </Panel>
        </div>

        {/* ---------- Cursos + Ranking + Roles ---------- */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel title="Cursos con más actividad" subtitle="Top 8 por número de marcaciones" icon={BookOpen} delay={0.45}>
            {data.byCourse.length > 0 ? (
              <ul className="space-y-4">
                {data.byCourse.map((c, i) => (
                  <li key={c.name}>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-bold text-slate-700">
                        <span className="mr-2 text-slate-300 tabular-nums">{String(i + 1).padStart(2, "0")}</span>{c.name}
                      </span>
                      <span className="text-sm font-black text-slate-800 tabular-nums">{c.total}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#1967D2] to-cyan-400 transition-all duration-700" style={{ width: `${(c.total / maxCourse) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState message="Sin cursos registrados" />}
          </Panel>

          <Panel title="Ranking de incidencias" subtitle="Usuarios con más tardanzas y faltas" icon={Trophy} delay={0.5}>
            {data.topLate.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {data.topLate.map((u, i) => {
                  const role = ROLE_STYLES[u.role] ?? { label: u.role, className: "bg-slate-50 text-slate-600 ring-slate-600/10" }
                  const initials = u.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
                  return (
                    <li key={u.userId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <div className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black text-white ${i === 0 ? "bg-gradient-to-br from-rose-500 to-orange-400" : "bg-gradient-to-br from-slate-600 to-slate-400"}`}>
                        {initials}
                        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-black text-slate-700 ring-2 ring-white shadow">{i + 1}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-800">{u.name}</p>
                        <span className={`mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-black ring-1 ring-inset ${role.className}`}>{role.label}</span>
                      </div>
                      <div className="flex gap-1.5 text-right">
                        <span className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-black text-amber-600" title="Tardanzas">{u.tardanzas}T</span>
                        <span className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-black text-rose-600" title="Faltas">{u.faltas}F</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-emerald-500">
                <CheckCircle2 size={32} />
                <p className="text-sm font-bold">¡Sin incidencias en este periodo!</p>
              </div>
            )}
          </Panel>

          <Panel title="Marcaciones por rol" subtitle="Entradas y salidas del periodo" icon={Users} delay={0.55}>
            <div className="space-y-3">
              {data.byRole.map((r) => {
                const share = kpis.total > 0 ? Math.round((r.total / kpis.total) * 100) : 0
                const style = ROLE_STYLES[r.role]
                return (
                  <div key={r.role} className="rounded-2xl border border-slate-100 p-4 transition-colors hover:bg-slate-50">
                    <div className="flex items-center justify-between">
                      <span className={`rounded-lg px-2 py-1 text-xs font-black ring-1 ring-inset ${style?.className ?? ""}`}>{r.label}</span>
                      <span className="text-2xl font-black text-slate-800 tabular-nums">{r.total}</span>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-slate-700 transition-all duration-700" style={{ width: `${share}%` }} />
                      </div>
                      <span className="text-xs font-bold text-slate-400 tabular-nums w-9 text-right">{share}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
