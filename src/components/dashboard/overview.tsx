"use client"

import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Users, LogIn, LogOut, Stethoscope, Briefcase, UserSquare2, FileWarning, Loader2, X } from "lucide-react"
import { DashboardChart } from "@/components/dashboard-chart"
import { limaDayKey, formatLimaTime } from "@/lib/timezone"
import { regularizeMissingExitAction } from "@/actions/attendance"
import { toast } from "sonner"

export function DashboardOverview({
  records,
  weekly,
}: {
  records: any[]
  weekly: { label: string; total: number }[]
}) {
  const [localRecords, setLocalRecords] = useState<any[]>(records)

  useEffect(() => {
    setLocalRecords(records)
  }, [records])

  const todayKey = limaDayKey(new Date())
  const todayRecords = useMemo(
    () => localRecords.filter((r) => limaDayKey(new Date(r.timestamp)) === todayKey),
    [localRecords, todayKey]
  )

  // Identificar qué registros de ENTRADA de hoy siguen abiertos (sin SALIDA posterior del mismo usuario hoy)
  const openEntryIds = useMemo(() => {
    const asc = [...todayRecords].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    const openByUser = new Map<string, string>()
    for (const r of asc) {
      const uid = r.user?.id || r.userId
      if (!uid) continue
      if (r.type === "ENTRADA") {
        openByUser.set(uid, r.id)
      } else if (r.type === "SALIDA") {
        openByUser.delete(uid)
      }
    }
    return new Set<string>(openByUser.values())
  }, [todayRecords])

  const [regModalRecord, setRegModalRecord] = useState<any | null>(null)
  const [regExitTime, setRegExitTime] = useState<string>("")
  const [regReason, setRegReason] = useState<string>("Olvidó marcar salida")
  const [isSubmittingReg, setIsSubmittingReg] = useState<boolean>(false)

  const openRegularizeModal = (record: any) => {
    setRegModalRecord(record)
    const nowHHMM = new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date())
    setRegExitTime(nowHHMM)
    setRegReason("Olvidó marcar salida")
  }

  const handleConfirmRegularize = async () => {
    if (!regModalRecord) return
    const uid = regModalRecord.user?.id || regModalRecord.userId
    if (!uid) return

    setIsSubmittingReg(true)
    try {
      const res = await regularizeMissingExitAction({
        userId: uid,
        entryRecordId: regModalRecord.id,
        exitTimeHHMM: regExitTime,
        dateStr: todayKey,
        campusName: regModalRecord.campus?.name,
        courseName: regModalRecord.course?.name,
        reason: regReason,
      })

      if (res.success && res.createdRecord) {
        toast.success(res.message)
        const newRow = {
          id: res.createdRecord.id,
          type: res.createdRecord.type,
          status: res.createdRecord.status,
          timestamp: res.createdRecord.timestamp,
          userId: uid,
          user: regModalRecord.user,
          campus: regModalRecord.campus,
          course: regModalRecord.course,
        }
        setLocalRecords((prev) => [newRow, ...prev])
        setRegModalRecord(null)
      } else {
        toast.error(res.message)
      }
    } catch {
      toast.error("Error al regularizar la salida.")
    } finally {
      setIsSubmittingReg(false)
    }
  }

  const totalHoy = todayRecords.length
  const entradas = todayRecords.filter((r) => r.type === "ENTRADA").length
  const salidas = todayRecords.filter((r) => r.type === "SALIDA").length

  const docentes = todayRecords.filter((r) => r.user?.role === "DOCENTE").length
  const tecnicos = todayRecords.filter((r) => r.user?.role === "TECNICO").length
  const pacientes = todayRecords.filter((r) => r.user?.role === "PACIENTE_SIMULADO").length

  const chartData = weekly.map((d, i) => ({
    date: i === weekly.length - 1 ? "Hoy" : d.label,
    total: d.total,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 animate-fade-in-up">
        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">
              Flujo Total Hoy
            </CardTitle>
            <Users className="text-[#1967D2]" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-800">{totalHoy}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">
              Entradas
            </CardTitle>
            <LogIn className="text-emerald-500" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-800">{entradas}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">
              Salidas
            </CardTitle>
            <LogOut className="text-amber-500" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-800">{salidas}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-slate-50/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">
              Sin Salida Hoy
            </CardTitle>
            <FileWarning
              className={openEntryIds.size > 0 ? "text-amber-500" : "text-slate-400"}
              size={20}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-4xl font-black ${
                openEntryIds.size > 0 ? "text-amber-600" : "text-slate-300"
              }`}
            >
              {openEntryIds.size}
            </div>
          </CardContent>
        </Card>
      </div>

      <div
        className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in-up"
        style={{ animationDelay: "0.1s" }}
      >
        <Card className="lg:col-span-2 shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white flex flex-col">
          <CardHeader className="pb-0">
            <CardTitle className="text-lg font-extrabold text-slate-800">Flujo Semanal</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 pb-4 pt-2">
            <DashboardChart data={chartData} />
          </CardContent>
        </Card>

        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white flex flex-col">
          <CardHeader className="pb-4 border-b border-slate-100">
            <CardTitle className="text-lg font-extrabold text-slate-800">
              Asistencia por Rol (Hoy)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                  <Briefcase size={20} />
                </div>
                <span className="font-bold text-slate-600">Docentes</span>
              </div>
              <span className="text-2xl font-black text-slate-800">{docentes}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
                  <Stethoscope size={20} />
                </div>
                <span className="font-bold text-slate-600">Pacientes Sim.</span>
              </div>
              <span className="text-2xl font-black text-slate-800">{pacientes}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-purple-50 text-purple-600 rounded-xl">
                  <UserSquare2 size={20} />
                </div>
                <span className="font-bold text-slate-600">Técnicos</span>
              </div>
              <span className="text-2xl font-black text-slate-800">{tecnicos}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-white py-5 px-6">
            <CardTitle className="text-lg font-extrabold text-slate-800">
              Marcaciones del Día
            </CardTitle>
            <CardDescription className="text-sm font-medium">
              Registros de asistencia procesados hoy. Si un paciente o colaborador olvidó marcar su salida, puede regularizarla manualmente desde su fila de entrada.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow className="border-slate-100 hover:bg-transparent">
                  <TableHead className="px-6 font-bold text-slate-500">Nombre</TableHead>
                  <TableHead className="font-bold text-slate-500">Rol</TableHead>
                  <TableHead className="font-bold text-slate-500">Tipo / Acción</TableHead>
                  <TableHead className="px-6 text-right font-bold text-slate-500">
                    Hora de Registro
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {todayRecords.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-slate-500 font-medium">
                      Aún no se han registrado marcaciones el día de hoy.
                    </TableCell>
                  </TableRow>
                ) : (
                  todayRecords.map((record) => {
                    const isOpenEntry = openEntryIds.has(record.id)
                    return (
                      <TableRow
                        key={record.id}
                        className="border-slate-100 transition-colors hover:bg-slate-50/80"
                      >
                        <TableCell className="px-6 py-3">
                          <p className="font-bold text-slate-800">{record.user.name}</p>
                          <p className="text-xs text-slate-400 font-medium">
                            DNI: {record.user.dni}
                          </p>
                        </TableCell>
                        <TableCell className="text-slate-500 text-xs font-bold">
                          {record.user?.role}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`px-2 py-1 rounded-[5px] text-[10px] font-black tracking-widest ${
                                record.type === "ENTRADA"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-slate-200 text-slate-700"
                              }`}
                            >
                              {record.type}
                            </span>
                            {isOpenEntry && (
                              <button
                                type="button"
                                onClick={() => openRegularizeModal(record)}
                                className="px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-black flex items-center gap-1 transition-colors cursor-pointer"
                                title="Registrar manualmente la salida si olvidó marcarla"
                              >
                                <LogOut size={11} /> Regularizar Salida
                              </button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-6 text-right text-slate-600 text-sm font-bold">
                          {formatLimaTime(new Date(record.timestamp))}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Modal de Regularización Manual de Salida */}
      {regModalRecord && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in-up">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <LogOut size={18} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Regularizar Salida Manualmente
                  </h3>
                  <p className="text-xs font-medium text-slate-500">
                    {regModalRecord.user?.name} (DNI: {regModalRecord.user?.dni})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRegModalRecord(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="font-bold text-slate-500">Entrada registrada:</span>
                <span className="font-black text-slate-900">
                  {formatLimaTime(new Date(regModalRecord.timestamp))}
                </span>
              </div>
              {regModalRecord.campus?.name && (
                <div className="flex justify-between">
                  <span className="font-bold text-slate-500">Sede:</span>
                  <span className="font-bold text-slate-800">{regModalRecord.campus.name}</span>
                </div>
              )}
              {regModalRecord.course?.name && (
                <div className="flex justify-between">
                  <span className="font-bold text-slate-500">Curso:</span>
                  <span className="font-bold text-slate-800 truncate max-w-[220px]">
                    {regModalRecord.course.name}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-1">
                  Hora de Salida a Registrar
                </label>
                <Input
                  type="time"
                  value={regExitTime}
                  onChange={(e) => setRegExitTime(e.target.value)}
                  className="h-11 rounded-xl bg-slate-50 border-slate-200 font-black text-slate-900 text-base"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-1">
                  Observación / Motivo
                </label>
                <Input
                  value={regReason}
                  onChange={(e) => setRegReason(e.target.value)}
                  placeholder="Ej. Olvidó marcar salida"
                  className="h-10 rounded-xl bg-slate-50 border-slate-200 text-xs font-semibold"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmittingReg}
                onClick={() => setRegModalRecord(null)}
                className="h-10 px-4 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={isSubmittingReg || !regExitTime}
                onClick={handleConfirmRegularize}
                className="h-10 px-5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs cursor-pointer flex items-center gap-1.5"
              >
                {isSubmittingReg ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <LogOut size={14} />
                )}
                Guardar Salida ({regExitTime})
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
