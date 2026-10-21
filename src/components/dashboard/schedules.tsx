"use client"

import { useState, useTransition, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Calendar as CalendarIcon, 
  UploadCloud, 
  Plus, 
  Trash2, 
  Edit, 
  FileSpreadsheet, 
  Image as ImageIcon, 
  Loader2, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  Sparkles, 
  AlertCircle,
  Filter,
  Users
} from "lucide-react"
import { toast } from "sonner"
import * as XLSX from "xlsx"
import { 
  upsertTechnicianScheduleAction, 
  deleteTechnicianScheduleAction, 
  bulkUpsertTechnicianSchedulesAction,
} from "@/actions/schedules"
import { DEFAULT_SHIFT_TIMES, type ScheduleItemInput } from "@/lib/schedule-constants"
import { Shift } from "@prisma/client"

type Technician = {
  id: string
  name: string
  dni: string
  defaultShift?: string | null
  campus?: { id: string; name: string } | null
}

type Campus = {
  id: string
  name: string
}

type ScheduleRecord = {
  id: string
  userId: string
  date: string
  campusId: string
  shift: Shift
  expectedEntryTime: string
  earlyEntryToleranceMinutes: number
  gracePeriodMinutes: number
  lateToleranceMinutes: number
  notes?: string | null
  user: { id: string; name: string; dni: string }
  campus: { id: string; name: string }
}

interface SchedulesProps {
  initialSchedules: ScheduleRecord[]
  technicians: Technician[]
  campuses: Campus[]
}

