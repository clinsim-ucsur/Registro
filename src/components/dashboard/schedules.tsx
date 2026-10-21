"use client"

import { useState, useTransition, useMemo, useEffect } from "react"
import { createPortal } from "react-dom"
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
  Users,
  Sun,
  CalendarDays,
  RefreshCw,
  Zap,
  ArrowRightLeft
} from "lucide-react"
import { toast } from "sonner"
import * as XLSX from "xlsx"
import { 
  upsertTechnicianScheduleAction, 
  deleteTechnicianScheduleAction, 
  bulkUpsertTechnicianSchedulesAction,
  getTechnicianSchedulesAction,
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

// Modal básico estilizado renderizado mediante Portal en document.body para cubrir toda la pantalla y difuminar la barra lateral
function ScheduleModal({ 
  isOpen, 
  onClose, 
  title, 
  maxWidth = "max-w-2xl",
  children 
}: { 
  isOpen: boolean 
  onClose: () => void 
  title: string 
  maxWidth?: string
  children: React.ReactNode 
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!isOpen || !mounted || typeof document === "undefined") return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in-up p-4">
      <div className={`bg-white w-full ${maxWidth} max-h-[92vh] overflow-y-auto no-scrollbar rounded-[2rem] shadow-2xl p-6 md:p-8 relative`}>
        <button 
          type="button"
          onClick={onClose} 
          className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition-colors font-bold z-10"
        >
          ✕
        </button>
        <h3 className="text-2xl font-black text-[#0B1B3D] mb-6">{title}</h3>
        {children}
      </div>
    </div>,
    document.body
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
  const [isSundayModalOpen, setIsSundayModalOpen] = useState(false)
  const [sundayDate, setSundayDate] = useState<string>("")
  const [sundayAssignments, setSundayAssignments] = useState<
    Record<
      string,
      {
        shift: Shift
        campusId: string
        expectedEntryTime: string
        notes: string
      }
    >
  >({})
  const [isSavingSunday, startSundayTransition] = useTransition()

  // Lista de domingos disponibles en el mes seleccionado o próximos
  const sundaysList = useMemo(() => {
    const list: { date: string; label: string; isNext: boolean }[] = []
    if (!selectedMonth) return list
    const [yearStr, monthStr] = selectedMonth.split("-")
    const year = Number(yearStr)
    const month = Number(monthStr) - 1

    const d = new Date(Date.UTC(year, month, 1, 12, 0, 0))
    while (d.getUTCMonth() === month) {
      if (d.getUTCDay() === 0) {
        const dStr = d.toISOString().slice(0, 10)
        const dayNum = d.getUTCDate()
        const monthName = d.toLocaleDateString("es-PE", { month: "short", timeZone: "UTC" })
        list.push({
          date: dStr,
          label: `Domingo ${dayNum} de ${monthName}`,
          isNext: false,
        })
      }
      d.setUTCDate(d.getUTCDate() + 1)
    }

    // Calcular el próximo domingo absoluto
    const now = new Date()
    const cur = new Date(now)
    const currentDay = cur.getDay() // 0 = Sunday
    const daysUntilSunday = (7 - currentDay) % 7
    cur.setDate(cur.getDate() + (daysUntilSunday === 0 ? 0 : daysUntilSunday))
    const nextSundayStr = cur.toISOString().slice(0, 10)

    const found = list.find((item) => item.date === nextSundayStr)
    if (found) {
      found.isNext = true
      found.label += " (Próximo)"
    } else {
      const dayNum = cur.getDate()
      const monthName = cur.toLocaleDateString("es-PE", { month: "short" })
      list.unshift({
        date: nextSundayStr,
        label: `Domingo ${dayNum} de ${monthName} (Próximo Domingo)`,
        isNext: true,
      })
    }

    return list
  }, [selectedMonth])

  const openSundayManager = (targetDate?: string) => {
    const dateToUse = targetDate || sundaysList[0]?.date || new Date().toISOString().slice(0, 10)
    setSundayDate(dateToUse)

    const initialMap: Record<
      string,
      { shift: Shift; campusId: string; expectedEntryTime: string; notes: string }
    > = {}

    // Buscar si ya existen turnos registrados en este domingo en schedules
    const existingForDate = schedules.filter((s) => s.date === dateToUse)
    const existingMap = new Map(existingForDate.map((s) => [s.userId, s]))

    technicians.forEach((t) => {
      const existing = existingMap.get(t.id)
      if (existing) {
        initialMap[t.id] = {
          shift: existing.shift,
          campusId: existing.campusId,
          expectedEntryTime: existing.expectedEntryTime,
          notes: existing.notes || "",
        }
      } else {
        // Regla habitual dominical:
        // - Personal habitual TARDE -> pasa a INTERMEDIO (09:00 AM)
        // - Personal habitual MAÑANA -> se mantiene en MAÑANA (06:00 AM)
        // - Personal habitual INTERMEDIO -> INTERMEDIO (09:00 AM)
        // - Personal habitual NOCHE -> NOCHE (21:00)
        const baseShift = (t.defaultShift as Shift) || Shift.MANANA
        let sunShift: Shift = baseShift
        let entry = "06:00"

        if (baseShift === Shift.TARDE) {
          sunShift = Shift.INTERMEDIO
          entry = "09:00"
        } else if (baseShift === Shift.MANANA) {
          sunShift = Shift.MANANA
          entry = "06:00"
        } else if (baseShift === Shift.INTERMEDIO) {
          sunShift = Shift.INTERMEDIO
          entry = "09:00"
        } else if (baseShift === Shift.NOCHE) {
          sunShift = Shift.NOCHE
          entry = "21:00"
        }

        initialMap[t.id] = {
          shift: sunShift,
          campusId: t.campus?.id || campuses[0]?.id || "",
          expectedEntryTime: entry,
          notes: "Turno de Domingo",
        }
      }
    })

    setSundayAssignments(initialMap)
    setIsSundayModalOpen(true)
  }

  // Regla habitual: Tarde a Intermedio
  const applyStandardSundayRule = () => {
    setSundayAssignments((prev) => {
      const next = { ...prev }
      technicians.forEach((t) => {
        const baseShift = (t.defaultShift as Shift) || Shift.MANANA
        if (baseShift === Shift.TARDE) {
          next[t.id] = {
            ...next[t.id],
            shift: Shift.INTERMEDIO,
            expectedEntryTime: "09:00",
          }
        } else if (baseShift === Shift.MANANA) {
          next[t.id] = {
            ...next[t.id],
            shift: Shift.MANANA,
            expectedEntryTime: "06:00",
          }
        }
      })
      return next
    })
    toast.info("Regla habitual aplicada: Personal de la tarde pasa a Intermedio (9:00 AM).")
  }

  // Todos a Intermedio (Mañana y Tarde)
  const applyAllToIntermediate = () => {
    setSundayAssignments((prev) => {
      const next = { ...prev }
      technicians.forEach((t) => {
        const baseShift = (t.defaultShift as Shift) || Shift.MANANA
        if (baseShift !== Shift.NOCHE) {
          next[t.id] = {
            ...next[t.id],
            shift: Shift.INTERMEDIO,
            expectedEntryTime: "09:00",
          }
        }
      })
      return next
    })
    toast.info("Todos los técnicos diurnos configurados en Turno Intermedio (9:00 AM).")
  }

  // Restablecer a perfiles base
  const resetToDefaultProfileShifts = () => {
    setSundayAssignments((prev) => {
      const next = { ...prev }
      technicians.forEach((t) => {
        const baseShift = (t.defaultShift as Shift) || Shift.MANANA
        const def = DEFAULT_SHIFT_TIMES[baseShift] || DEFAULT_SHIFT_TIMES.MANANA
        next[t.id] = {
          ...next[t.id],
          shift: baseShift,
          expectedEntryTime: def.entry,
        }
      })
      return next
    })
    toast.info("Turnos restablecidos a los perfiles habituales de cada técnico.")
  }

  const handleSaveSunday = () => {
    if (!sundayDate) {
      toast.error("Seleccione la fecha del domingo.")
      return
    }

    startSundayTransition(async () => {
      const items: ScheduleItemInput[] = technicians.map((t) => {
        const current = sundayAssignments[t.id]
        const shift = current?.shift || Shift.INTERMEDIO
        const def = DEFAULT_SHIFT_TIMES[shift] || DEFAULT_SHIFT_TIMES.INTERMEDIO
        return {
          userId: t.id,
          date: sundayDate,
          campusId: current?.campusId || t.campus?.id || campuses[0]?.id || "",
          shift,
          expectedEntryTime: current?.expectedEntryTime || def.entry,
          earlyEntryToleranceMinutes: def.early,
          gracePeriodMinutes: def.grace,
          lateToleranceMinutes: def.late,
          notes: current?.notes || "Turno asignado para este domingo",
        }
      })

      const res = await bulkUpsertTechnicianSchedulesAction(items)
      if (res.success) {
        toast.success(`✓ Turnos guardados exitosamente para el domingo ${sundayDate}`)
        // Actualizar tabla en tiempo real
        const refresh = await getTechnicianSchedulesAction({ month: selectedMonth })
        if (refresh.success && refresh.schedules) {
          setSchedules(refresh.schedules as any)
        }
        setIsSundayModalOpen(false)
      } else {
        toast.error(res.message || "Error al guardar turnos de domingo.")
      }
    })
  }

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

    // Normalizador de texto para emparejar nombres y sedes
  const normText = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()

  // Emparejar nombre de fila con un técnico registrado en el sistema
  const matchTechFromText = (rowText: string) => {
    const nRow = normText(rowText)
    const rowWords = nRow.split(" ").filter((w) => w.length >= 3)
    if (rowWords.length === 0) return null

    // 1. Coincidencia por DNI
    for (const t of technicians) {
      if (t.dni && nRow.includes(t.dni)) return t
    }

    // 2. Coincidencia por palabras del nombre (al menos 2 coincidencias de nombres/apellidos)
    let bestTech: any = null
    let bestScore = 0

    for (const t of technicians) {
      const nTech = normText(t.name)
      const techWords = nTech.split(" ").filter((w) => w.length >= 3)
      const matches = rowWords.filter((rw) => techWords.some((tw) => tw.includes(rw) || rw.includes(tw)))
      const score = matches.length

      if (score >= 2 && score > bestScore) {
        bestScore = score
        bestTech = t
      } else if (rowWords.length === 1 && score === 1 && score > bestScore) {
        bestScore = score
        bestTech = t
      }
    }

    return bestTech
  }

  // Parsear contenido de celda de turno y rotación (ej: M, T, I, M(N), T(N), M(V), M(A))
  const parseShiftCell = (cellVal: any, defaultCampusName: string) => {
    if (!cellVal) return null
    const str = String(cellVal).trim()
    if (!str) return null

    // Ignorar feriados o textos descriptivos
    const upper = str.toUpperCase()
    if (upper === "F" || upper.startsWith("FERIAD") || upper.startsWith("VAC") || upper === "V" && !str.includes("(")) {
      return null
    }

    // Detección explícita de DESCANSO / LIBRE (D, DESC, DESCANSO, L, LIBRE)
    if (/^(D|DESC|DESCANSO|L|LIBRE)$/i.test(str)) {
      return {
        shift: Shift.DESCANSO,
        campusName: defaultCampusName,
      }
    }

    // Formato de rotación: LETRA(SEDE), ej: M(N), T(N), M(V), T(V), M(A)
    const rotMatch = str.match(/^([MTI])\s*\(([NVA])\)$/i)
    let shiftLetter = ""
    let targetCampus = defaultCampusName

    if (rotMatch) {
      shiftLetter = rotMatch[1].toUpperCase()
      const campusCode = rotMatch[2].toUpperCase()
      if (campusCode === "N") targetCampus = "Campus Norte"
      else if (campusCode === "A") targetCampus = "Campus Ate"
      else if (campusCode === "V") targetCampus = "Campus Villa"
    } else {
      const singleMatch = str.match(/^([MTI])/i)
      if (!singleMatch) return null
      shiftLetter = singleMatch[1].toUpperCase()
    }

    let shift: Shift = Shift.MANANA
    if (shiftLetter === "T") shift = Shift.TARDE
    else if (shiftLetter === "I") shift = Shift.INTERMEDIO

    return {
      shift,
      campusName: targetCampus,
    }
  }

  // Leer Excel (soporta tanto formato tabular como matriz de rol mensual)
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: "binary" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rawGrid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })

        if (!rawGrid || rawGrid.length === 0) {
          toast.error("El archivo está vacío.")
          return
        }

        // Detectar si es el formato de Rol Mensual de Técnicos (Matriz con días 1 al 31)
        let isMatrixFormat = false
        let dayRowIndex = -1
        let dayColMap: { col: number; day: number }[] = []

        // Buscar fila que contenga los días numerados del 1 al 28+
        for (let r = 0; r < Math.min(rawGrid.length, 10); r++) {
          const row = rawGrid[r]
          const numbers: { col: number; day: number }[] = []
          for (let c = 0; c < row.length; c++) {
            const val = Number(String(row[c]).trim())
            if (!isNaN(val) && val >= 1 && val <= 31) {
              numbers.push({ col: c, day: val })
            }
          }
          if (numbers.length >= 15) {
            isMatrixFormat = true
            dayRowIndex = r
            dayColMap = numbers
            break
          }
        }

        if (isMatrixFormat) {
          // Detectar Mes y Año del encabezado o usar el actual
          const fullText = rawGrid.slice(0, 5).map((r) => r.join(" ")).join(" ").toLowerCase()
          const today = new Date()
          let refYear = today.getFullYear()
          let refMonth = today.getMonth() + 1

          const monthMap: Record<string, number> = {
            enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
            julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
          }
          for (const [mName, mNum] of Object.entries(monthMap)) {
            if (fullText.includes(mName)) {
              refMonth = mNum
              break
            }
          }
          const ym = fullText.match(/202\d/)
          if (ym) refYear = Number(ym[0])

          let currentCampus = "Campus Villa"
          const matrixMapped: ScheduleItemInput[] = []

          for (let r = dayRowIndex + 1; r < rawGrid.length; r++) {
            const row = rawGrid[r]
            const lineText = row.map((cell) => String(cell || "").trim()).join(" ")
            const upperLine = lineText.toUpperCase()

            // Detección de encabezado de sección de sede
            if (upperLine.includes("SEDE VILLA")) {
              currentCampus = "Campus Villa"
              continue
            } else if (upperLine.includes("SEDE NORTE")) {
              currentCampus = "Campus Norte"
              continue
            } else if (upperLine.includes("SEDE ATE")) {
              currentCampus = "Campus Ate"
              continue
            }

            if (upperLine.includes("EVENTOS DEL MES") || upperLine.includes("FERIADO")) {
              continue
            }

            // Primeras columnas suelen contener el nombre del técnico
            const nameCandidate = row.slice(0, 4).filter(Boolean).map(String).join(" ").trim()
            if (!nameCandidate || nameCandidate.length < 3) continue

            const tech = matchTechFromText(nameCandidate)
            if (!tech) continue

            // Recorrer las columnas de los días
            for (const { col, day } of dayColMap) {
              const cellVal = row[col]
              const parsed = parseShiftCell(cellVal, currentCampus)
              const dateStr = `${refYear}-${String(refMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
              
              if (parsed) {
                matrixMapped.push({
                  dni: tech.dni,
                  name: tech.name,
                  date: dateStr,
                  campusName: parsed.campusName,
                  shift: parsed.shift,
                  expectedEntryTime: DEFAULT_SHIFT_TIMES[parsed.shift].entry,
                  notes: parsed.shift === Shift.DESCANSO 
                    ? "Descanso programado" 
                    : (parsed.campusName !== currentCampus ? `Rotación a ${parsed.campusName}` : "Rol mensual"),
                })
              } else if (!cellVal || String(cellVal).trim() === "") {
                // Espacio vacío en la programación = Descanso programado
                matrixMapped.push({
                  dni: tech.dni,
                  name: tech.name,
                  date: dateStr,
                  campusName: currentCampus,
                  shift: Shift.DESCANSO,
                  expectedEntryTime: "00:00",
                  notes: "Descanso programado (espacio libre en rol)",
                })
              }
            }
          }

          setExcelPreview(matrixMapped)
          toast.success(`¡Rol mensual detectado! Se cargaron ${matrixMapped.length} turnos programados para ${refMonth}/${refYear}.`)
          return
        }

        // Formato estándar tabular (DNI, Nombre, Fecha, Sede, Turno)
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" })
        const mapped: ScheduleItemInput[] = rows.map((r) => {
          const keys = Object.keys(r)
          const getVal = (possibleKeys: string[]) => {
            const k = keys.find((key) => possibleKeys.includes(key.toLowerCase().trim()))
            return k ? String(r[k]).trim() : ""
          }

          let rawDate = getVal(["fecha", "date", "dia"])
          if (/^\d{5}$/.test(rawDate)) {
            const parsed = new Date((Number(rawDate) - (25567 + 1)) * 86400 * 1000)
            rawDate = parsed.toISOString().slice(0, 10)
          }

          let shiftVal: Shift = Shift.MANANA
          const sText = getVal(["turno", "shift", "horario"]).toUpperCase()
          if (sText.includes("DESC") || sText.includes("LIBRE") || sText === "D" || sText === "L") shiftVal = Shift.DESCANSO
          else if (sText.includes("TARDE") || sText === "T") shiftVal = Shift.TARDE
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
        console.error(err)
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

    // Parsear texto de la imagen del rol mensual con lectura de secciones de sedes y rotaciones
  const parseOcrTextToRows = (text: string) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 1)
    const detectedRows: any[] = []

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

    let currentCampus = "Campus Villa"

    for (const line of lines) {
      const upperLine = line.toUpperCase()

      // Detección de sección de sede
      if (upperLine.includes("SEDE VILLA") || upperLine.includes("VILLA")) {
        currentCampus = "Campus Villa"
      } else if (upperLine.includes("SEDE NORTE") || upperLine.includes("NORTE")) {
        currentCampus = "Campus Norte"
      } else if (upperLine.includes("SEDE ATE") || upperLine.includes("ATE")) {
        currentCampus = "Campus Ate"
      }

      // Buscar si la línea corresponde a un técnico
      const matchedTech = matchTechFromText(line)
      if (matchedTech) {
        // Extraer los turnos y rotaciones en la línea (ej: M, T, I, M(N), T(N), M(V), D)
        const tokens = line.match(/([MTI]\s*\([NVA]\)|[MTID])/gi)
        if (tokens && tokens.length > 0) {
          tokens.forEach((token, idx) => {
            const parsed = parseShiftCell(token, currentCampus)
            if (parsed) {
              const day = Math.min(idx + 1, 31)
              const dateStr = `${refYear}-${String(refMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
              detectedRows.push({
                name: matchedTech.name,
                dni: matchedTech.dni || "",
                date: dateStr,
                campusName: parsed.campusName,
                shift: parsed.shift,
                entryTime: DEFAULT_SHIFT_TIMES[parsed.shift].entry,
              })
            }
          })
        }
      }
    }

    setOcrParsedRows(detectedRows)
    if (detectedRows.length > 0) {
      toast.success(`¡Rol reconocido! Se detectaron ${detectedRows.length} turnos para el mes ${refMonth}/${refYear}.`)
    } else {
      toast.warning("No se pudo estructurar el texto de la imagen automáticamente. Te recomendamos importar directamente el archivo Excel (.xlsx) del rol que se procesa al 100% con total precisión.")
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
            onClick={() => openSundayManager()}
            className="h-12 px-5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-extrabold rounded-xl shadow-md shadow-orange-500/20 flex items-center gap-2 transition-transform hover:scale-105"
          >
            <Sun size={20} className="text-yellow-100" />
            Turnos de Domingo
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
                          s.shift === Shift.DESCANSO
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : s.shift === Shift.MANANA 
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : s.shift === Shift.INTERMEDIO
                            ? "bg-cyan-50 text-cyan-700 border border-cyan-200"
                            : "bg-purple-50 text-purple-700 border border-purple-200"
                        }`}>
                          {s.shift === Shift.DESCANSO ? "🏖️ DESCANSO" : s.shift}
                        </span>
                      </TableCell>
                      <TableCell className="font-black text-slate-800 text-sm">
                        {s.shift === Shift.DESCANSO ? (
                          <span className="text-emerald-600 text-xs font-bold">Día Libre</span>
                        ) : (
                          `⏰ ${s.expectedEntryTime}`
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 font-medium">
                        {s.shift === Shift.DESCANSO ? (
                          <span className="text-slate-400 italic">No requiere asistencia</span>
                        ) : (
                          `Anticipo: ${s.earlyEntryToleranceMinutes}m | Gracia: ${s.gracePeriodMinutes}m | Tard: ${s.lateToleranceMinutes}m`
                        )}
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { key: Shift.MANANA, label: "Mañana (06:00)", color: "border-amber-400 bg-amber-50" },
                { key: Shift.INTERMEDIO, label: "Intermedio (09:00)", color: "border-cyan-400 bg-cyan-50" },
                { key: Shift.TARDE, label: "Tarde (13:00)", color: "border-purple-400 bg-purple-50" },
                { key: Shift.DESCANSO, label: "🏖️ Descanso (Libre)", color: "border-emerald-400 bg-emerald-50 text-emerald-800" },
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
                            <option value={Shift.DESCANSO}>DESCANSO</option>
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

      {/* MODAL GESTOR RÁPIDO DE DOMINGOS */}
      <ScheduleModal
        isOpen={isSundayModalOpen}
        onClose={() => setIsSundayModalOpen(false)}
        title="Asignación Rápida de Turnos para Domingo"
        maxWidth="max-w-5xl"
      >
        <div className="space-y-6">
          {/* Banner explicativo */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border border-amber-200/80 flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500 text-white shrink-0 mt-0.5">
              <Sun size={20} />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-black text-amber-950">
                Rotación de Turnos Especiales de Domingo
              </h4>
              <p className="text-xs font-medium text-amber-800 leading-relaxed">
                En domingos, el personal con turno habitual de la <strong>Tarde</strong> cambia comúnmente a <strong>Intermedio (09:00 AM)</strong>, mientras que los de la <strong>Mañana</strong> pueden continuar en Mañana (06:00 AM) o pasar a Intermedio. Selecciona la fecha y usa los botones de 1 clic para configurar a todos los técnicos al instante.
              </p>
            </div>
          </div>

          {/* Selector de Fecha del Domingo y Atajos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-1.5 flex items-center gap-1.5">
                <CalendarDays size={16} className="text-[#1967D2]" /> Fecha del Domingo a Programar
              </label>
              <select
                value={sundayDate}
                onChange={(e) => openSundayManager(e.target.value)}
                className="w-full h-11 bg-white border border-slate-200 font-extrabold text-slate-800 rounded-xl px-3 outline-none focus:ring-2 focus:ring-[#1967D2] text-sm"
              >
                {sundaysList.map((sun) => (
                  <option key={sun.date} value={sun.date}>
                    {sun.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-1.5 flex items-center gap-1.5">
                <Zap size={16} className="text-amber-500" /> Atajos de Configuración
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={applyStandardSundayRule}
                  className="text-xs font-bold text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100 h-9 rounded-xl"
                  title="Pasa los técnicos de la tarde a Intermedio (9 AM), mantiene Mañana en Mañana (6 AM)"
                >
                  ⚡ Tarde ➔ Intermedio
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={applyAllToIntermediate}
                  className="text-xs font-bold text-blue-800 bg-blue-50 border-blue-200 hover:bg-blue-100 h-9 rounded-xl"
                  title="Pasa todos los técnicos (Mañana y Tarde) a Turno Intermedio"
                >
                  ⚡ Todos a Intermedio
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={resetToDefaultProfileShifts}
                  className="text-xs font-bold text-slate-600 hover:bg-slate-200 h-9 rounded-xl"
                >
                  <RefreshCw size={13} className="mr-1" /> Base
                </Button>
              </div>
            </div>
          </div>

          {/* Tabla de Técnicos */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-xs">
            <div className="max-h-[380px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-3 px-3">Técnico</th>
                    <th className="py-3 px-3">Turno Habitual</th>
                    <th className="py-3 px-3">Turno para este Domingo</th>
                    <th className="py-3 px-3">Sede</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {technicians.map((t) => {
                    const current = sundayAssignments[t.id] || {
                      shift: Shift.INTERMEDIO,
                      campusId: t.campus?.id || campuses[0]?.id || "",
                      expectedEntryTime: "09:00",
                      notes: "Turno de Domingo",
                    }
                    const baseShift = (t.defaultShift as Shift) || Shift.MANANA
                    const isShiftChanged = current.shift !== baseShift

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black text-xs flex items-center justify-center shrink-0">
                              {t.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                            </div>
                            <div>
                              <p className="font-extrabold text-xs text-slate-800 leading-snug">{t.name}</p>
                              <p className="text-[10px] text-slate-400 font-mono">DNI: {t.dni}</p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            baseShift === Shift.MANANA
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : baseShift === Shift.INTERMEDIO
                              ? "bg-cyan-50 text-cyan-700 border border-cyan-200"
                              : baseShift === Shift.TARDE
                              ? "bg-purple-50 text-purple-700 border border-purple-200"
                              : "bg-indigo-50 text-indigo-700 border border-indigo-200"
                          }`}>
                            {baseShift === Shift.MANANA ? "🌅 Mañana" : baseShift === Shift.TARDE ? "🌆 Tarde" : baseShift === Shift.INTERMEDIO ? "⛅ Interm." : "🌙 Noche"}
                          </span>
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            {[
                              { shift: Shift.MANANA, label: "Mañana", entry: "06:00", icon: "🌅" },
                              { shift: Shift.INTERMEDIO, label: "Interm. 9 AM", entry: "09:00", icon: "⛅" },
                              { shift: Shift.INTERMEDIO, label: "Interm. 10 AM", entry: "10:00", icon: "⛅" },
                              { shift: Shift.TARDE, label: "Tarde", entry: "13:00", icon: "🌆" },
                              { shift: Shift.NOCHE, label: "Noche", entry: "21:00", icon: "🌙" },
                              { shift: Shift.DESCANSO, label: "Descanso", entry: "00:00", icon: "🏖️" },
                            ].map((opt, idx) => {
                              const isSelected = current.shift === opt.shift && current.expectedEntryTime === opt.entry
                              return (
                                <button
                                  key={`${opt.shift}-${opt.entry}-${idx}`}
                                  type="button"
                                  onClick={() => {
                                    setSundayAssignments((prev) => ({
                                      ...prev,
                                      [t.id]: {
                                        ...current,
                                        shift: opt.shift,
                                        expectedEntryTime: opt.entry,
                                        notes: "Asignación especial de Domingo",
                                      },
                                    }))
                                  }}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1 ${
                                    isSelected
                                      ? "bg-[#1967D2] text-white border-[#1967D2] shadow-xs ring-1 ring-blue-300 font-black scale-105"
                                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                                  }`}
                                >
                                  <span>{opt.icon}</span>
                                  <span>{opt.label}</span>
                                </button>
                              )
                            })}
                          </div>
                          {isShiftChanged && (
                            <span className="text-[9px] font-extrabold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full inline-block mt-1 border border-blue-200">
                              ✓ Asignado: {current.shift} ({current.expectedEntryTime})
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <select
                            value={current.campusId}
                            onChange={(e) => {
                              setSundayAssignments((prev) => ({
                                ...prev,
                                [t.id]: {
                                  ...current,
                                  campusId: e.target.value,
                                },
                              }))
                            }}
                            className="h-8 text-xs font-bold bg-white border border-slate-200 rounded-lg px-2 text-slate-700 outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            {campuses.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Botones Guardar y Cancelar */}
          <div className="flex gap-4 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsSundayModalOpen(false)}
              className="flex-1 h-12 rounded-xl font-bold"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isSavingSunday}
              onClick={handleSaveSunday}
              className="flex-1 h-12 bg-[#1967D2] hover:bg-blue-800 text-white font-extrabold rounded-xl shadow-lg shadow-blue-500/20"
            >
              {isSavingSunday ? (
                <>
                  <Loader2 className="animate-spin mr-2" size={18} /> Guardando Turnos...
                </>
              ) : (
                `Guardar Turnos para el Domingo (${technicians.length} técnicos)`
              )}
            </Button>
          </div>
        </div>
      </ScheduleModal>
    </div>
  )
}
