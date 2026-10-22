"use client"

import { useState, useTransition, useEffect } from "react"
import { createPortal } from "react-dom"
import { Role, Shift } from "@prisma/client"
import { TECHNICIAN_SHIFT_PRESETS, type ShiftPreset } from "@/lib/schedule-constants"
import { toast } from "sonner"
import {
  Clock, Plus, Settings2, Trash2, Edit3, ShieldAlert, CheckCircle2,
  AlertTriangle, HelpCircle, Sparkles, Building2, UserCircle2, Loader2,
  PlayCircle, Users, Sun, Sunset, Moon, Coffee, Eye, CalendarDays, CalendarCheck2
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  upsertToleranceRuleAction,
  deleteToleranceRuleAction,
  seedDefaultToleranceRuleAction,
  toggleRuleEarlyToleranceAction,
  toggleRuleLateToleranceAction,
  toggleAllToleranceRulesEarlyAction,
  toggleAllToleranceRulesLateAction,
  type ToleranceRuleInput
} from "@/actions/tolerance"

export type ToleranceRuleItem = {
  id: string
  name?: string | null
  shift?: Shift | null
  daysOfWeek?: string | null
  campusId: string | null
  campus: { id: string; name: string } | null
  role: Role | null
  expectedEntryTime: string
  earlyEntryToleranceMinutes?: number
  gracePeriodMinutes: number
  lateToleranceMinutes: number
  enableEarlyTolerance?: boolean
  enableLateTolerance?: boolean
}

export const DAYS_OF_WEEK = [
  { id: 1, short: "L", label: "Lun", full: "Lunes" },
  { id: 2, short: "M", label: "Mar", full: "Martes" },
  { id: 3, short: "M", label: "Mié", full: "Miércoles" },
  { id: 4, short: "J", label: "Jue", full: "Jueves" },
  { id: 5, short: "V", label: "Vie", full: "Viernes" },
  { id: 6, short: "S", label: "Sáb", full: "Sábado" },
  { id: 0, short: "D", label: "Dom", full: "Domingo" },
]

export function parseActiveDays(daysStr?: string | null): number[] {
  if (!daysStr || daysStr.trim() === "" || daysStr === "ALL") {
    return [1, 2, 3, 4, 5, 6, 0]
  }
  return daysStr
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !isNaN(n))
}

export function getDaysSummary(daysStr?: string | null): {
  title: string
  subtext: string
  badgeBg: string
  badgeText: string
  badgeBorder: string
  activeDays: number[]
} {
  const active = parseActiveDays(daysStr)
  if (active.length === 7) {
    return {
      title: "Todos los días (L — D)",
      subtext: "Lunes a Domingo",
      badgeBg: "bg-blue-50",
      badgeText: "text-blue-700",
      badgeBorder: "border-blue-200",
      activeDays: active,
    }
  }

  const isLV = active.length === 5 && [1, 2, 3, 4, 5].every((d) => active.includes(d))
  if (isLV) {
    return {
      title: "Lunes a Viernes (L — V)",
      subtext: "Horario estándar semanal",
      badgeBg: "bg-emerald-50",
      badgeText: "text-emerald-700",
      badgeBorder: "border-emerald-200",
      activeDays: active,
    }
  }

  const isLVDom = active.length === 6 && [1, 2, 3, 4, 5, 0].every((d) => active.includes(d))
  if (isLVDom) {
    return {
      title: "L-V y Domingos",
      subtext: "Lunes a Viernes + Domingo",
      badgeBg: "bg-teal-50",
      badgeText: "text-teal-700",
      badgeBorder: "border-teal-200",
      activeDays: active,
    }
  }

  const isSab = active.length === 1 && active.includes(6)
  if (isSab) {
    return {
      title: "Solo Sábados (S)",
      subtext: "Horario especial de fin de semana",
      badgeBg: "bg-amber-50",
      badgeText: "text-amber-800",
      badgeBorder: "border-amber-200",
      activeDays: active,
    }
  }

  const isDom = active.length === 1 && active.includes(0)
  if (isDom) {
    return {
      title: "Solo Domingos (D)",
      subtext: "Guardia o turno dominical",
      badgeBg: "bg-purple-50",
      badgeText: "text-purple-700",
      badgeBorder: "border-purple-200",
      activeDays: active,
    }
  }

  const isFinde = active.length === 2 && active.includes(6) && active.includes(0)
  if (isFinde) {
    return {
      title: "Fines de Semana (S — D)",
      subtext: "Sábados y Domingos",
      badgeBg: "bg-indigo-50",
      badgeText: "text-indigo-700",
      badgeBorder: "border-indigo-200",
      activeDays: active,
    }
  }

  const names = active.map((d) => DAYS_OF_WEEK.find((item) => item.id === d)?.label || String(d)).join(", ")
  return {
    title: names,
    subtext: "Días específicos",
    badgeBg: "bg-slate-100",
    badgeText: "text-slate-700",
    badgeBorder: "border-slate-200",
    activeDays: active,
  }
}

export type TechnicianUser = {
  id: string
  name: string
  dni: string
  campusId: string | null
  campus?: { id: string; name: string } | null
  defaultShift?: Shift | null
}

const ROLE_LABELS: Record<string, string> = {
  DOCENTE: "Docentes",
  TECNICO: "Técnicos",
  PACIENTE_SIMULADO: "Pacientes Simulados",
}

const SHIFT_CONFIG: Record<
  string,
  { label: string; icon: any; color: string; bgBadge: string; borderBadge: string; textBadge: string; desc: string }
> = {
  TODOS: {
    label: "Todas las Reglas",
    icon: Settings2,
    color: "from-slate-700 to-slate-900",
    bgBadge: "bg-slate-100",
    borderBadge: "border-slate-300",
    textBadge: "text-slate-700",
    desc: "Vista completa de todas las reglas configuradas",
  },
  MANANA: {
    label: "Turno Mañana",
    icon: Sun,
    color: "from-amber-500 to-orange-500",
    bgBadge: "bg-amber-50",
    borderBadge: "border-amber-200",
    textBadge: "text-amber-700",
    desc: "Horario estándar ~06:00 AM",
  },
  INTERMEDIO: {
    label: "Turno Intermedio",
    icon: Coffee,
    color: "from-cyan-500 to-blue-500",
    bgBadge: "bg-cyan-50",
    borderBadge: "border-cyan-200",
    textBadge: "text-cyan-700",
    desc: "Horario estándar ~08:00 - 10:00 AM",
  },
  TARDE: {
    label: "Turno Tarde",
    icon: Sunset,
    color: "from-purple-500 to-pink-500",
    bgBadge: "bg-purple-50",
    borderBadge: "border-purple-200",
    textBadge: "text-purple-700",
    desc: "Horario estándar ~01:00 PM (13:00)",
  },
  NOCHE: {
    label: "Turno Noche / Guardia",
    icon: Moon,
    color: "from-indigo-600 to-slate-900",
    bgBadge: "bg-indigo-50",
    borderBadge: "border-indigo-200",
    textBadge: "text-indigo-700",
    desc: "Horario estándar ~09:00 PM (21:00)",
  },
}

function timeStringToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number)
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
}

function minutesToTimeString(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, (minutes + 1440) % 1440))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  const period = h >= 12 ? "PM" : "AM"
  const displayH = h % 12 === 0 ? 12 : h % 12
  return `${String(displayH).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`
}

export function DashboardRules({
  rules,
  campuses,
  technicians = [],
}: {
  rules: ToleranceRuleItem[]
  campuses: { id: string; name: string }[]
  technicians?: TechnicianUser[]
}) {
  const [isPending, startTransition] = useTransition()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<ToleranceRuleItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [activeShiftFilter, setActiveShiftFilter] = useState<string>("TODOS")

  // Modal para ver los técnicos afectados por una regla
  const [inspectingRule, setInspectingRule] = useState<ToleranceRuleItem | null>(null)

  // Form state
  const [formData, setFormData] = useState<ToleranceRuleInput>({
    name: "",
    shift: Shift.MANANA,
    daysOfWeek: "1,2,3,4,5,6,0",
    campusId: "",
    role: Role.TECNICO,
    expectedEntryTime: "06:00",
    earlyEntryToleranceMinutes: 15,
    gracePeriodMinutes: 10,
    lateToleranceMinutes: 30,
    enableEarlyTolerance: true,
    enableLateTolerance: true,
  })

  // Quick Simulator state
  const [testTime, setTestTime] = useState("08:12")
  const [testCampusId, setTestCampusId] = useState("")
  const [testRole, setTestRole] = useState<Role | "">("")

  // Contadores y estado de activación general
  const earlyActiveCount = rules.filter((r) => r.enableEarlyTolerance !== false).length
  const lateActiveCount = rules.filter((r) => r.enableLateTolerance !== false).length
  const allEarlyEnabled = rules.length > 0 && earlyActiveCount === rules.length
  const anyEarlyEnabled = earlyActiveCount > 0
  const allLateEnabled = rules.length > 0 && lateActiveCount === rules.length
  const anyLateEnabled = lateActiveCount > 0

  const handleToggleSingleEarly = (id: string, enable: boolean) => {
    startTransition(async () => {
      const res = await toggleRuleEarlyToleranceAction(id, enable)
      if (res.success) {
        toast.success(res.message)
      } else {
        toast.error(res.message)
      }
    })
  }

  const handleToggleSingleLate = (id: string, enable: boolean) => {
    startTransition(async () => {
      const res = await toggleRuleLateToleranceAction(id, enable)
      if (res.success) {
        toast.success(res.message)
      } else {
        toast.error(res.message)
      }
    })
  }

  const handleToggleAllEarly = (enable: boolean) => {
    startTransition(async () => {
      const res = await toggleAllToleranceRulesEarlyAction(enable)
      if (res.success) {
        toast.success(res.message)
      } else {
        toast.error(res.message)
      }
    })
  }

  const handleToggleAllLate = (enable: boolean) => {
    startTransition(async () => {
      const res = await toggleAllToleranceRulesLateAction(enable)
      if (res.success) {
        toast.success(res.message)
      } else {
        toast.error(res.message)
      }
    })
  }

  // Determinar a qué técnicos afecta una regla dada
  const getAffectedTechnicians = (rule: ToleranceRuleItem): TechnicianUser[] => {
    // Si la regla tiene un rol que NO es TECNICO (ej: DOCENTE), no afecta técnicos
    if (rule.role && rule.role !== Role.TECNICO) return []

    return technicians.filter((tech) => {
      // 1. Filtrar por sede si la regla es específica de sede
      if (rule.campusId && tech.campusId !== rule.campusId) {
        return false
      }

      // 2. Si la regla tiene turno asignado, debe coincidir con el defaultShift del técnico
      if (rule.shift) {
        return tech.defaultShift === rule.shift
      }

      // 3. Si la regla no tiene turno explícito pero tiene hora esperada, comparamos hora base
      if (rule.expectedEntryTime === "06:00" && tech.defaultShift === Shift.MANANA) return true
      if (["08:00", "09:00", "10:00"].includes(rule.expectedEntryTime) && tech.defaultShift === Shift.INTERMEDIO) return true
      if (rule.expectedEntryTime === "13:00" && tech.defaultShift === Shift.TARDE) return true
      if (["19:00", "20:00", "21:00"].includes(rule.expectedEntryTime) && tech.defaultShift === Shift.NOCHE) return true

      // Si es global total sin sede ni turno ni rol, afecta a los que no tienen regla más específica
      if (!rule.campusId && !rule.role && !rule.shift) return true

      return false
    })
  }

  const openCreateModal = (prefillShift?: Shift) => {
    setEditingRule(null)
    const targetShift = prefillShift || (activeShiftFilter !== "TODOS" ? (activeShiftFilter as Shift) : Shift.MANANA)
    let defEntry = "06:00"
    let defName = "Regla Turno Mañana"
    let defDays = "1,2,3,4,5,6,0"
    if (targetShift === Shift.INTERMEDIO) {
      defEntry = "09:00"
      defName = "Regla Turno Intermedio"
      defDays = "1,2,3,4,5,0"
    } else if (targetShift === Shift.TARDE) {
      defEntry = "13:00"
      defName = "Regla Turno Tarde"
    } else if (targetShift === Shift.NOCHE) {
      defEntry = "21:00"
      defName = "Regla Turno Noche / Guardia"
    }

    setFormData({
      name: defName,
      shift: targetShift,
      daysOfWeek: defDays,
      campusId: "",
      role: Role.TECNICO,
      expectedEntryTime: defEntry,
      earlyEntryToleranceMinutes: 15,
      gracePeriodMinutes: 10,
      lateToleranceMinutes: 30,
      enableEarlyTolerance: true,
      enableLateTolerance: true,
    })
    setIsModalOpen(true)
  }

  const openEditModal = (rule: ToleranceRuleItem) => {
    setEditingRule(rule)
    setFormData({
      id: rule.id,
      name: rule.name || "",
      shift: rule.shift || null,
      daysOfWeek: rule.daysOfWeek || "1,2,3,4,5,6,0",
      campusId: rule.campusId ?? "",
      role: rule.role,
      expectedEntryTime: rule.expectedEntryTime,
      earlyEntryToleranceMinutes: rule.earlyEntryToleranceMinutes ?? 15,
      gracePeriodMinutes: rule.gracePeriodMinutes,
      lateToleranceMinutes: rule.lateToleranceMinutes,
      enableEarlyTolerance: rule.enableEarlyTolerance !== false,
      enableLateTolerance: rule.enableLateTolerance !== false,
    })
    setIsModalOpen(true)
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const res = await upsertToleranceRuleAction({
        ...formData,
        id: editingRule?.id,
      })
      if (res.success) {
        toast.success(res.message)
        setIsModalOpen(false)
      } else {
        toast.error(res.message)
      }
    })
  }

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const res = await deleteToleranceRuleAction(id)
      if (res.success) {
        toast.success(res.message)
        setDeletingId(null)
      } else {
        toast.error(res.message)
      }
    })
  }

  const handleSeedDefault = () => {
    startTransition(async () => {
      const res = await seedDefaultToleranceRuleAction()
      if (res.success) {
        toast.success(res.message)
      } else {
        toast.error(res.message)
      }
    })
  }

  // Quick evaluation simulation
  const evaluateTest = () => {
    if (rules.length === 0) return { status: "A_TIEMPO", diff: 0, ruleUsed: null, message: null }

    const matchedRule =
      (testCampusId && testRole ? rules.find(r => r.campusId === testCampusId && r.role === testRole) : null) ||
      (testCampusId ? rules.find(r => r.campusId === testCampusId && !r.role) : null) ||
      (testRole ? rules.find(r => !r.campusId && r.role === testRole) : null) ||
      rules.find(r => !r.campusId && !r.role)

    if (!matchedRule) return { status: "A_TIEMPO", diff: 0, ruleUsed: null, message: null }

    const testMinutes = timeStringToMinutes(testTime)
    const expectedMinutes = timeStringToMinutes(matchedRule.expectedEntryTime)
    const diff = testMinutes - expectedMinutes
    const earlyLimit = matchedRule.earlyEntryToleranceMinutes ?? 15

    let status = "A_TIEMPO"
    let message: string | null = null

    // Si la restricción de hora anticipada está activa y llega antes del límite:
    if (matchedRule.enableEarlyTolerance !== false && diff < -earlyLimit) {
      status = "BLOQUEADO"
      message = `Bloqueado por anticipación excesiva (${Math.abs(diff)} min antes, máx ${earlyLimit} min).`
    } else if (matchedRule.enableLateTolerance === false) {
      // Si el control de tardanzas está desactivado: siempre marca A_TIEMPO
      status = "A_TIEMPO"
      message = "Control de tardanzas desactivado en esta regla: Marcación registrada A Tiempo sin penalización."
    } else if (diff <= matchedRule.gracePeriodMinutes) {
      status = "A_TIEMPO"
    } else if (diff <= matchedRule.lateToleranceMinutes) {
      status = "TARDANZA"
    } else {
      status = "FALTA"
    }

    return { status, diff, ruleUsed: matchedRule, message }
  }

  const testResult = evaluateTest()

  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Filtrado de reglas por turno activo
  const filteredRules = rules.filter((r) => {
    if (activeShiftFilter === "TODOS") return true
    if (r.shift === activeShiftFilter) return true
    // Fallback por hora si la regla no tenía shift seteado
    if (!r.shift) {
      if (activeShiftFilter === "MANANA" && r.expectedEntryTime === "06:00") return true
      if (activeShiftFilter === "INTERMEDIO" && ["08:00", "09:00", "10:00"].includes(r.expectedEntryTime)) return true
      if (activeShiftFilter === "TARDE" && r.expectedEntryTime === "13:00") return true
      if (activeShiftFilter === "NOCHE" && ["19:00", "20:00", "21:00"].includes(r.expectedEntryTime)) return true
    }
    return false
  })

  // Conteo de reglas por turno
  const shiftCounts = {
    TODOS: rules.length,
    MANANA: rules.filter(r => r.shift === "MANANA" || (!r.shift && r.expectedEntryTime === "06:00")).length,
    INTERMEDIO: rules.filter(r => r.shift === "INTERMEDIO" || (!r.shift && ["08:00", "09:00", "10:00"].includes(r.expectedEntryTime))).length,
    TARDE: rules.filter(r => r.shift === "TARDE" || (!r.shift && r.expectedEntryTime === "13:00")).length,
    NOCHE: rules.filter(r => r.shift === "NOCHE" || (!r.shift && ["19:00", "20:00", "21:00"].includes(r.expectedEntryTime))).length,
  }

  // Preview numbers for the modal live bar
  const formExpectedMins = timeStringToMinutes(formData.expectedEntryTime)
  const formEarlyLimitMins = formExpectedMins - (Number(formData.earlyEntryToleranceMinutes) || 15)
  const formGraceLimitMins = formExpectedMins + (Number(formData.gracePeriodMinutes) || 0)
  const formLateLimitMins = formExpectedMins + (Number(formData.lateToleranceMinutes) || 0)

  // Modal para ver los colaboradores afectados
  const inspectModalContent = inspectingRule && (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in-up">
      <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-6 md:p-8 relative max-h-[90vh] overflow-y-auto no-scrollbar">
        <button
          onClick={() => setInspectingRule(null)}
          className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-9 h-9 flex items-center justify-center transition-colors"
        >
          ✕
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-blue-50 text-[#1967D2] rounded-2xl">
            <Users size={24} />
          </div>
          <div>
            <h3 className="text-xl font-black text-[#0B1B3D]">Personal Afectado por esta Regla</h3>
            <p className="text-xs text-slate-500 font-medium">
              {inspectingRule.name || `Regla ${inspectingRule.expectedEntryTime}`}
              {inspectingRule.campus ? ` · ${inspectingRule.campus.name}` : " · Todas las sedes"}
            </p>
          </div>
        </div>

        {(() => {
          const daysSummary = getDaysSummary(inspectingRule.daysOfWeek)
          const affected = getAffectedTechnicians(inspectingRule)
          return (
            <div className="space-y-4">
              <div className="p-3 bg-blue-50/80 border border-blue-200/80 rounded-2xl flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <CalendarDays size={16} className="text-[#1967D2]" />
                  <span className="text-xs font-bold text-slate-700">
                    Días en que aplica: <strong className="text-[#1967D2]">{daysSummary.title}</strong>
                  </span>
                </div>
                <span className="text-xs font-mono font-black text-[#1967D2] bg-white px-2.5 py-0.5 rounded-lg border border-blue-200">
                  Ingreso: {inspectingRule.expectedEntryTime}
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-center justify-between text-xs font-bold text-slate-700">
                <span>Total de técnicos vinculados a este turno:</span>
                <span className="bg-[#1967D2] text-white px-2.5 py-0.5 rounded-full font-black text-xs">
                  {affected.length}
                </span>
              </div>

              {affected.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm font-medium">
                  No hay técnicos registrados con este turno o sede en sus perfiles base actualmente.
                </div>
              ) : (
                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                  {affected.map((t) => (
                    <div
                      key={t.id}
                      className="p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-blue-300 hover:bg-blue-50/30 transition-all flex items-center justify-between shadow-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#1967D2] to-indigo-600 text-white font-black flex items-center justify-center text-xs shadow-sm">
                          {t.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-800">{t.name}</p>
                          <p className="text-[11px] text-slate-500 font-mono">DNI: {t.dni}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md block">
                          📍 {t.campus?.name || "Sin sede base"}
                        </span>
                        <span className="text-[10px] font-black text-amber-700 uppercase tracking-wider mt-1 block">
                          {t.defaultShift || "Sin turno"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                type="button"
                onClick={() => setInspectingRule(null)}
                className="w-full h-12 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold rounded-xl"
              >
                Cerrar Lista
              </Button>
            </div>
          )
        })()}
      </div>
    </div>
  )

  const modalContent = isModalOpen && (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in-up">
      <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-6 md:p-8 relative max-h-[92vh] overflow-y-auto no-scrollbar">
        <button
          onClick={() => setIsModalOpen(false)}
          className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-9 h-9 flex items-center justify-center transition-colors"
        >
          ✕
        </button>

        <div className="flex items-center gap-3 mb-1">
          <div className="p-2.5 bg-blue-50 text-[#1967D2] rounded-2xl">
            <Settings2 size={24} />
          </div>
          <div>
            <h3 className="text-2xl font-black text-[#0B1B3D]">
              {editingRule ? "Editar Regla de Horario" : "Nueva Regla de Horario"}
            </h3>
            <p className="text-xs text-slate-400 font-medium">Asigna el nombre, grupo de turno y tolerancias</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4 mt-5">
          {/* Nombre descriptivo y Turno */}
          <div className="space-y-3 p-4 bg-slate-50 border border-slate-200/80 rounded-2xl">
            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-slate-700 block mb-1">
                Nombre de la Regla / Grupo (Identificador)
              </label>
              <Input
                type="text"
                placeholder="Ej: Turno Mañana Villa, Guardia Noche Ate..."
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="h-11 rounded-xl bg-white font-bold text-sm text-slate-800"
              />
            </div>

            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-slate-700 block mb-1">
                Turno Correspondiente
              </label>
              <select
                value={formData.shift || ""}
                onChange={(e) => {
                  const s = (e.target.value as Shift) || null
                  let newEntry = formData.expectedEntryTime
                  if (s === Shift.MANANA && newEntry !== "06:00") newEntry = "06:00"
                  if (s === Shift.INTERMEDIO && !["08:00", "09:00", "10:00"].includes(newEntry)) newEntry = "09:00"
                  if (s === Shift.TARDE && newEntry !== "13:00") newEntry = "13:00"
                  setFormData({ ...formData, shift: s, expectedEntryTime: newEntry })
                }}
                className="w-full h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#1967D2]"
              >
                <option value="">(Sin clasificar / Global general)</option>
                <option value="MANANA">🌅 Turno Mañana (~06:00 AM)</option>
                <option value="INTERMEDIO">⛅ Turno Intermedio (~09:00 AM)</option>
                <option value="TARDE">🌆 Turno Tarde (~01:00 PM / 13:00)</option>
              </select>
            </div>
          </div>

          {/* Presets Rápidos de Turnos para Técnicos */}
          <div className="p-3.5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-[#1967D2] flex items-center gap-1.5">
                <Sparkles size={14} /> Presets Oficiales
              </span>
              <span className="text-[10px] text-slate-500 font-bold">Clic para autocompletar</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TECHNICIAN_SHIFT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setFormData((prev) => ({
                      ...prev,
                      name: p.name,
                      shift: p.shift,
                      role: Role.TECNICO,
                      expectedEntryTime: p.entry,
                      daysOfWeek: p.daysOfWeek || "1,2,3,4,5,6,0",
                      earlyEntryToleranceMinutes: p.early,
                      gracePeriodMinutes: p.grace,
                      lateToleranceMinutes: p.late,
                    }))
                    toast.info(`Cargado: ${p.name} (${p.entry})`)
                  }}
                  className="text-left p-2 rounded-xl border border-blue-200/60 bg-white hover:bg-blue-100/50 hover:border-[#1967D2] transition-all group shadow-xs"
                >
                  <p className="text-[11px] font-black text-slate-800 group-hover:text-[#1967D2] truncate">
                    {p.name}
                  </p>
                  <span className="font-mono text-[10px] font-bold text-[#1967D2] bg-blue-50 px-1 py-0.5 rounded mt-0.5 inline-block">
                    {p.entry}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* DÍAS DE APLICACIÓN DEL TURNO */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <CalendarDays size={14} className="text-[#1967D2]" /> Días en que aplica esta regla
              </label>
              <span className="text-[10px] font-extrabold text-[#1967D2] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                {getDaysSummary(formData.daysOfWeek).title}
              </span>
            </div>

            {/* Presets rápidos de días */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "L-V (Lunes a Viernes)", val: "1,2,3,4,5" },
                { label: "L-V y Domingo", val: "1,2,3,4,5,0" },
                { label: "Solo Sábados", val: "6" },
                { label: "Solo Domingos", val: "0" },
                { label: "Fines de Semana (S-D)", val: "6,0" },
                { label: "Todos los días (L-D)", val: "1,2,3,4,5,6,0" },
              ].map((preset) => {
                const isCurrent = formData.daysOfWeek === preset.val
                return (
                  <button
                    key={preset.val}
                    type="button"
                    onClick={() => setFormData({ ...formData, daysOfWeek: preset.val })}
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${
                      isCurrent
                        ? "bg-[#1967D2] text-white border-[#1967D2] shadow-xs"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>

            {/* Toggle individual por cada día L M M J V S D */}
            <div className="grid grid-cols-7 gap-1 pt-0.5">
              {DAYS_OF_WEEK.map((d) => {
                const currentActive = parseActiveDays(formData.daysOfWeek)
                const isSelected = currentActive.includes(d.id)
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      let next: number[]
                      if (isSelected) {
                        next = currentActive.filter((id) => id !== d.id)
                      } else {
                        next = [...currentActive, d.id]
                      }
                      if (next.length === 0) {
                        toast.warning("Debe seleccionar al menos un día.")
                        return
                      }
                      setFormData({ ...formData, daysOfWeek: next.join(",") })
                    }}
                    className={`py-1.5 px-1 rounded-xl border flex flex-col items-center justify-center transition-all ${
                      isSelected
                        ? "bg-blue-600 border-blue-600 text-white font-black shadow-xs ring-2 ring-blue-300"
                        : "bg-white border-slate-200 text-slate-400 hover:bg-slate-100 font-bold"
                    }`}
                  >
                    <span className="text-[11px] font-black">{d.short}</span>
                    <span className="text-[9px] uppercase tracking-tighter opacity-90">{d.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Sede y Rol en dos columnas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-slate-700">Sede</label>
              <select
                value={formData.campusId ?? ""}
                onChange={(e) => setFormData({ ...formData, campusId: e.target.value })}
                className="w-full h-11 mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#1967D2]"
              >
                <option value="">Todas las Sedes (Global)</option>
                {campuses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-slate-700">Rol Afectado</label>
              <select
                value={formData.role ?? ""}
                onChange={(e) => setFormData({ ...formData, role: (e.target.value as Role) || null })}
                className="w-full h-11 mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#1967D2]"
              >
                <option value="">Todos los roles</option>
                <option value="DOCENTE">Docentes</option>
                <option value="TECNICO">Técnicos</option>
                <option value="PACIENTE_SIMULADO">Pacientes Sim.</option>
              </select>
            </div>
          </div>

          {/* Hora Oficial, Anticipación, Gracia y Tolerancia */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-slate-700">Hora Entrada</label>
              <Input
                type="time"
                required
                value={formData.expectedEntryTime}
                onChange={(e) => setFormData({ ...formData, expectedEntryTime: e.target.value })}
                className="h-11 mt-1 rounded-xl text-base font-black bg-slate-50 px-2.5"
              />
            </div>

            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-sky-700">Anticipación</label>
              <div className="relative mt-1">
                <Input
                  type="number"
                  min={0}
                  max={120}
                  required
                  value={formData.earlyEntryToleranceMinutes ?? 15}
                  onChange={(e) => setFormData({ ...formData, earlyEntryToleranceMinutes: Number(e.target.value) })}
                  className="h-11 rounded-xl text-sm font-bold bg-slate-50 pr-9"
                  title="Minutos antes de la hora oficial en que se permite marcar"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">min</span>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Gracia</label>
              <div className="relative mt-1">
                <Input
                  type="number"
                  min={0}
                  max={120}
                  required
                  value={formData.gracePeriodMinutes}
                  onChange={(e) => setFormData({ ...formData, gracePeriodMinutes: Number(e.target.value) })}
                  className="h-11 rounded-xl text-sm font-bold bg-slate-50 pr-9"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">min</span>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-black uppercase tracking-wider text-amber-700">Tardanza</label>
              <div className="relative mt-1">
                <Input
                  type="number"
                  min={formData.gracePeriodMinutes}
                  max={240}
                  required
                  value={formData.lateToleranceMinutes}
                  onChange={(e) => setFormData({ ...formData, lateToleranceMinutes: Number(e.target.value) })}
                  className="h-11 rounded-xl text-sm font-bold bg-slate-50 pr-9"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">min</span>
              </div>
            </div>
          </div>

          {/* Opciones de Activación / Desactivación de Hora Anticipada y Tardanzas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            {/* Switch Hora Anticipada */}
            <div className="flex items-center justify-between gap-2 p-2.5 bg-white rounded-xl border border-slate-200/60 shadow-xs">
              <div className="space-y-0.5 pr-2">
                <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <Clock size={14} className="text-sky-600" />
                  Restricción Hora Anticipada
                </label>
                <p className="text-[10px] text-slate-500 leading-tight">
                  {formData.enableEarlyTolerance !== false
                    ? "Control ACTIVO: Bloquea marcaciones previas al horario."
                    : "DESACTIVADO: Permite marcar libremente antes del horario."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, enableEarlyTolerance: !(formData.enableEarlyTolerance !== false) })}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 focus:outline-none ${
                  formData.enableEarlyTolerance !== false ? "bg-sky-600" : "bg-slate-300"
                }`}
                title="Activar/Desactivar restricción de hora anticipada"
              >
                <span className={`block w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                  formData.enableEarlyTolerance !== false ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>

            {/* Switch Control de Tardanzas */}
            <div className="flex items-center justify-between gap-2 p-2.5 bg-white rounded-xl border border-slate-200/60 shadow-xs">
              <div className="space-y-0.5 pr-2">
                <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-amber-600" />
                  Control de Tardanzas
                </label>
                <p className="text-[10px] text-slate-500 leading-tight">
                  {formData.enableLateTolerance !== false
                    ? "Control ACTIVO: Penaliza como Tardanza / Falta."
                    : "DESACTIVADO: Las llegadas tardías marcan A Tiempo."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, enableLateTolerance: !(formData.enableLateTolerance !== false) })}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0 focus:outline-none ${
                  formData.enableLateTolerance !== false ? "bg-amber-500" : "bg-slate-300"
                }`}
                title="Activar/Desactivar control de tardanzas"
              >
                <span className={`block w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                  formData.enableLateTolerance !== false ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>
          </div>

          {/* Vista Previa Dinámica de la Regla */}
          <div className="rounded-2xl bg-slate-50/90 p-4 border border-slate-200/70 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-slate-400">
              <span>Evaluación automática</span>
              <span className="text-[#1967D2]">Entrada oficial: {formData.expectedEntryTime}</span>
            </div>
            <div className="text-xs space-y-1 font-semibold text-slate-700">
              <div className="flex items-center justify-between text-sky-800 bg-sky-50/80 px-3 py-1.5 rounded-xl border border-sky-100">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                  <strong>Permitido marcar desde:</strong>
                </span>
                <span>
                  {formData.enableEarlyTolerance !== false
                    ? `${minutesToTimeString(formEarlyLimitMins)} (-${formData.earlyEntryToleranceMinutes ?? 15} min)`
                    : "En cualquier momento (Sin restricción previa)"}
                </span>
              </div>
              <div className="flex items-center justify-between text-emerald-700 bg-emerald-50/70 px-3 py-1.5 rounded-xl border border-emerald-100">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <strong>A Tiempo (Puntual):</strong>
                </span>
                <span>
                  {formData.enableLateTolerance !== false
                    ? `Hasta las ${minutesToTimeString(formGraceLimitMins)}`
                    : "Siempre A Tiempo (Control de tardanzas desactivado)"}
                </span>
              </div>
              {formData.enableLateTolerance !== false ? (
                <>
                  <div className="flex items-center justify-between text-amber-700 bg-amber-50/70 px-3 py-1.5 rounded-xl border border-amber-100">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      <strong>Tardanza:</strong>
                    </span>
                    <span>{minutesToTimeString(formGraceLimitMins + 1)} — {minutesToTimeString(formLateLimitMins)}</span>
                  </div>
                  <div className="flex items-center justify-between text-rose-700 bg-rose-50/70 px-3 py-1.5 rounded-xl border border-rose-100">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-rose-500" />
                      <strong>Falta:</strong>
                    </span>
                    <span>A partir de las {minutesToTimeString(formLateLimitMins + 1)}</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsModalOpen(false)}
              className="flex-1 h-12 rounded-xl font-bold border-slate-200"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="flex-1 h-12 rounded-xl bg-[#1967D2] hover:bg-blue-800 text-white font-extrabold shadow-lg shadow-blue-500/20"
            >
              {isPending ? <Loader2 size={18} className="animate-spin mr-2" /> : null}
              {editingRule ? "Guardar Cambios" : "Crear Regla"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )

  return (
    <>
      <div className="space-y-8 animate-fade-in-up pb-12">
        {/* Header Banner */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B1B3D] via-[#12306b] to-[#1967D2] p-8 text-white shadow-xl shadow-blue-900/20">
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.25em] text-blue-200">
                <Clock size={16} /> Motor de Grupos de Turnos y Tolerancias
              </div>
              <h2 className="mt-2 text-3xl font-black tracking-tight">Turnos y Reglas de Tolerancia</h2>
              <p className="mt-2 text-sm text-blue-100/80 max-w-2xl font-medium">
                Visualiza y gestiona claramente qué reglas pertenecen al turno Mañana, Intermedio o Tarde, y consulta exactamente a qué técnicos afecta cada horario configurado.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {rules.length === 0 && (
                <Button
                  onClick={handleSeedDefault}
                  disabled={isPending}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-12 px-6 rounded-2xl shadow-lg shadow-emerald-900/30 transition-transform hover:scale-105"
                >
                  <Sparkles className="mr-2" size={18} /> Inicializar Regla Predeterminada
                </Button>
              )}
              <Button
                onClick={() => openCreateModal()}
                disabled={isPending}
                className="bg-white hover:bg-blue-50 text-[#0B1B3D] font-extrabold h-12 px-6 rounded-2xl shadow-lg shadow-black/10 transition-transform hover:scale-105"
              >
                <Plus className="mr-2" size={20} /> Nueva Regla
              </Button>
            </div>
          </div>
        </div>

        {/* PANEL DE CONTROL GENERAL DE HORA ANTICIPADA Y TARDANZAS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: Control de Hora Anticipada */}
          <div className="p-5 rounded-3xl bg-white border-2 border-slate-200/90 shadow-sm flex flex-col justify-between space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-2xl ${allEarlyEnabled ? "bg-sky-500 text-white" : anyEarlyEnabled ? "bg-amber-500 text-white" : "bg-slate-300 text-slate-700"}`}>
                  <Clock size={22} />
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-800">
                    Control de Hora Anticipada de Ingreso
                  </h4>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    {allEarlyEnabled
                      ? "Restricción activa: El personal solo puede marcar dentro del tiempo de anticipación configurado."
                      : !anyEarlyEnabled
                      ? "Restricción desactivada: El personal puede marcar en cualquier momento previo sin restricción."
                      : `Parcialmente activa: Activa en ${earlyActiveCount} de ${rules.length} reglas.`}
                  </p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider shrink-0 ${
                allEarlyEnabled ? "bg-sky-100 text-sky-800 border border-sky-200" : !anyEarlyEnabled ? "bg-slate-100 text-slate-600 border border-slate-200" : "bg-amber-100 text-amber-800 border border-amber-200"
              }`}>
                {allEarlyEnabled ? "✓ Activado" : !anyEarlyEnabled ? "✕ Desactivado" : "Mixto"}
              </span>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-[11px] font-bold text-slate-400">
                Activo en {earlyActiveCount} de {rules.length} reglas
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending || !anyEarlyEnabled}
                  onClick={() => handleToggleAllEarly(false)}
                  className="text-xs font-bold text-slate-600 hover:bg-slate-100 h-8 rounded-xl"
                >
                  Desactivar en todas
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending || allEarlyEnabled}
                  onClick={() => handleToggleAllEarly(true)}
                  className="text-xs font-bold bg-sky-600 hover:bg-sky-700 text-white h-8 rounded-xl"
                >
                  Activar en todas
                </Button>
              </div>
            </div>
          </div>

          {/* Card 2: Control de Tardanzas */}
          <div className="p-5 rounded-3xl bg-white border-2 border-slate-200/90 shadow-sm flex flex-col justify-between space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-2xl ${allLateEnabled ? "bg-amber-500 text-white" : anyLateEnabled ? "bg-orange-500 text-white" : "bg-slate-300 text-slate-700"}`}>
                  <AlertTriangle size={22} />
                </div>
                <div>
                  <h4 className="text-sm font-black text-slate-800">
                    Control de Tardanzas y Tolerancias
                  </h4>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    {allLateEnabled
                      ? "Control activo: Las entradas fuera de gracia se computan como Tardanza o Falta."
                      : !anyLateEnabled
                      ? "Control desactivado: Las llegadas tardías marcan A Tiempo (sin penalización)."
                      : `Parcialmente activo: Activo en ${lateActiveCount} de ${rules.length} reglas.`}
                  </p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider shrink-0 ${
                allLateEnabled ? "bg-amber-100 text-amber-800 border border-amber-200" : !anyLateEnabled ? "bg-slate-100 text-slate-600 border border-slate-200" : "bg-orange-100 text-orange-800 border border-orange-200"
              }`}>
                {allLateEnabled ? "✓ Activado" : !anyLateEnabled ? "✕ Desactivado" : "Mixto"}
              </span>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-[11px] font-bold text-slate-400">
                Activo en {lateActiveCount} de {rules.length} reglas
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending || !anyLateEnabled}
                  onClick={() => handleToggleAllLate(false)}
                  className="text-xs font-bold text-slate-600 hover:bg-slate-100 h-8 rounded-xl"
                >
                  Desactivar en todas
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending || allLateEnabled}
                  onClick={() => handleToggleAllLate(true)}
                  className="text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white h-8 rounded-xl"
                >
                  Activar en todas
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* NAVEGACIÓN POR PESTAÑAS DE TURNOS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["TODOS", "MANANA", "INTERMEDIO", "TARDE"] as const).map((shiftKey) => {
            const conf = SHIFT_CONFIG[shiftKey]
            const Icon = conf.icon
            const isSelected = activeShiftFilter === shiftKey
            const count = shiftCounts[shiftKey]

            return (
              <button
                key={shiftKey}
                onClick={() => setActiveShiftFilter(shiftKey)}
                className={`p-4 rounded-2xl border-2 text-left transition-all duration-300 relative overflow-hidden flex flex-col justify-between ${
                  isSelected
                    ? "bg-white border-[#1967D2] shadow-lg shadow-blue-500/10 scale-[1.02]"
                    : "bg-white/70 border-slate-200/80 hover:bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={`p-2 rounded-xl text-white bg-gradient-to-br ${conf.color}`}>
                    <Icon size={18} />
                  </div>
                  <span className={`text-xs font-black px-2 py-0.5 rounded-full ${conf.bgBadge} ${conf.textBadge} border ${conf.borderBadge}`}>
                    {count} {count === 1 ? "regla" : "reglas"}
                  </span>
                </div>
                <div>
                  <p className={`text-sm font-black ${isSelected ? "text-[#1967D2]" : "text-slate-800"}`}>
                    {conf.label}
                  </p>
                  <p className="text-[11px] font-medium text-slate-400 mt-0.5">
                    {conf.desc}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Grid: Reglas Activas Filtradas + Simulador en Tiempo Real */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* LISTADO DE REGLAS */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Settings2 size={20} className="text-[#1967D2]" />
                Reglas del Grupo: {SHIFT_CONFIG[activeShiftFilter]?.label}
              </h3>
              <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
                {filteredRules.length} {filteredRules.length === 1 ? "regla activa" : "reglas activas"}
              </span>
            </div>

            {filteredRules.length === 0 ? (
              <Card className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-[#1967D2] mb-4">
                  <Clock size={32} />
                </div>
                <h4 className="text-xl font-black text-slate-800">
                  No hay reglas configuradas para {SHIFT_CONFIG[activeShiftFilter]?.label}
                </h4>
                <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
                  Puedes crear una regla específica para este turno indicando la sede y horas de entrada permitidas.
                </p>
                <Button
                  onClick={() => openCreateModal(activeShiftFilter !== "TODOS" ? (activeShiftFilter as Shift) : undefined)}
                  disabled={isPending}
                  className="mt-6 bg-[#1967D2] hover:bg-blue-700 text-white font-bold px-8 h-12 rounded-xl"
                >
                  <Plus className="mr-2" size={18} /> Crear Regla para este Turno
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredRules.map((rule) => {
                  const expMins = timeStringToMinutes(rule.expectedEntryTime)
                  const graceMins = expMins + rule.gracePeriodMinutes
                  const lateMins = expMins + rule.lateToleranceMinutes
                  const isGlobal = !rule.campusId && !rule.role
                  const affectedTechs = getAffectedTechnicians(rule)

                  // Resolver grupo visual del turno
                  const shiftKey = rule.shift || (
                    rule.expectedEntryTime === "06:00" ? "MANANA" :
                    ["08:00", "09:00", "10:00"].includes(rule.expectedEntryTime) ? "INTERMEDIO" :
                    rule.expectedEntryTime === "13:00" ? "TARDE" :
                    ["19:00", "20:00", "21:00"].includes(rule.expectedEntryTime) ? "NOCHE" : null
                  )
                  const shiftConf = shiftKey ? SHIFT_CONFIG[shiftKey] : null
                  const daysSummary = getDaysSummary(rule.daysOfWeek)

                  return (
                    <Card
                      key={rule.id}
                      className="group rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-200/40 transition-all duration-300 hover:shadow-xl hover:border-blue-200"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-100">
                        <div className="space-y-1.5">
                          {/* Nombre de la Regla */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-lg font-black text-slate-800">
                              {rule.name || `Regla de Entrada ${rule.expectedEntryTime}`}
                            </h4>
                            {shiftConf && (
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-black ${shiftConf.bgBadge} ${shiftConf.textBadge} border ${shiftConf.borderBadge}`}>
                                {shiftConf.label}
                              </span>
                            )}
                          </div>

                          {/* Alcance: Sede y Rol */}
                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            {isGlobal ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-700 font-bold border border-indigo-100">
                                <Sparkles size={12} /> Global (Todas las sedes y roles)
                              </span>
                            ) : (
                              <>
                                {rule.campus ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-blue-700 font-bold border border-blue-100">
                                    <Building2 size={12} /> {rule.campus.name}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600 font-bold">
                                    Todas las sedes
                                  </span>
                                )}

                                {rule.role ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-purple-700 font-bold border border-purple-100">
                                    <UserCircle2 size={12} /> {ROLE_LABELS[rule.role] || rule.role}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600 font-bold">
                                    Todos los roles
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Botones de acción */}
                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditModal(rule)}
                            className="h-9 px-3.5 rounded-xl font-bold text-slate-700 hover:text-[#1967D2] hover:bg-blue-50 border-slate-200"
                          >
                            <Edit3 size={14} className="mr-1.5" /> Editar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(rule.id)}
                            disabled={isPending}
                            className="h-9 px-3.5 rounded-xl font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-100"
                          >
                            <Trash2 size={14} className="mr-1.5" /> Eliminar
                          </Button>
                        </div>
                      </div>

                      {/* DÍAS EN QUE APLICA ESTA REGLA */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3.5 my-3.5 rounded-2xl bg-gradient-to-r from-slate-50 via-blue-50/20 to-slate-50 border border-slate-200/80">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black border ${daysSummary.badgeBg} ${daysSummary.badgeText} ${daysSummary.badgeBorder}`}>
                            <CalendarDays size={13} /> {daysSummary.title}
                          </span>
                          <span className="text-[11px] text-slate-500 font-semibold hidden sm:inline">
                            {daysSummary.subtext}
                          </span>
                        </div>

                        {/* Mini chips circulares de días L M M J V S D */}
                        <div className="flex items-center gap-1">
                          {DAYS_OF_WEEK.map((d) => {
                            const isActive = daysSummary.activeDays.includes(d.id)
                            return (
                              <span
                                key={d.id}
                                title={`${d.full}: ${isActive ? "Regla activa este día" : "No aplica"}`}
                                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] transition-all ${
                                  isActive
                                    ? "bg-[#1967D2] text-white font-black shadow-xs ring-1 ring-[#1967D2]"
                                    : "bg-slate-200/60 text-slate-400 opacity-40 font-bold"
                                }`}
                              >
                                {d.short}
                              </span>
                            )
                          })}
                        </div>
                      </div>

                      {/* Control de Activación Rápida: Hora Anticipada y Tardanzas */}
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        {/* Toggle Hora Anticipada */}
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleToggleSingleEarly(rule.id, !(rule.enableEarlyTolerance ?? true))}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border shadow-xs cursor-pointer ${
                            (rule.enableEarlyTolerance ?? true)
                              ? "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100"
                              : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200"
                          }`}
                          title="Clic para alternar activación de restricción de hora anticipada"
                        >
                          <span className={`w-2 h-2 rounded-full ${(rule.enableEarlyTolerance ?? true) ? "bg-sky-500 animate-pulse" : "bg-slate-400"}`} />
                          <span className="text-slate-600">Hora Anticipada:</span>
                          <span className="font-black">
                            {(rule.enableEarlyTolerance ?? true) ? "ACTIVADA (Bloquea previo)" : "DESACTIVADA (Libre)"}
                          </span>
                        </button>

                        {/* Toggle Tardanzas */}
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleToggleSingleLate(rule.id, !(rule.enableLateTolerance ?? true))}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border shadow-xs cursor-pointer ${
                            (rule.enableLateTolerance ?? true)
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                              : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                          }`}
                          title="Clic para alternar activación de control de tardanzas"
                        >
                          <span className={`w-2 h-2 rounded-full ${(rule.enableLateTolerance ?? true) ? "bg-emerald-500 animate-pulse" : "bg-amber-400"}`} />
                          <span className="text-slate-600">Tardanzas:</span>
                          <span className="font-black">
                            {(rule.enableLateTolerance ?? true) ? "ACTIVADAS (Evalúa falta/tardanza)" : "DESACTIVADAS (Puntual siempre)"}
                          </span>
                        </button>
                      </div>

                      {/* Resumen numérico en 4 columnas */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                        <div className="rounded-2xl bg-slate-50 p-3.5 border border-slate-100">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Hora Oficial</p>
                          <p className="text-xl font-black text-slate-800 mt-0.5">{rule.expectedEntryTime}</p>
                          <p className="text-[11px] font-medium text-slate-500 mt-0.5">{minutesToTimeString(expMins)}</p>
                        </div>

                        <div className="rounded-2xl bg-sky-50/70 p-3.5 border border-sky-100">
                          <p className="text-[10px] font-black uppercase tracking-wider text-sky-700">Anticipación Máx</p>
                          <p className="text-xl font-black text-sky-800 mt-0.5">{rule.earlyEntryToleranceMinutes ?? 15} min</p>
                          <p className="text-[11px] font-medium text-sky-700 mt-0.5">Desde {minutesToTimeString(expMins - (rule.earlyEntryToleranceMinutes ?? 15))}</p>
                        </div>

                        <div className="rounded-2xl bg-emerald-50/60 p-3.5 border border-emerald-100">
                          <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Cortesía / Gracia</p>
                          <p className="text-xl font-black text-emerald-800 mt-0.5">+{rule.gracePeriodMinutes} min</p>
                          <p className="text-[11px] font-medium text-emerald-700 mt-0.5">Puntual hasta {minutesToTimeString(graceMins)}</p>
                        </div>

                        <div className="rounded-2xl bg-amber-50/60 p-3.5 border border-amber-100">
                          <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Límite Tardanza</p>
                          <p className="text-xl font-black text-amber-800 mt-0.5">+{rule.lateToleranceMinutes} min</p>
                          <p className="text-[11px] font-medium text-amber-700 mt-0.5">Falta desde {minutesToTimeString(lateMins + 1)}</p>
                        </div>
                      </div>

                      {/* SECCIÓN VISUAL: A QUIÉNES AFECTA ESTA REGLA */}
                      <div className="mt-4 pt-3.5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70 -mx-6 -mb-6 px-6 py-3.5 rounded-b-3xl">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                            <Users size={16} className="text-[#1967D2]" />
                            Afecta a:
                          </span>

                          {affectedTechs.length > 0 ? (
                            <div className="flex items-center -space-x-2 overflow-hidden">
                              {affectedTechs.slice(0, 5).map((t) => (
                                <div
                                  key={t.id}
                                  title={`${t.name} (${t.campus?.name || "Sin sede"})`}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-[10px] font-black text-white ring-2 ring-white"
                                >
                                  {t.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
                                </div>
                              ))}
                              {affectedTechs.length > 5 && (
                                <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[10px] font-black text-slate-700 ring-2 ring-white">
                                  +{affectedTechs.length - 5}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 font-medium italic">
                              Sin técnicos base asignados
                            </span>
                          )}

                          <span className="text-xs font-black text-slate-700 ml-1">
                            {affectedTechs.length} {affectedTechs.length === 1 ? "técnico" : "técnicos"}
                          </span>
                        </div>

                        {affectedTechs.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setInspectingRule(rule)}
                            className="text-xs font-bold text-[#1967D2] hover:text-blue-800 hover:bg-blue-50 h-8 px-2.5 rounded-lg flex items-center gap-1"
                          >
                            <Eye size={14} /> Ver nombres completos
                          </Button>
                        )}
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>

          {/* SIMULADOR EN VIVO */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <PlayCircle size={20} className="text-emerald-600" /> Simulador de Marcación
              </h3>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                En tiempo real
              </span>
            </div>

            <Card className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-200/50 space-y-5">
              <div>
                <p className="text-xs font-medium text-slate-500">
                  Prueba cómo clasificará el sistema a un colaborador que marque a una hora específica.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">Hora de Marcación a probar</label>
                  <Input
                    type="time"
                    value={testTime}
                    onChange={(e) => setTestTime(e.target.value)}
                    className="h-12 mt-1 rounded-xl text-lg font-black bg-slate-50"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">Sede (Opcional)</label>
                  <select
                    value={testCampusId}
                    onChange={(e) => setTestCampusId(e.target.value)}
                    className="w-full h-11 mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none"
                  >
                    <option value="">Todas las sedes (Global)</option>
                    {campuses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">Rol (Opcional)</label>
                  <select
                    value={testRole}
                    onChange={(e) => setTestRole(e.target.value as Role | "")}
                    className="w-full h-11 mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none"
                  >
                    <option value="">Cualquier Rol</option>
                    <option value="DOCENTE">Docente</option>
                    <option value="TECNICO">Técnico</option>
                    <option value="PACIENTE_SIMULADO">Paciente Simulado</option>
                  </select>
                </div>
              </div>

              {/* Resultado de la simulación */}
              <div className="rounded-2xl p-5 border text-center transition-all bg-slate-50/80">
                <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Resultado Evaluado</p>
                
                <div className="mt-3">
                  {testResult.status === "BLOQUEADO" && (
                    <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 text-white px-5 py-2.5 font-black text-lg shadow-lg">
                      <ShieldAlert size={24} className="text-rose-400" /> ENTRADA BLOQUEADA
                    </div>
                  )}
                  {testResult.status === "A_TIEMPO" && (
                    <div className="inline-flex items-center gap-2 rounded-2xl bg-emerald-100/80 px-5 py-2.5 text-emerald-800 font-black text-lg">
                      <CheckCircle2 size={24} className="text-emerald-600" /> A TIEMPO (Puntual)
                    </div>
                  )}
                  {testResult.status === "TARDANZA" && (
                    <div className="inline-flex items-center gap-2 rounded-2xl bg-amber-100/80 px-5 py-2.5 text-amber-800 font-black text-lg">
                      <AlertTriangle size={24} className="text-amber-600" /> TARDANZA
                    </div>
                  )}
                  {testResult.status === "FALTA" && (
                    <div className="inline-flex items-center gap-2 rounded-2xl bg-rose-100/80 px-5 py-2.5 text-rose-800 font-black text-lg">
                      <ShieldAlert size={24} className="text-rose-600" /> FALTA
                    </div>
                  )}
                </div>

                <div className="mt-3 text-xs text-slate-600 space-y-1">
                  {testResult.message && (
                    <p className="text-rose-600 font-bold bg-rose-50 p-2 rounded-lg border border-rose-100">
                      ⚠️ {testResult.message}
                    </p>
                  )}
                  {testResult.ruleUsed ? (
                    <>
                      <p className="font-bold">
                        Diferencia: {testResult.diff > 0 ? `+${testResult.diff} min tarde` : `${Math.abs(testResult.diff)} min antes de hora`}
                      </p>
                      <p className="text-slate-400">
                        Regla aplicada: {testResult.ruleUsed.name || testResult.ruleUsed.campus?.name || "Global"} ({testResult.ruleUsed.expectedEntryTime} oficial)
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-400 italic">No hay regla configurada (Se asume A tiempo por defecto)</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-blue-50/50 p-4 border border-blue-100 text-xs text-blue-900 flex items-start gap-2.5">
                <HelpCircle size={18} className="text-[#1967D2] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong>¿Cómo funciona la prioridad?</strong> El sistema busca primero una regla que coincida con la Sede y Rol del usuario. Si no encuentra, busca por Sede, luego por Rol, y finalmente usa la Regla Global.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>

      {mounted && typeof document !== "undefined" && modalContent && createPortal(modalContent, document.body)}
      {mounted && typeof document !== "undefined" && inspectModalContent && createPortal(inspectModalContent, document.body)}
    </>
  )
}
