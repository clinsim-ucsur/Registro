"use client"

import { useState, useTransition } from "react"
import { Role } from "@prisma/client"
import { toast } from "sonner"
import {
  Clock, Plus, Settings2, Trash2, Edit3, ShieldAlert, CheckCircle2,
  AlertTriangle, HelpCircle, Sparkles, Building2, UserCircle2, Loader2, PlayCircle
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  upsertToleranceRuleAction,
  deleteToleranceRuleAction,
  seedDefaultToleranceRuleAction,
  type ToleranceRuleInput
} from "@/actions/tolerance"

type ToleranceRuleItem = {
  id: string
  campusId: string | null
  campus: { id: string; name: string } | null
  role: Role | null
  expectedEntryTime: string
  gracePeriodMinutes: number
  lateToleranceMinutes: number
}

const ROLE_LABELS: Record<string, string> = {
  DOCENTE: "Docentes",
  TECNICO: "Técnicos",
  PACIENTE_SIMULADO: "Pacientes Simulados",
}

function timeStringToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number)
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
}

function minutesToTimeString(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  const period = h >= 12 ? "PM" : "AM"
  const displayH = h % 12 === 0 ? 12 : h % 12
  return `${String(displayH).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`
}

export function DashboardRules({
  rules,
  campuses,
}: {
  rules: ToleranceRuleItem[]
  campuses: { id: string; name: string }[]
}) {
  const [isPending, startTransition] = useTransition()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<ToleranceRuleItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState<ToleranceRuleInput>({
    campusId: "",
    role: null,
    expectedEntryTime: "08:00",
    gracePeriodMinutes: 10,
    lateToleranceMinutes: 30,
  })

  // Quick Simulator state
  const [testTime, setTestTime] = useState("08:12")
  const [testCampusId, setTestCampusId] = useState("")
  const [testRole, setTestRole] = useState<Role | "">("")

  const openCreateModal = () => {
    setEditingRule(null)
    setFormData({
      campusId: "",
      role: null,
      expectedEntryTime: "08:00",
      gracePeriodMinutes: 10,
      lateToleranceMinutes: 30,
    })
    setIsModalOpen(true)
  }

  const openEditModal = (rule: ToleranceRuleItem) => {
    setEditingRule(rule)
    setFormData({
      id: rule.id,
      campusId: rule.campusId ?? "",
      role: rule.role,
      expectedEntryTime: rule.expectedEntryTime,
      gracePeriodMinutes: rule.gracePeriodMinutes,
      lateToleranceMinutes: rule.lateToleranceMinutes,
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

  // Live simulation calculation for the test widget
  const evaluateTest = () => {
    if (rules.length === 0) return { status: "A_TIEMPO", diff: 0, ruleUsed: null }

    const matchedRule =
      (testCampusId && testRole ? rules.find(r => r.campusId === testCampusId && r.role === testRole) : null) ||
      (testCampusId ? rules.find(r => r.campusId === testCampusId && !r.role) : null) ||
      (testRole ? rules.find(r => !r.campusId && r.role === testRole) : null) ||
      rules.find(r => !r.campusId && !r.role)

    if (!matchedRule) return { status: "A_TIEMPO", diff: 0, ruleUsed: null }

    const testMinutes = timeStringToMinutes(testTime)
    const expectedMinutes = timeStringToMinutes(matchedRule.expectedEntryTime)
    const diff = testMinutes - expectedMinutes

    let status = "A_TIEMPO"
    if (diff <= matchedRule.gracePeriodMinutes) status = "A_TIEMPO"
    else if (diff <= matchedRule.lateToleranceMinutes) status = "TARDANZA"
    else status = "FALTA"

    return { status, diff, ruleUsed: matchedRule }
  }

  const testResult = evaluateTest()

  // Preview numbers for the modal live bar
  const formExpectedMins = timeStringToMinutes(formData.expectedEntryTime)
  const formGraceLimitMins = formExpectedMins + (Number(formData.gracePeriodMinutes) || 0)
  const formLateLimitMins = formExpectedMins + (Number(formData.lateToleranceMinutes) || 0)

  return (
    <div className="space-y-8 animate-fade-in-up pb-12">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B1B3D] via-[#12306b] to-[#1967D2] p-8 text-white shadow-xl shadow-blue-900/20">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.25em] text-blue-200">
              <Clock size={16} /> Motor de Horarios y Tolerancias
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight">Reglas de Tolerancia de Asistencia</h2>
            <p className="mt-2 text-sm text-blue-100/80 max-w-2xl font-medium">
              Define los horarios oficiales de entrada, minutos de cortesía y límites de tardanza por Sede y Rol operativo. El sistema evalúa automáticamente cada marcación según estas reglas.
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
              onClick={openCreateModal}
              disabled={isPending}
              className="bg-white hover:bg-blue-50 text-[#0B1B3D] font-extrabold h-12 px-6 rounded-2xl shadow-lg shadow-black/10 transition-transform hover:scale-105"
            >
              <Plus className="mr-2" size={20} /> Nueva Regla
            </Button>
          </div>
        </div>
      </div>

      {/* Grid: Reglas Activas + Simulador en Tiempo Real */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* LISTADO DE REGLAS */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <Settings2 size={20} className="text-[#1967D2]" /> Reglas Configuradas en el Sistema
            </h3>
            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
              {rules.length} {rules.length === 1 ? "regla activa" : "reglas activas"}
            </span>
          </div>

          {rules.length === 0 ? (
            <Card className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-[#1967D2] mb-4">
                <Clock size={32} />
              </div>
              <h4 className="text-xl font-black text-slate-800">No hay reglas de tolerancia configuradas</h4>
              <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
                Todas las entradas se están marcando actualmente como &quot;A tiempo&quot;. Crea una regla predeterminada para que el sistema empiece a detectar tardanzas y faltas automáticamente.
              </p>
              <Button
                onClick={handleSeedDefault}
                disabled={isPending}
                className="mt-6 bg-[#1967D2] hover:bg-blue-700 text-white font-bold px-8 h-12 rounded-xl"
              >
                <Sparkles className="mr-2" size={18} /> Crear Regla Global 08:00 AM
              </Button>
            </Card>
          ) : (
            <div className="space-y-4">
              {rules.map((rule) => {
                const expMins = timeStringToMinutes(rule.expectedEntryTime)
                const graceMins = expMins + rule.gracePeriodMinutes
                const lateMins = expMins + rule.lateToleranceMinutes
                const isGlobal = !rule.campusId && !rule.role

                return (
                  <Card
                    key={rule.id}
                    className="group rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-200/40 transition-all duration-300 hover:shadow-xl hover:border-blue-200"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isGlobal ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700 border border-indigo-100">
                              <Sparkles size={13} /> Regla Global (Todas las sedes y roles)
                            </span>
                          ) : (
                            <>
                              {rule.campus ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700 border border-blue-100">
                                  <Building2 size={13} /> {rule.campus.name}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                                  Todas las sedes
                                </span>
                              )}

                              {rule.role ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-1 text-xs font-black text-purple-700 border border-purple-100">
                                  <UserCircle2 size={13} /> {ROLE_LABELS[rule.role] || rule.role}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                                  Todos los roles
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 font-medium pt-0.5">
                          Prioridad: {rule.campusId && rule.role ? "Alta (Sede + Rol)" : rule.campusId ? "Media (Sede específica)" : rule.role ? "Media (Rol específico)" : "Base (Global)"}
                        </p>
                      </div>

                      {/* Botones de acción */}
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditModal(rule)}
                          className="h-10 px-4 rounded-xl font-bold text-slate-700 hover:text-[#1967D2] hover:bg-blue-50 border-slate-200"
                        >
                          <Edit3 size={15} className="mr-1.5" /> Editar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(rule.id)}
                          disabled={isPending}
                          className="h-10 px-4 rounded-xl font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-100"
                        >
                          <Trash2 size={15} className="mr-1.5" /> Eliminar
                        </Button>
                      </div>
                    </div>

                    {/* Resumen numérico */}
                    <div className="grid grid-cols-3 gap-3 pt-4">
                      <div className="rounded-2xl bg-slate-50 p-3.5 border border-slate-100">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Hora Oficial</p>
                        <p className="text-xl font-black text-slate-800 mt-0.5">{rule.expectedEntryTime}</p>
                        <p className="text-[11px] font-medium text-slate-500 mt-0.5">{minutesToTimeString(expMins)}</p>
                      </div>

                      <div className="rounded-2xl bg-emerald-50/60 p-3.5 border border-emerald-100">
                        <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Cortesía / Gracia</p>
                        <p className="text-xl font-black text-emerald-800 mt-0.5">+{rule.gracePeriodMinutes} min</p>
                        <p className="text-[11px] font-medium text-emerald-700 mt-0.5">A tiempo hasta {minutesToTimeString(graceMins)}</p>
                      </div>

                      <div className="rounded-2xl bg-amber-50/60 p-3.5 border border-amber-100">
                        <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Límite Tardanza</p>
                        <p className="text-xl font-black text-amber-800 mt-0.5">+{rule.lateToleranceMinutes} min</p>
                        <p className="text-[11px] font-medium text-amber-700 mt-0.5">Falta desde {minutesToTimeString(lateMins + 1)}</p>
                      </div>
                    </div>

                    {/* Timeline visual */}
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 mb-1.5">
                        <span>Llegada</span>
                        <span>08:00 oficial</span>
                        <span>Límite falta</span>
                      </div>
                      <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden flex">
                        <div
                          className="bg-emerald-500 h-full transition-all"
                          style={{ width: `${Math.min(60, Math.max(20, (rule.gracePeriodMinutes / (rule.lateToleranceMinutes || 1)) * 60))}%` }}
                          title={`A Tiempo: hasta ${minutesToTimeString(graceMins)}`}
                        />
                        <div
                          className="bg-amber-400 h-full flex-1 transition-all"
                          title={`Tardanza: hasta ${minutesToTimeString(lateMins)}`}
                        />
                        <div
                          className="bg-rose-500 h-full w-16 transition-all"
                          title={`Falta: a partir de ${minutesToTimeString(lateMins + 1)}`}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-black mt-2">
                        <span className="text-emerald-600">● A Tiempo (&lt;= {rule.gracePeriodMinutes}m)</span>
                        <span className="text-amber-600">● Tardanza (&lt;= {rule.lateToleranceMinutes}m)</span>
                        <span className="text-rose-600">● Falta (&gt; {rule.lateToleranceMinutes}m)</span>
                      </div>
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
                {testResult.ruleUsed ? (
                  <>
                    <p className="font-bold">
                      Diferencia: {testResult.diff > 0 ? `+${testResult.diff} min tarde` : `${Math.abs(testResult.diff)} min antes de hora`}
                    </p>
                    <p className="text-slate-400">
                      Regla aplicada: {testResult.ruleUsed.campus?.name || "Global"} ({testResult.ruleUsed.expectedEntryTime} oficial)
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

      {/* MODAL CREAR / EDITAR REGLA */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in-up">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-6 md:p-8 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-9 h-9 flex items-center justify-center transition-colors"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-blue-50 text-[#1967D2] rounded-2xl">
                <Settings2 size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-black text-[#0B1B3D]">
                  {editingRule ? "Editar Regla de Horario" : "Nueva Regla de Horario"}
                </h3>
                <p className="text-xs text-slate-400 font-medium">Configura los parámetros para este alcance</p>
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-5 mt-6">
              {/* Sede */}
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-700">Sede Universitaria</label>
                <select
                  value={formData.campusId ?? ""}
                  onChange={(e) => setFormData({ ...formData, campusId: e.target.value })}
                  className="w-full h-12 mt-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#1967D2]"
                >
                  <option value="">Todas las sedes (Alcance Global)</option>
                  {campuses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">Déjalo en blanco para que aplique como regla general.</p>
              </div>

              {/* Rol */}
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-700">Rol Operativo</label>
                <select
                  value={formData.role ?? ""}
                  onChange={(e) => setFormData({ ...formData, role: (e.target.value as Role) || null })}
                  className="w-full h-12 mt-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#1967D2]"
                >
                  <option value="">Todos los roles (Docentes, Técnicos y Pacientes)</option>
                  <option value="DOCENTE">Solo Docentes</option>
                  <option value="TECNICO">Solo Técnicos</option>
                  <option value="PACIENTE_SIMULADO">Solo Pacientes Simulados</option>
                </select>
              </div>

              {/* Hora Esperada */}
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-700">Hora Oficial de Entrada</label>
                <Input
                  type="time"
                  required
                  value={formData.expectedEntryTime}
                  onChange={(e) => setFormData({ ...formData, expectedEntryTime: e.target.value })}
                  className="h-12 mt-1.5 rounded-xl text-lg font-black bg-slate-50"
                />
                <p className="text-[11px] text-slate-400 mt-1">Ejemplo: 08:00 AM para turno mañana.</p>
              </div>

              {/* Gracia y Tolerancia */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-black uppercase tracking-wider text-emerald-700">Minutos de Gracia</label>
                  <div className="relative mt-1.5">
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      required
                      value={formData.gracePeriodMinutes}
                      onChange={(e) => setFormData({ ...formData, gracePeriodMinutes: Number(e.target.value) })}
                      className="h-12 rounded-xl text-base font-bold bg-slate-50 pr-12"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">min</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Llega a tiempo hasta +{formData.gracePeriodMinutes}m</p>
                </div>

                <div>
                  <label className="text-xs font-black uppercase tracking-wider text-amber-700">Límite Tardanza</label>
                  <div className="relative mt-1.5">
                    <Input
                      type="number"
                      min={formData.gracePeriodMinutes}
                      max={240}
                      required
                      value={formData.lateToleranceMinutes}
                      onChange={(e) => setFormData({ ...formData, lateToleranceMinutes: Number(e.target.value) })}
                      className="h-12 rounded-xl text-base font-bold bg-slate-50 pr-12"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">min</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Falta a partir de +{formData.lateToleranceMinutes}m</p>
                </div>
              </div>

              {/* Vista Previa Dinámica de la Regla */}
              <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200/80 space-y-2">
                <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Comportamiento con estos valores:</p>
                <div className="text-xs space-y-1 font-semibold text-slate-700">
                  <div className="flex items-center gap-2 text-emerald-700">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <strong>A Tiempo:</strong> Hasta las {minutesToTimeString(formGraceLimitMins)}
                  </div>
                  <div className="flex items-center gap-2 text-amber-700">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    <strong>Tardanza:</strong> De {minutesToTimeString(formGraceLimitMins + 1)} hasta las {minutesToTimeString(formLateLimitMins)}
                  </div>
                  <div className="flex items-center gap-2 text-rose-700">
                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                    <strong>Falta:</strong> A partir de las {minutesToTimeString(formLateLimitMins + 1)}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 h-12 rounded-xl font-bold"
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
      )}
    </div>
  )
}