// Modal básico estilizado
function ScheduleModal({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in-up p-4">
      <div className="bg-white w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-[2rem] shadow-2xl p-6 md:p-8 relative">
        <button 
          onClick={onClose} 
          className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition-colors font-bold"
        >
          ✕
        </button>
        <h3 className="text-2xl font-black text-[#0B1B3D] mb-6">{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function DashboardSchedules({ initialSchedules = [], technicians = [], campuses = [] }: SchedulesProps) {
  const [schedules, setSchedules] = useState<ScheduleRecord[]>(initialSchedules || [])
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  })
  const [filterCampus, setFilterCampus] = useState<string>("ALL")
  const [searchTerm, setSearchTerm] = useState("")

  // Modales
  const [isIndividualOpen, setIsIndividualOpen] = useState(false)
  const [isBulkOpen, setIsBulkOpen] = useState(false)
  const [isOcrOpen, setIsOcrOpen] = useState(false)

  // Estado formulario individual
  const [formSchedule, setFormSchedule] = useState<{
    id?: string
    userId: string
    date: string
    campusId: string
    shift: Shift
    expectedEntryTime: string
    earlyEntryToleranceMinutes: number
    gracePeriodMinutes: number
    lateToleranceMinutes: number
    notes: string
  }>({
    userId: technicians[0]?.id || "",
    date: new Date().toISOString().slice(0, 10),
    campusId: campuses[0]?.id || "",
    shift: Shift.MANANA,
    expectedEntryTime: DEFAULT_SHIFT_TIMES.MANANA.entry,
    earlyEntryToleranceMinutes: DEFAULT_SHIFT_TIMES.MANANA.early,
    gracePeriodMinutes: DEFAULT_SHIFT_TIMES.MANANA.grace,
    lateToleranceMinutes: DEFAULT_SHIFT_TIMES.MANANA.late,
    notes: "",
  })

  // Carga masiva Excel
  const [excelPreview, setExcelPreview] = useState<ScheduleItemInput[]>([])

  // OCR Imagen
  const [ocrImage, setOcrImage] = useState<File | null>(null)
  const [ocrImagePreview, setOcrImagePreview] = useState<string | null>(null)
  const [ocrStatus, setOcrStatus] = useState<string>("")
  const [ocrProgress, setOcrProgress] = useState<number>(0)
  const [ocrRawText, setOcrRawText] = useState<string>("")
  const [ocrParsedRows, setOcrParsedRows] = useState<Array<{
    name: string
    dni?: string
    date: string
    campusName: string
    shift: Shift
    entryTime: string
  }>>([])

  const [isPending, startTransition] = useTransition()

  // Filtrado de cronograma en pantalla
  const filteredSchedules = useMemo(() => {
    if (!Array.isArray(schedules)) return []
    const term = searchTerm.toLowerCase().trim()
    return schedules.filter((s) => {
      if (!s) return false
      const matchMonth = (s.date || "").startsWith(selectedMonth)
      const matchCampus = filterCampus === "ALL" || s.campusId === filterCampus
      const userName = s.user?.name?.toLowerCase() || ""
      const userDni = s.user?.dni || ""
      const campusName = s.campus?.name?.toLowerCase() || ""
      const matchSearch = !term || userName.includes(term) || userDni.includes(term) || campusName.includes(term)
      return matchMonth && matchCampus && matchSearch
    })
  }, [schedules, selectedMonth, filterCampus, searchTerm])

  // Cambio de turno en formulario individual
  const handleShiftChange = (shift: Shift) => {
    const def = DEFAULT_SHIFT_TIMES[shift]
    setFormSchedule((prev) => ({
      ...prev,
      shift,
      expectedEntryTime: def.entry,
      earlyEntryToleranceMinutes: def.early,
      gracePeriodMinutes: def.grace,
      lateToleranceMinutes: def.late,
    }))
  }

  // Guardar turno individual
  const handleSaveIndividual = async (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const res = await upsertTechnicianScheduleAction(formSchedule)
      if (res.success && res.schedule) {
        toast.success(res.message)
        // Actualizar lista local
        setSchedules((prev) => {
          const index = prev.findIndex((s) => s.id === res.schedule!.id || (s.userId === res.schedule!.userId && s.date === res.schedule!.date))
          if (index >= 0) {
            const next = [...prev]
            next[index] = res.schedule as any
            return next
          }
          return [res.schedule as any, ...prev]
        })
        setIsIndividualOpen(false)
      } else {
        toast.error(res.message || "Error al guardar turno.")
      }
    })
  }

  // Eliminar turno
  const handleDelete = async (id: string) => {
    if (!confirm("¿Deseas eliminar este turno del cronograma?")) return
    startTransition(async () => {
      const res = await deleteTechnicianScheduleAction(id)
      if (res.success) {
        toast.success(res.message)
        setSchedules((prev) => prev.filter((s) => s.id !== id))
      } else {
        toast.error(res.message)
      }
    })
  }

  // Leer Excel
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: "binary" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" })

        const mapped: ScheduleItemInput[] = rows.map((r) => {
          const keys = Object.keys(r)
          const getVal = (possibleKeys: string[]) => {
            const k = keys.find((key) => possibleKeys.includes(key.toLowerCase().trim()))
            return k ? String(r[k]).trim() : ""
          }

          // Normalizar fecha si viene como número Excel o string YYYY-MM-DD
          let rawDate = getVal(["fecha", "date", "dia"])
          if (/^\d{5}$/.test(rawDate)) {
            // Número serial de Excel
            const parsed = new Date((Number(rawDate) - (25567 + 1)) * 86400 * 1000)
            rawDate = parsed.toISOString().slice(0, 10)
          }

          let shiftVal: Shift = Shift.MANANA
          const sText = getVal(["turno", "shift", "horario"]).toUpperCase()
          if (sText.includes("TARDE") || sText === "T") shiftVal = Shift.TARDE
          else if (sText.includes("INTER") || sText.includes("MED") || sText === "I") shiftVal = Shift.INTERMEDIO

          return {
            dni: getVal(["dni", "documento", "id"]),
            name: getVal(["nombre", "tecnico", "técnico", "nombres", "name"]),
            date: rawDate,
            campusName: getVal(["sede", "campus", "local"]),
            shift: shiftVal,
            expectedEntryTime: getVal(["entrada", "hora", "ingreso", "hora_entrada"]),
            notes: getVal(["notas", "observacion", "observaciones", "notes"]),
          } as any
        }).filter((x) => x.date && (x.dni || (x as any).name))

        setExcelPreview(mapped)
        toast.success(`Se leyeron ${mapped.length} filas del archivo Excel.`)
      } catch (err) {
        toast.error("Error al procesar el archivo Excel.")
      }
    }
    reader.readAsBinaryString(file)
  }

  // Guardar Lote Excel
  const handleSaveBulkExcel = async () => {
    if (excelPreview.length === 0) return
    startTransition(async () => {
      const res = await bulkUpsertTechnicianSchedulesAction(excelPreview)
      if (res.success) {
        toast.success(res.message)
        setIsBulkOpen(false)
        setExcelPreview([])
        window.location.reload()
      } else {
        toast.error(res.message)
      }
    })
  }

  // Procesar imagen con OCR (Tesseract.js)
  const handleOcrImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setOcrImage(file)
    setOcrImagePreview(URL.createObjectURL(file))
    setOcrStatus("Iniciando motor de reconocimiento óptico (OCR)...")
    setOcrProgress(5)

    try {
      const { createWorker } = await import("tesseract.js")
      const worker = await createWorker("spa+eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setOcrStatus(`Analizando texto de la imagen: ${Math.round((m.progress || 0) * 100)}%`)
            setOcrProgress(Math.round((m.progress || 0) * 100))
          } else {
            setOcrStatus(m.status)
          }
        },
      })

      const ret = await worker.recognize(file)
      await worker.terminate()

      const text = ret.data.text
      setOcrRawText(text)
      setOcrStatus("Texto extraído con éxito. Parseando filas del cronograma...")
      setOcrProgress(100)

      // Parser inteligente del texto extraído
      parseOcrTextToRows(text)
    } catch (err: any) {
      console.error("Error en OCR:", err)
      setOcrStatus("Error al procesar la imagen.")
      toast.error(err?.message || "No se pudo leer la imagen. Intenta con un archivo más nítido o sube un Excel.")
    }
  }

  // Parsear texto libre de la imagen hacia asignaciones estructuradas
  const parseOcrTextToRows = (text: string) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 3)
    const detectedRows: any[] = []

    // Detectar mes/año de referencia en el texto (ej: "OCTUBRE 2026")
    const today = new Date()
    let refYear = today.getFullYear()
    let refMonth = today.getMonth() + 1

    const monthMap: Record<string, number> = {
      enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
      julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
    }
    for (const [mName, mNum] of Object.entries(monthMap)) {
      if (text.toLowerCase().includes(mName)) {
        refMonth = mNum
        break
      }
    }
    const yearMatch = text.match(/202\d/)
    if (yearMatch) refYear = Number(yearMatch[0])

    for (const line of lines) {
      // Coincidencia con técnico conocido
      const matchedTech = technicians.find((t) => {
        const parts = t.name.toLowerCase().split(" ")
        return parts.some((p) => p.length > 3 && line.toLowerCase().includes(p)) || line.includes(t.dni)
      })

      // Coincidencia con sede conocida
      const matchedCampus = campuses.find((c) => {
        const cLower = c.name.toLowerCase().replace("campus", "").trim()
        return line.toLowerCase().includes(cLower)
      })

      // Coincidencia de turno
      let detectedShift: Shift = Shift.MANANA
      const upperLine = line.toUpperCase()
      if (upperLine.includes("TARDE") || upperLine.includes("VESPERTINO")) detectedShift = Shift.TARDE
      else if (upperLine.includes("INTERMEDIO") || upperLine.includes("MEDIO")) detectedShift = Shift.INTERMEDIO

      // Coincidencia de día (ej: "Día 15", "15/10", "15-10" o número 1-31 aislado)
      const dayMatch = line.match(/\b([0-2]?\d|3[01])\b/)
      let day = dayMatch ? Number(dayMatch[1]) : today.getDate()
      if (day === 0) day = 1
      const dateStr = `${refYear}-${String(refMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`

      if (matchedTech || matchedCampus) {
        detectedRows.push({
          name: matchedTech ? matchedTech.name : line.slice(0, 25),
          dni: matchedTech?.dni || "",
          date: dateStr,
          campusName: matchedCampus ? matchedCampus.name : (campuses[0]?.name || "Campus Villa"),
          shift: detectedShift,
          entryTime: DEFAULT_SHIFT_TIMES[detectedShift].entry,
        })
      }
    }

    setOcrParsedRows(detectedRows)
    if (detectedRows.length > 0) {
      toast.success(`Se identificaron automáticamente ${detectedRows.length} posibles asignaciones en la imagen.`)
    } else {
      toast.warning("El texto extraído no coincidió automáticamente con nombres o sedes conocidos. Puedes revisar el texto extraído o usar la carga Excel.")
    }
  }

  // Guardar filas reconocidas de OCR
  const handleSaveOcrRows = async () => {
    if (ocrParsedRows.length === 0) return
    startTransition(async () => {
      const items: ScheduleItemInput[] = ocrParsedRows.map((r) => ({
        dni: r.dni,
        name: r.name,
        date: r.date,
        campusName: r.campusName,
        shift: r.shift,
        expectedEntryTime: r.entryTime,
        notes: "Importado vía OCR Imagen",
      })) as any

      const res = await bulkUpsertTechnicianSchedulesAction(items)
      if (res.success) {
        toast.success(res.message)
        setIsOcrOpen(false)
        setOcrParsedRows([])
        setOcrImage(null)
        window.location.reload()
      } else {
        toast.error(res.message)
      }
    })
  }

  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Header y Acciones */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
            <CalendarIcon className="text-[#1967D2]" size={32} />
            Cronograma y Turnos de Técnicos
          </h2>
          <p className="text-slate-500 font-medium text-sm mt-1">
            Programación mensual de sedes (rotaciones) y horarios de entrada (Mañana, Intermedio, Tarde).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => setIsOcrOpen(true)}
            className="h-12 px-5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-md shadow-purple-600/20 flex items-center gap-2"
          >
            <ImageIcon size={18} />
            Cargar Foto / Rol
          </Button>

          <Button
            onClick={() => setIsBulkOpen(true)}
            variant="outline"
            className="h-12 px-5 border-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50 font-bold rounded-xl flex items-center gap-2"
          >
            <FileSpreadsheet size={18} />
            Importar Excel
          </Button>

          <Button
            onClick={() => {
              setFormSchedule({
                userId: technicians[0]?.id || "",
                date: new Date().toISOString().slice(0, 10),
                campusId: campuses[0]?.id || "",
                shift: Shift.MANANA,
                expectedEntryTime: DEFAULT_SHIFT_TIMES.MANANA.entry,
                earlyEntryToleranceMinutes: DEFAULT_SHIFT_TIMES.MANANA.early,
                gracePeriodMinutes: DEFAULT_SHIFT_TIMES.MANANA.grace,
                lateToleranceMinutes: DEFAULT_SHIFT_TIMES.MANANA.late,
                notes: "",
              })
              setIsIndividualOpen(true)
            }}
            className="h-12 px-5 bg-[#1967D2] hover:bg-blue-800 text-white font-bold rounded-xl shadow-md shadow-blue-500/20 flex items-center gap-2"
          >
            <Plus size={18} />
            Asignar Turno
          </Button>
        </div>
      </div>

      {/* Barra de Filtros */}
      <Card className="rounded-[1.5rem] border-slate-200 shadow-sm bg-white p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              Mes a consultar
            </label>
            <Input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-12 bg-slate-50 border-slate-200 font-bold text-slate-800 rounded-xl"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              Filtrar por Sede
            </label>
            <select
              value={filterCampus}
              onChange={(e) => setFilterCampus(e.target.value)}
              className="w-full h-12 bg-slate-50 border border-slate-200 font-bold text-slate-800 rounded-xl px-3 outline-none focus:ring-2 focus:ring-[#1967D2]"
            >
              <option value="ALL">Todas las sedes</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              Buscar técnico o DNI
            </label>
            <Input
              placeholder="Ej: Juan Pérez, 72345678..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-12 bg-slate-50 border-slate-200 font-medium text-slate-800 rounded-xl"
            />
          </div>
        </div>
      </Card>

      {/* Tabla del Cronograma */}
      <Card className="rounded-[2rem] border-slate-200 shadow-sm overflow-hidden bg-white">
        <CardHeader className="p-6 md:p-8 border-b border-slate-100 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-xl font-black text-slate-800">
              Turnos Programados ({filteredSchedules.length})
            </CardTitle>
            <CardDescription className="text-slate-500 font-medium text-xs mt-1">
              Las marcaciones de técnicos en la entrada usarán la sede y tolerancia de este calendario.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader className="bg-slate-50/80 sticky top-0 z-10 backdrop-blur-sm">
                <TableRow className="border-slate-100">
                  <TableHead className="px-6 font-bold text-slate-500 py-4">Fecha</TableHead>
                  <TableHead className="font-bold text-slate-500">Técnico</TableHead>
                  <TableHead className="font-bold text-slate-500">DNI</TableHead>
                  <TableHead className="font-bold text-slate-500">Sede Asignada</TableHead>
                  <TableHead className="font-bold text-slate-500">Turno</TableHead>
                  <TableHead className="font-bold text-slate-500">Hora Entrada</TableHead>
                  <TableHead className="font-bold text-slate-500">Tolerancias</TableHead>
                  <TableHead className="text-right px-6 font-bold text-slate-500">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSchedules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-16 text-slate-400 font-medium">
                      No hay turnos programados para este mes y filtros. Usa los botones superiores para cargar o asignar.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSchedules.map((s) => (
                    <TableRow key={s.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                      <TableCell className="px-6 font-black text-slate-800 text-sm">
                        📅 {s.date}
                      </TableCell>
                      <TableCell className="font-bold text-slate-800">{s.user?.name || "Técnico sin nombre"}</TableCell>
                      <TableCell className="font-semibold text-slate-500 font-mono text-xs">{s.user?.dni || "—"}</TableCell>
                      <TableCell>
                        <span className="px-3 py-1 rounded-lg bg-blue-50 text-[#1967D2] border border-blue-100 font-black text-xs inline-flex items-center gap-1">
                          <MapPin size={12} /> {s.campus?.name || "Sin sede"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`px-2.5 py-1 rounded-md text-[11px] font-black uppercase tracking-wider ${
                          s.shift === Shift.MANANA 
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : s.shift === Shift.INTERMEDIO
                            ? "bg-cyan-50 text-cyan-700 border border-cyan-200"
                            : "bg-purple-50 text-purple-700 border border-purple-200"
                        }`}>
                          {s.shift}
                        </span>
                      </TableCell>
                      <TableCell className="font-black text-slate-800 text-sm">
                        ⏰ {s.expectedEntryTime}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 font-medium">
                        Anticipo: {s.earlyEntryToleranceMinutes}m | Gracia: {s.gracePeriodMinutes}m | Tard: {s.lateToleranceMinutes}m
                      </TableCell>
                      <TableCell className="px-6 text-right space-x-2">
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            setFormSchedule({
                              id: s.id,
                              userId: s.userId,
                              date: s.date,
                              campusId: s.campusId,
                              shift: s.shift,
                              expectedEntryTime: s.expectedEntryTime,
                              earlyEntryToleranceMinutes: s.earlyEntryToleranceMinutes,
                              gracePeriodMinutes: s.gracePeriodMinutes,
                              lateToleranceMinutes: s.lateToleranceMinutes,
                              notes: s.notes || "",
                            })
                            setIsIndividualOpen(true)
                          }}
                          className="h-8 w-8 text-blue-600 border-blue-200 hover:bg-blue-50 rounded-lg"
                        >
                          <Edit size={14} />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleDelete(s.id)}
                          className="h-8 w-8 text-rose-600 border-rose-200 hover:bg-rose-50 rounded-lg"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* MODAL: ASIGNACIÓN INDIVIDUAL */}
      <ScheduleModal
        isOpen={isIndividualOpen}
        onClose={() => setIsIndividualOpen(false)}
        title={formSchedule.id ? "Editar Turno Programado" : "Asignar Turno a Técnico"}
      >
        <form onSubmit={handleSaveIndividual} className="space-y-5">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              Técnico
            </label>
            <select
              value={formSchedule.userId}
              onChange={(e) => setFormSchedule({ ...formSchedule, userId: e.target.value })}
              className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#1967D2]"
              required
            >
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (DNI: {t.dni})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                Fecha
              </label>
              <Input
                type="date"
                value={formSchedule.date}
                onChange={(e) => setFormSchedule({ ...formSchedule, date: e.target.value })}
                className="h-12 bg-slate-50 border-slate-200 font-bold rounded-xl"
                required
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                Sede Asignada
              </label>
              <select
                value={formSchedule.campusId}
                onChange={(e) => setFormSchedule({ ...formSchedule, campusId: e.target.value })}
                className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#1967D2]"
                required
              >
                {campuses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              Turno
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: Shift.MANANA, label: "Mañana (07:00)", color: "border-amber-400 bg-amber-50" },
                { key: Shift.INTERMEDIO, label: "Intermedio (11:00)", color: "border-cyan-400 bg-cyan-50" },
                { key: Shift.TARDE, label: "Tarde (14:00)", color: "border-purple-400 bg-purple-50" },
              ].map((s) => (
                <button
                  type="button"
                  key={s.key}
                  onClick={() => handleShiftChange(s.key)}
                  className={`p-3 rounded-xl border-2 font-black text-xs transition-all ${
                    formSchedule.shift === s.key ? s.color + " shadow-sm text-slate-900" : "border-slate-200 bg-white text-slate-500"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                Hora Oficial Entrada (HH:mm)
              </label>
              <Input
                type="time"
                value={formSchedule.expectedEntryTime}
                onChange={(e) => setFormSchedule({ ...formSchedule, expectedEntryTime: e.target.value })}
                className="h-12 bg-slate-50 border-slate-200 font-bold rounded-xl"
                required
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                Anticipación Permitida (min)
              </label>
              <Input
                type="number"
                min="0"
                max="60"
                value={formSchedule.earlyEntryToleranceMinutes}
                onChange={(e) => setFormSchedule({ ...formSchedule, earlyEntryToleranceMinutes: Number(e.target.value) })}
                className="h-12 bg-slate-50 border-slate-200 font-bold rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                Minutos Gracia
              </label>
              <Input
                type="number"
                min="0"
                max="60"
                value={formSchedule.gracePeriodMinutes}
                onChange={(e) => setFormSchedule({ ...formSchedule, gracePeriodMinutes: Number(e.target.value) })}
                className="h-12 bg-slate-50 border-slate-200 font-bold rounded-xl"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                Tolerancia Tardanza (min)
              </label>
              <Input
                type="number"
                min="0"
                max="120"
                value={formSchedule.lateToleranceMinutes}
                onChange={(e) => setFormSchedule({ ...formSchedule, lateToleranceMinutes: Number(e.target.value) })}
                className="h-12 bg-slate-50 border-slate-200 font-bold rounded-xl"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
              Notas / Observaciones (opcional)
            </label>
            <Input
              placeholder="Ej: Rotación mensual, cubriendo guardia..."
              value={formSchedule.notes}
              onChange={(e) => setFormSchedule({ ...formSchedule, notes: e.target.value })}
              className="h-12 bg-slate-50 border-slate-200 rounded-xl text-sm"
            />
          </div>

          <div className="flex gap-4 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsIndividualOpen(false)}
              className="flex-1 h-12 rounded-xl font-bold"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="flex-1 h-12 bg-[#1967D2] hover:bg-blue-800 text-white font-bold rounded-xl shadow-md"
            >
              {isPending ? <Loader2 className="animate-spin" /> : "Guardar Asignación"}
            </Button>
          </div>
        </form>
      </ScheduleModal>

      {/* MODAL: IMPORTACIÓN EXCEL */}
      <ScheduleModal
        isOpen={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        title="Importar Cronograma desde Excel"
      >
        <div className="space-y-5">
          <p className="text-xs text-slate-500 font-medium">
            Sube un archivo Excel (.xlsx / .csv) con columnas: <strong>DNI</strong> o <strong>Nombre</strong>, <strong>Fecha</strong> (YYYY-MM-DD), <strong>Sede</strong> (ej: Campus Villa), y <strong>Turno</strong> (Mañana, Intermedio, Tarde).
          </p>

          <div className="border-2 border-dashed border-slate-200 hover:border-emerald-500 p-8 rounded-2xl text-center bg-slate-50 hover:bg-emerald-50/50 transition-all cursor-pointer relative">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelUpload}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <FileSpreadsheet className="mx-auto text-emerald-600 mb-2" size={40} />
            <p className="font-bold text-slate-700 text-sm">Arrastra tu archivo Excel aquí o haz clic para seleccionarlo</p>
            <p className="text-xs text-slate-400 mt-1">Formatos soportados: .xlsx, .xls, .csv</p>
          </div>

          {excelPreview.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-500">
                  Vista Previa ({excelPreview.length} registros listos)
                </span>
              </div>
              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 font-bold text-slate-600 sticky top-0">
                    <tr>
                      <th className="p-2 text-left">DNI / Nombre</th>
                      <th className="p-2 text-left">Fecha</th>
                      <th className="p-2 text-left">Sede</th>
                      <th className="p-2 text-left">Turno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excelPreview.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-2 font-medium">{r.dni || (r as any).name}</td>
                        <td className="p-2">{r.date}</td>
                        <td className="p-2">{r.campusName}</td>
                        <td className="p-2 font-bold">{r.shift}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-4 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsBulkOpen(false)
                setExcelPreview([])
              }}
              className="flex-1 h-12 rounded-xl font-bold"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={excelPreview.length === 0 || isPending}
              onClick={handleSaveBulkExcel}
              className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md"
            >
              {isPending ? <Loader2 className="animate-spin" /> : `Guardar ${excelPreview.length} Asignaciones`}
            </Button>
          </div>
        </div>
      </ScheduleModal>

      {/* MODAL: CARGA DE FOTO / OCR */}
      <ScheduleModal
        isOpen={isOcrOpen}
        onClose={() => setIsOcrOpen(false)}
        title="Reconocimiento Óptico (OCR) de Imagen del Rol"
      >
        <div className="space-y-5">
          <p className="text-xs text-slate-500 font-medium">
            Sube una fotografía o captura del rol mensual de técnicos. El motor extraerá los nombres, sedes y turnos para que puedas revisarlos y confirmarlos antes de guardarlos.
          </p>

          <div className="border-2 border-dashed border-indigo-200 hover:border-indigo-500 p-6 rounded-2xl text-center bg-indigo-50/30 hover:bg-indigo-50 transition-all cursor-pointer relative">
            <input
              type="file"
              accept="image/*"
              onChange={handleOcrImageUpload}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <ImageIcon className="mx-auto text-indigo-600 mb-2" size={40} />
            <p className="font-bold text-slate-700 text-sm">Selecciona o toma una foto del rol de turnos</p>
            <p className="text-xs text-slate-400 mt-1">PNG, JPG, WEBP de alta resolución</p>
          </div>

          {ocrStatus && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
              <div className="flex items-center justify-between mb-1.5 font-bold text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Sparkles size={14} className="text-indigo-600 animate-pulse" /> {ocrStatus}
                </span>
                <span>{ocrProgress}%</span>
              </div>
              <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-600 h-full transition-all duration-300"
                  style={{ width: `${ocrProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          {ocrParsedRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-600">
                  Filas reconocidas ({ocrParsedRows.length}) — Puedes editarlas antes de guardar:
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 font-bold text-slate-600 sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Técnico</th>
                      <th className="p-2 text-left">Fecha</th>
                      <th className="p-2 text-left">Sede</th>
                      <th className="p-2 text-left">Turno</th>
                      <th className="p-2 text-center">✕</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ocrParsedRows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-2 font-medium">
                          <input
                            type="text"
                            value={r.name}
                            onChange={(e) => {
                              const next = [...ocrParsedRows]
                              next[i].name = e.target.value
                              setOcrParsedRows(next)
                            }}
                            className="w-full bg-transparent border-b border-dashed border-slate-300 focus:outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="date"
                            value={r.date}
                            onChange={(e) => {
                              const next = [...ocrParsedRows]
                              next[i].date = e.target.value
                              setOcrParsedRows(next)
                            }}
                            className="bg-transparent border-b border-dashed border-slate-300 focus:outline-none text-[11px]"
                          />
                        </td>
                        <td className="p-2">
                          <select
                            value={r.campusName}
                            onChange={(e) => {
                              const next = [...ocrParsedRows]
                              next[i].campusName = e.target.value
                              setOcrParsedRows(next)
                            }}
                            className="bg-transparent border-b border-dashed border-slate-300 focus:outline-none font-bold"
                          >
                            {campuses.map((c) => (
                              <option key={c.id} value={c.name}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <select
                            value={r.shift}
                            onChange={(e) => {
                              const next = [...ocrParsedRows]
                              next[i].shift = e.target.value as Shift
                              next[i].entryTime = DEFAULT_SHIFT_TIMES[e.target.value as Shift].entry
                              setOcrParsedRows(next)
                            }}
                            className="bg-transparent border-b border-dashed border-slate-300 focus:outline-none font-black text-[10px]"
                          >
                            <option value={Shift.MANANA}>MANANA</option>
                            <option value={Shift.INTERMEDIO}>INTERMEDIO</option>
                            <option value={Shift.TARDE}>TARDE</option>
                          </select>
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => setOcrParsedRows((prev) => prev.filter((_, idx) => idx !== i))}
                            className="text-rose-500 hover:text-rose-700 font-bold"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-4 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsOcrOpen(false)
                setOcrParsedRows([])
                setOcrImage(null)
              }}
              className="flex-1 h-12 rounded-xl font-bold"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={ocrParsedRows.length === 0 || isPending}
              onClick={handleSaveOcrRows}
              className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md"
            >
              {isPending ? <Loader2 className="animate-spin" /> : `Guardar ${ocrParsedRows.length} Turnos`}
            </Button>
          </div>
        </div>
      </ScheduleModal>
    </div>
  )
}
