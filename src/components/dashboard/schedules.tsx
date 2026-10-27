"use client"

import React, { useState, useTransition, useMemo, useEffect, Fragment } from "react"
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
  ArrowRightLeft,
  Building2,
  Check,
  X,
  Save,
  ChevronLeft,
  ChevronRight
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

export interface MatrixCell {
  token: string // "M", "T", "I", "M(N)", "T(N)", "M(V)", "M(A)", "D", "F", "VAC"
  shift: Shift
  campusName: string
  entryTime: string
  notes?: string
}

export interface MatrixRow {
  rowId: string
  techId?: string
  name: string
  dni?: string
  campusName: string
  days: Record<number, MatrixCell>
}

export interface MatrixSchedulePreview {
  year: number
  month: number
  monthLabel: string
  daysInMonth: number
  daysMeta: {
    dayNumber: number
    dayLetter: string
    isSunday: boolean
    dateStr: string
  }[]
  sedes: string[]
  rows: MatrixRow[]
}

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
  const [isLoadingMonth, setIsLoadingMonth] = useState(false)

  // Carga automática del cronograma completo desde el servidor al cambiar de mes
  useEffect(() => {
    if (!selectedMonth) return
    let isMounted = true
    const fetchSchedulesForMonth = async () => {
      setIsLoadingMonth(true)
      try {
        const res = await getTechnicianSchedulesAction({ month: selectedMonth })
        if (res.success && res.schedules && isMounted) {
          setSchedules((prev) => {
            const others = prev.filter((s) => !s.date.startsWith(selectedMonth))
            return [...others, ...(res.schedules as any)]
          })
        }
      } catch (err) {
        console.error("Error al cargar cronogramas del mes:", err)
      } finally {
        if (isMounted) setIsLoadingMonth(false)
      }
    }

    fetchSchedulesForMonth()
    return () => {
      isMounted = false
    }
  }, [selectedMonth])

  // Modales
  const [isIndividualOpen, setIsIndividualOpen] = useState(false)
  const [isBulkOpen, setIsBulkOpen] = useState(false)
  const [isOcrOpen, setIsOcrOpen] = useState(false)
  const [isSundayModalOpen, setIsSundayModalOpen] = useState(false)
  const [sundayDate, setSundayDate] = useState<string>("")
  const [activeCampuses, setActiveCampuses] = useState<Record<string, boolean>>({})
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

  // Conteo en tiempo real de técnicos trabajando vs en descanso en el domingo y sedes activas
  const { workingCount, restingCount, activeCampusesCount } = useMemo(() => {
    let working = 0
    let resting = 0
    technicians.forEach((t) => {
      const item = sundayAssignments[t.id]
      if (!item || item.shift === Shift.DESCANSO) {
        resting++
      } else {
        working++
      }
    })
    const activeCount = campuses.filter((c) => activeCampuses[c.id]).length
    return { workingCount: working, restingCount: resting, activeCampusesCount: activeCount }
  }, [sundayAssignments, technicians, campuses, activeCampuses])

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
    const initialActiveCampuses: Record<string, boolean> = {}

    technicians.forEach((t) => {
      const existing = existingMap.get(t.id)
      if (existing) {
        initialMap[t.id] = {
          shift: existing.shift,
          campusId: existing.campusId,
          expectedEntryTime: existing.expectedEntryTime,
          notes: existing.notes || (existing.shift === Shift.DESCANSO ? "Descanso dominical" : "Guardia Dominical"),
        }
      } else {
        // Por defecto, si no tiene asignación previa, inicia en descanso dominical
        initialMap[t.id] = {
          shift: Shift.DESCANSO,
          campusId: t.campus?.id || campuses[0]?.id || "",
          expectedEntryTime: "00:00",
          notes: "Descanso dominical",
        }
      }
    })

    const hasAnyExistingRecords = existingForDate.length > 0

    campuses.forEach((c) => {
      if (hasAnyExistingRecords) {
        // Una sede se marca activa si ya tenía algún técnico asignado a trabajar
        const hasWorking = existingForDate.some(
          (s) => s.campusId === c.id && s.shift !== Shift.DESCANSO
        )
        initialActiveCampuses[c.id] = hasWorking
      } else {
        // Si es un domingo nuevo sin programar: preactivar Villa y Norte (sedes operativas típicas),
        // y dejar Ate y Aramburú inactivas (vacías) salvo que se decida activarlas
        const cLower = c.name.toLowerCase()
        initialActiveCampuses[c.id] = cLower.includes("villa") || cLower.includes("norte")
      }
    })

    setActiveCampuses(initialActiveCampuses)
    setSundayAssignments(initialMap)
    setIsSundayModalOpen(true)
  }

  // Alternar estado activo / sin actividad de una sede
  const toggleCampusActivity = (campusId: string) => {
    setActiveCampuses((prev) => {
      const willBeActive = !prev[campusId]
      if (!willBeActive) {
        // Si se desactiva la sede, enviar a todos los técnicos asignados a ella a Descanso
        setSundayAssignments((curr) => {
          const next = { ...curr }
          technicians.forEach((t) => {
            if (next[t.id]?.campusId === campusId && next[t.id]?.shift !== Shift.DESCANSO) {
              next[t.id] = {
                shift: Shift.DESCANSO,
                campusId: t.campus?.id || campusId,
                expectedEntryTime: "00:00",
                notes: "Descanso dominical",
              }
            }
          })
          return next
        })
      }
      return { ...prev, [campusId]: willBeActive }
    })
  }

  // Asignar técnico a una sede específica
  const assignTechToCampus = (
    techId: string, 
    campusId: string, 
    shift: Shift = Shift.MANANA, 
    entryTime = "06:00"
  ) => {
    if (!techId) return
    const campusObj = campuses.find((c) => c.id === campusId)
    const techObj = technicians.find((t) => t.id === techId)
    const isSupport = techObj?.campus?.id && techObj.campus.id !== campusId

    setSundayAssignments((prev) => ({
      ...prev,
      [techId]: {
        shift,
        campusId,
        expectedEntryTime: entryTime,
        notes: isSupport
          ? `Guardia dominical en ${campusObj?.name || "sede"} (Apoyo desde ${techObj?.campus?.name || "otra sede"})`
          : `Guardia dominical en ${campusObj?.name || "sede"}`,
      },
    }))
    setActiveCampuses((prev) => ({ ...prev, [campusId]: true }))
  }

  // Reemplazar técnico en un slot de una sede
  const replaceTechInCampus = (oldTechId: string, newTechId: string, campusId: string) => {
    if (!newTechId || oldTechId === newTechId) return
    const currentOld = sundayAssignments[oldTechId]
    const currentShift = currentOld?.shift || Shift.MANANA
    const currentEntry = currentOld?.expectedEntryTime || "06:00"

    const campusObj = campuses.find((c) => c.id === campusId)
    const oldTechObj = technicians.find((t) => t.id === oldTechId)
    const newTechObj = technicians.find((t) => t.id === newTechId)
    const isSupport = newTechObj?.campus?.id && newTechObj.campus.id !== campusId

    setSundayAssignments((prev) => {
      const next = { ...prev }
      if (oldTechId) {
        next[oldTechId] = {
          shift: Shift.DESCANSO,
          campusId: oldTechObj?.campus?.id || campusId,
          expectedEntryTime: "00:00",
          notes: "Descanso dominical",
        }
      }
      next[newTechId] = {
        shift: currentShift,
        campusId,
        expectedEntryTime: currentEntry,
        notes: isSupport
          ? `Guardia dominical en ${campusObj?.name || "sede"} (Apoyo desde ${newTechObj?.campus?.name || "otra sede"})`
          : `Guardia dominical en ${campusObj?.name || "sede"}`,
      }
      return next
    })
    setActiveCampuses((prev) => ({ ...prev, [campusId]: true }))
  }

  // Quitar técnico de una sede (pasa automáticamente a Descanso)
  const unassignTech = (techId: string) => {
    const techObj = technicians.find((t) => t.id === techId)
    setSundayAssignments((prev) => ({
      ...prev,
      [techId]: {
        shift: Shift.DESCANSO,
        campusId: techObj?.campus?.id || campuses[0]?.id || "",
        expectedEntryTime: "00:00",
        notes: "Descanso dominical",
      },
    }))
  }

  // Asignar rápidamente 1 Mañana + 1 Tarde a una sede específica
  const quickAssignMorningAndAfternoon = (campusId: string) => {
    const campusObj = campuses.find((c) => c.id === campusId)
    
    // Candidatos en descanso: priorizar personal de esta sede, luego personal de otras sedes (ej: Ate)
    const restingFromThisCampus = technicians.filter(
      (t) => t.campus?.id === campusId && (!sundayAssignments[t.id] || sundayAssignments[t.id].shift === Shift.DESCANSO)
    )
    const restingFromOtherCampuses = technicians.filter(
      (t) => t.campus?.id !== campusId && (!sundayAssignments[t.id] || sundayAssignments[t.id].shift === Shift.DESCANSO)
    )

    const candidates = [...restingFromThisCampus, ...restingFromOtherCampuses]

    if (candidates.length < 2) {
      toast.warning("No hay suficientes técnicos disponibles en descanso para asignar 2 a esta sede.")
      return
    }

    const tMorning = candidates[0]
    const tAfternoon = candidates[1]

    setSundayAssignments((prev) => {
      const next = { ...prev }
      const isSupportM = tMorning.campus?.id && tMorning.campus.id !== campusId
      const isSupportA = tAfternoon.campus?.id && tAfternoon.campus.id !== campusId

      next[tMorning.id] = {
        shift: Shift.MANANA,
        campusId,
        expectedEntryTime: "06:00",
        notes: isSupportM
          ? `Guardia dominical en ${campusObj?.name || "sede"} (Apoyo desde ${tMorning.campus?.name || "otra sede"})`
          : `Guardia dominical en ${campusObj?.name || "sede"}`,
      }
      next[tAfternoon.id] = {
        shift: Shift.TARDE,
        campusId,
        expectedEntryTime: "13:00",
        notes: isSupportA
          ? `Guardia dominical en ${campusObj?.name || "sede"} (Apoyo desde ${tAfternoon.campus?.name || "otra sede"})`
          : `Guardia dominical en ${campusObj?.name || "sede"}`,
      }
      return next
    })

    setActiveCampuses((prev) => ({ ...prev, [campusId]: true }))
    toast.success(`✓ Asignados 2 técnicos a ${campusObj?.name || "la sede"}: ${tMorning.name} (Mañana 06:00) y ${tAfternoon.name} (Tarde 13:00)`)
  }

  // Plantilla rápida estándar: Villa (2), Norte (2 con apoyo de Ate), Ate vacía, resto en descanso
  const applyTypicalSundayPreset = () => {
    const villaCampus = campuses.find((c) => c.name.toLowerCase().includes("villa"))
    const norteCampus = campuses.find((c) => c.name.toLowerCase().includes("norte"))

    if (!villaCampus || !norteCampus) {
      toast.warning("No se encontraron las sedes Villa y Norte para aplicar la plantilla.")
      return
    }

    setSundayAssignments((prev) => {
      const next: typeof sundayAssignments = {}
      // Primero todos a descanso
      technicians.forEach((t) => {
        next[t.id] = {
          shift: Shift.DESCANSO,
          campusId: t.campus?.id || campuses[0]?.id || "",
          expectedEntryTime: "00:00",
          notes: "Descanso dominical",
        }
      })

      // Asignar Villa: 1 Mañana + 1 Tarde
      const villaTechs = technicians.filter((t) => t.campus?.id === villaCampus.id)
      const villaM = villaTechs[0] || technicians[0]
      const villaT = villaTechs[1] || technicians[1]
      if (villaM) {
        next[villaM.id] = {
          shift: Shift.MANANA,
          campusId: villaCampus.id,
          expectedEntryTime: "06:00",
          notes: "Guardia Dominical en Campus Villa (Mañana)",
        }
      }
      if (villaT && villaT.id !== villaM?.id) {
        next[villaT.id] = {
          shift: Shift.TARDE,
          campusId: villaCampus.id,
          expectedEntryTime: "13:00",
          notes: "Guardia Dominical en Campus Villa (Tarde)",
        }
      }

      // Asignar Norte: 1 Mañana + 1 Tarde (con apoyo de técnico de Ate si aplica)
      const remainingForNorte = technicians.filter((t) => t.id !== villaM?.id && t.id !== villaT?.id)
      const norteTech = remainingForNorte.find((t) => t.campus?.id === norteCampus.id) || remainingForNorte[0]
      const ateTech = remainingForNorte.find((t) => t.campus?.name.toLowerCase().includes("ate") && t.id !== norteTech?.id) || remainingForNorte.find((t) => t.id !== norteTech?.id)

      if (norteTech) {
        const isSupN = norteTech.campus?.id && norteTech.campus.id !== norteCampus.id
        next[norteTech.id] = {
          shift: Shift.MANANA,
          campusId: norteCampus.id,
          expectedEntryTime: "06:00",
          notes: isSupN 
            ? `Guardia Dominical en Campus Norte (Apoyo desde ${norteTech.campus?.name || "otra sede"})`
            : "Guardia Dominical en Campus Norte (Mañana)",
        }
      }
      if (ateTech && ateTech.id !== norteTech?.id) {
        const isSupA = ateTech.campus?.id && ateTech.campus.id !== norteCampus.id
        next[ateTech.id] = {
          shift: Shift.TARDE,
          campusId: norteCampus.id,
          expectedEntryTime: "13:00",
          notes: isSupA 
            ? `Guardia Dominical en Campus Norte (Apoyo desde ${ateTech.campus?.name || "otra sede"})`
            : "Guardia Dominical en Campus Norte (Tarde)",
        }
      }

      return next
    })

    const newActive: Record<string, boolean> = {}
    campuses.forEach((c) => {
      const isV = c.id === villaCampus.id
      const isN = c.id === norteCampus.id
      newActive[c.id] = isV || isN
    })
    setActiveCampuses(newActive)
    toast.success("✓ Plantilla aplicada: Sede Villa (2 técnicos), Sede Norte (2 técnicos con apoyo de Ate). Sede Ate vacía y resto en descanso.")
  }

  // Poner a todos en descanso
  const applyAllDescanso = () => {
    setSundayAssignments((prev) => {
      const next = { ...prev }
      technicians.forEach((t) => {
        next[t.id] = {
          shift: Shift.DESCANSO,
          campusId: t.campus?.id || campuses[0]?.id || "",
          expectedEntryTime: "00:00",
          notes: "Descanso dominical",
        }
      })
      return next
    })
    const allInactive: Record<string, boolean> = {}
    campuses.forEach((c) => (allInactive[c.id] = false))
    setActiveCampuses(allInactive)
    toast.info("Todos los técnicos configurados en Descanso Dominical.")
  }

  // Activar todas las sedes
  const activateAllCampuses = () => {
    const allActive: Record<string, boolean> = {}
    campuses.forEach((c) => (allActive[c.id] = true))
    setActiveCampuses(allActive)
    toast.info("Todas las sedes marcadas como activas para este domingo.")
  }

  const handleSaveSunday = () => {
    if (!sundayDate) {
      toast.error("Seleccione la fecha del domingo.")
      return
    }

    startSundayTransition(async () => {
      const items: ScheduleItemInput[] = technicians.map((t) => {
        const current = sundayAssignments[t.id]
        const shift = current?.shift || Shift.DESCANSO
        const def = DEFAULT_SHIFT_TIMES[shift] || DEFAULT_SHIFT_TIMES.DESCANSO
        const isResting = shift === Shift.DESCANSO
        const assignedCampusId = current?.campusId || t.campus?.id || campuses[0]?.id || ""
        const campusObj = campuses.find((c) => c.id === assignedCampusId)
        const isSupport = t.campus?.id && t.campus.id !== assignedCampusId

        return {
          userId: t.id,
          date: sundayDate,
          campusId: assignedCampusId,
          shift,
          expectedEntryTime: isResting ? "00:00" : (current?.expectedEntryTime || def.entry),
          earlyEntryToleranceMinutes: isResting ? 0 : def.early,
          gracePeriodMinutes: isResting ? 0 : def.grace,
          lateToleranceMinutes: isResting ? 0 : def.late,
          notes: isResting
            ? "Descanso dominical"
            : (isSupport
                ? `Guardia dominical en ${campusObj?.name || "sede"} (Apoyo desde ${t.campus?.name || "otra sede"})`
                : `Guardia dominical en ${campusObj?.name || "sede"}`),
        }
      })

      const res = await bulkUpsertTechnicianSchedulesAction(items)
      if (res.success) {
        toast.success(`✓ Programación dominical guardada: ${workingCount} técnicos trabajando en ${activeCampusesCount} sede(s), ${restingCount} en descanso.`)
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

  // Vista Previa tipo Rol Mensual / Calendario (dividido por sedes y editable)
  const [isMatrixPreviewOpen, setIsMatrixPreviewOpen] = useState(false)
  const [matrixPreview, setMatrixPreview] = useState<MatrixSchedulePreview | null>(null)
  const [activeCellPopup, setActiveCellPopup] = useState<{ rowId: string; day: number } | null>(null)

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

  // Nombres de sede canónicos
  const canonicalCampusName = (raw: string) => {
    const u = (raw || "").toUpperCase()
    if (u.includes("NORTE")) return "Campus Norte"
    if (u.includes("ATE")) return "Campus Ate"
    if (u.includes("ARAMBUR") || u.includes("MIRAFLORES")) return "Campus Aramburú"
    return "Campus Villa"
  }

  // Parsear contenido de celda de turno y rotación (ej: M, T, I, N, M(N), T(N), M(V), M(A), D, DESC)
  const resolveTokenToCell = (rawToken: any, defaultCampusName: string, isSunday = false): MatrixCell => {
    const str = String(rawToken || "").trim()
    const upper = str.toUpperCase()

    // Feriado o Descanso por Feriado
    if (upper === "F" || upper.startsWith("FERIAD")) {
      return {
        token: "F",
        shift: Shift.DESCANSO,
        campusName: canonicalCampusName(defaultCampusName),
        entryTime: "00:00",
        notes: "Feriado",
      }
    }

    // Comisión de servicio / Evento especial en provincia
    if (upper === "EV" || upper.startsWith("EV") || upper.includes("EVENTO") || upper.includes("COMISION")) {
      return {
        token: "EV",
        shift: Shift.COMISION,
        campusName: canonicalCampusName(defaultCampusName),
        entryTime: "00:00",
        notes: "Comisión de Servicio / Evento Especial en Provincia",
      }
    }

    // Vacaciones
    if (upper.startsWith("VAC")) {
      return {
        token: "VAC",
        shift: Shift.DESCANSO,
        campusName: canonicalCampusName(defaultCampusName),
        entryTime: "00:00",
        notes: "Vacaciones",
      }
    }

    // Descanso explícito o celda vacía
    if (!str || /^(D|DESC|DESCANSO|L|LIBRE)$/i.test(upper)) {
      return {
        token: "D",
        shift: Shift.DESCANSO,
        campusName: canonicalCampusName(defaultCampusName),
        entryTime: "00:00",
        notes: isSunday ? "Descanso dominical" : "Descanso compensatorio semanal",
      }
    }

    // Formato de rotación: LETRA(SEDE), ej: M(N), T(N), I(N), M(V), T(V), M(A)
    const rotMatch = upper.match(/^([MTIN])\s*\(([NVA])\)$/i)
    if (rotMatch) {
      const shiftLetter = rotMatch[1].toUpperCase()
      const campusCode = rotMatch[2].toUpperCase()
      let targetCampus = defaultCampusName
      if (campusCode === "N") targetCampus = "Campus Norte"
      else if (campusCode === "A") targetCampus = "Campus Ate"
      else if (campusCode === "V") targetCampus = "Campus Villa"

      let shift: Shift = Shift.MANANA
      let entryTime = "06:00"
      if (shiftLetter === "T") {
        shift = isSunday ? Shift.INTERMEDIO : Shift.TARDE
        entryTime = isSunday ? "09:00" : "13:00"
      } else if (shiftLetter === "I") {
        shift = Shift.INTERMEDIO
        entryTime = "08:00"
      } else if (shiftLetter === "N") {
        shift = Shift.NOCHE
        entryTime = "19:00"
      }

      return {
        token: `${shiftLetter}(${campusCode})`,
        shift,
        campusName: canonicalCampusName(targetCampus),
        entryTime,
        notes: `Rotación a ${canonicalCampusName(targetCampus)}`,
      }
    }

    // Turno simple sin rotación: M, T, I, N
    const singleMatch = upper.match(/^([MTIN])/i)
    if (singleMatch) {
      const shiftLetter = singleMatch[1].toUpperCase()
      let shift: Shift = Shift.MANANA
      let entryTime = "06:00"

      if (shiftLetter === "T") {
        shift = isSunday ? Shift.INTERMEDIO : Shift.TARDE
        entryTime = isSunday ? "09:00" : "13:00"
      } else if (shiftLetter === "I") {
        shift = Shift.INTERMEDIO
        entryTime = "08:00"
      } else if (shiftLetter === "N") {
        shift = Shift.NOCHE
        entryTime = "19:00"
      }

      return {
        token: shiftLetter,
        shift,
        campusName: canonicalCampusName(defaultCampusName),
        entryTime,
        notes: isSunday ? `Guardia dominical (${shift})` : `Turno ${shift}`,
      }
    }

    // Fallback estándar
    return {
      token: upper,
      shift: Shift.MANANA,
      campusName: canonicalCampusName(defaultCampusName),
      entryTime: "06:00",
      notes: "Turno regular",
    }
  }

  // Compatibilidad con funciones previas
  const parseShiftCell = (cellVal: any, defaultCampusName: string, isSunday = false) => {
    if (!cellVal) return null
    const cell = resolveTokenToCell(cellVal, defaultCampusName, isSunday)
    return {
      shift: cell.shift,
      campusName: cell.campusName,
    }
  }

  // Construir objeto MatrixSchedulePreview
  const buildMatrixPreviewStructure = (year: number, month: number, rows: MatrixRow[]): MatrixSchedulePreview => {
    const daysInMonth = new Date(year, month, 0).getDate()
    const monthNames = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ]
    const dayLetters = ["D", "L", "Ma", "Mi", "J", "V", "S"]

    const daysMeta = []
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month - 1, d)
      const dayOfWeek = dateObj.getDay()
      const isSunday = dayOfWeek === 0
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      daysMeta.push({
        dayNumber: d,
        dayLetter: dayLetters[dayOfWeek],
        isSunday,
        dateStr,
      })
    }

    const sedes = ["Campus Villa", "Campus Norte", "Campus Ate", "Campus Aramburú"]

    return {
      year,
      month,
      monthLabel: `${monthNames[month - 1].toUpperCase()} ${year}`,
      daysInMonth,
      daysMeta,
      sedes,
      rows,
    }
  }

  // Mutaciones de celda y filas en la matriz interactiva
  const updateMatrixCell = (rowId: string, day: number, newToken: string) => {
    if (!matrixPreview) return
    const meta = matrixPreview.daysMeta.find((m) => m.dayNumber === day)
    const isSunday = meta?.isSunday || false

    setMatrixPreview((prev) => {
      if (!prev) return null
      const updatedRows = prev.rows.map((r) => {
        if (r.rowId !== rowId) return r
        const updatedDays = { ...r.days }
        updatedDays[day] = resolveTokenToCell(newToken, r.campusName, isSunday)
        return {
          ...r,
          days: updatedDays,
        }
      })
      return {
        ...prev,
        rows: updatedRows,
      }
    })
  }

  const updateRowCampus = (rowId: string, newCampusName: string) => {
    if (!matrixPreview) return
    setMatrixPreview((prev) => {
      if (!prev) return null
      const updatedRows = prev.rows.map((r) => {
        if (r.rowId !== rowId) return r
        return {
          ...r,
          campusName: canonicalCampusName(newCampusName),
        }
      })
      return {
        ...prev,
        rows: updatedRows,
      }
    })
  }

  const updateRowTech = (rowId: string, newTechId: string) => {
    if (!matrixPreview) return
    const techObj = technicians.find((t) => t.id === newTechId)
    if (!techObj) return

    setMatrixPreview((prev) => {
      if (!prev) return null
      const updatedRows = prev.rows.map((r) => {
        if (r.rowId !== rowId) return r
        return {
          ...r,
          techId: techObj.id,
          name: techObj.name,
          dni: techObj.dni,
        }
      })
      return {
        ...prev,
        rows: updatedRows,
      }
    })
  }

  const deleteMatrixRow = (rowId: string) => {
    if (!matrixPreview) return
    setMatrixPreview((prev) => {
      if (!prev) return null
      return {
        ...prev,
        rows: prev.rows.filter((r) => r.rowId !== rowId),
      }
    })
    toast.success("Fila eliminada de la vista previa.")
  }

  const addMatrixRowToCampus = (campusName: string) => {
    if (!matrixPreview) return
    // Escoger un técnico no asignado aún o el primero
    const usedTechIds = new Set(matrixPreview.rows.map((r) => r.techId).filter(Boolean))
    const availableTech = technicians.find((t) => !usedTechIds.has(t.id)) || technicians[0]

    const newRowId = `row-added-${Date.now()}`
    const defaultDays: Record<number, MatrixCell> = {}
    for (let d = 1; d <= matrixPreview.daysInMonth; d++) {
      const meta = matrixPreview.daysMeta.find((m) => m.dayNumber === d)
      const isSunday = meta?.isSunday || false
      defaultDays[d] = resolveTokenToCell(isSunday ? "D" : "M", campusName, isSunday)
    }

    const newRow: MatrixRow = {
      rowId: newRowId,
      techId: availableTech?.id,
      name: availableTech?.name || "Nuevo Técnico",
      dni: availableTech?.dni || "",
      campusName: canonicalCampusName(campusName),
      days: defaultDays,
    }

    setMatrixPreview((prev) => {
      if (!prev) return null
      return {
        ...prev,
        rows: [...prev.rows, newRow],
      }
    })
    toast.success(`Técnico añadido a ${campusName}.`)
  }

  // Funciones de navegación de meses (formato YYYY-MM)
  const getNextMonth = (curMonth: string) => {
    const [year, month] = (curMonth || "").split("-").map(Number)
    if (!year || !month) {
      const now = new Date()
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    }
    const nextDate = new Date(year, month, 1)
    return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`
  }

  const getPrevMonth = (curMonth: string) => {
    const [year, month] = (curMonth || "").split("-").map(Number)
    if (!year || !month) {
      const now = new Date()
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
    }
    const prevDate = new Date(year, month - 2, 1)
    return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`
  }

  // Abrir vista previa del mes consultado en base de datos
  const openCurrentMonthMatrix = async (targetMonth?: string) => {
    const target = targetMonth || selectedMonth || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
    let y = new Date().getFullYear()
    let m = new Date().getMonth() + 1
    const parts = target.split("-")
    if (parts.length === 2) {
      y = parseInt(parts[0], 10)
      m = parseInt(parts[1], 10)
    }

    // Traer datos frescos del mes directamente desde la base de datos
    let monthRecords: ScheduleRecord[] = schedules.filter((s) => s.date.startsWith(target))
    try {
      const res = await getTechnicianSchedulesAction({ month: target })
      if (res.success && res.schedules && res.schedules.length > 0) {
        monthRecords = res.schedules as any
        setSchedules((prev) => {
          const others = prev.filter((s) => !s.date.startsWith(target))
          return [...others, ...(res.schedules as any)]
        })
      }
    } catch (e) {
      console.warn("No se pudo refrescar cronograma del servidor para la matriz, usando datos locales:", e)
    }

    const daysInMonth = new Date(y, m, 0).getDate()
    const rows: MatrixRow[] = []

    technicians.forEach((t) => {
      const techCampus = t.campus?.name ? canonicalCampusName(t.campus.name) : "Campus Villa"
      const rowObj: MatrixRow = {
        rowId: `live-${t.id}`,
        techId: t.id,
        name: t.name,
        dni: t.dni,
        campusName: techCampus,
        days: {},
      }

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
        const dateObj = new Date(y, m - 1, d)
        const isSunday = dateObj.getDay() === 0

        const existing = monthRecords.find((s) => s.userId === t.id && s.date === dateStr)
        if (existing) {
          let token = "M"
          if (existing.shift === Shift.MANANA) token = "M"
          else if (existing.shift === Shift.TARDE) token = "T"
          else if (existing.shift === Shift.INTERMEDIO) token = "I"
          else if (existing.shift === Shift.NOCHE) token = "N"
          else if (existing.shift === Shift.DESCANSO) token = "D"
          else if (existing.shift === Shift.COMISION) token = "EV"

          const schedCampus = existing.campus?.name ? canonicalCampusName(existing.campus.name) : techCampus
          if (existing.shift !== Shift.COMISION && schedCampus !== techCampus) {
            let code = "V"
            if (schedCampus.includes("Norte")) code = "N"
            else if (schedCampus.includes("Ate")) code = "A"
            else if (schedCampus.includes("Villa")) code = "V"
            token = `${token}(${code})`
          }

          rowObj.days[d] = {
            token,
            shift: existing.shift,
            campusName: schedCampus,
            entryTime: existing.expectedEntryTime || (DEFAULT_SHIFT_TIMES[existing.shift]?.entry || "06:00"),
            notes: existing.notes || "",
          }
        } else {
          rowObj.days[d] = resolveTokenToCell(isSunday ? "D" : (t.defaultShift || "M"), techCampus, isSunday)
        }
      }

      rows.push(rowObj)
    })

    const preview = buildMatrixPreviewStructure(y, m, rows)
    setMatrixPreview(preview)
    setIsMatrixPreviewOpen(true)
  }

  const handleChangeMatrixMonth = async (newMonth: string) => {
    if (!newMonth) return
    setSelectedMonth(newMonth)
    await openCurrentMonthMatrix(newMonth)
  }

  // Guardar definitivamente la Matriz de Cronograma Mensual
  const handleSaveMatrixPreview = async () => {
    if (!matrixPreview || matrixPreview.rows.length === 0) {
      toast.warning("No hay turnos para guardar.")
      return
    }

    startTransition(async () => {
      const itemsToSave: ScheduleItemInput[] = []

      matrixPreview.rows.forEach((row) => {
        for (let d = 1; d <= matrixPreview.daysInMonth; d++) {
          const cell = row.days[d]
          if (!cell) continue

          const dateStr = `${matrixPreview.year}-${String(matrixPreview.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
          itemsToSave.push({
            dni: row.dni,
            name: row.name,
            date: dateStr,
            campusName: cell.campusName,
            shift: cell.shift,
            expectedEntryTime: cell.entryTime,
            notes: cell.notes || (cell.shift === Shift.DESCANSO ? "Descanso" : "Rol mensual programado"),
          })
        }
      })

      const res = await bulkUpsertTechnicianSchedulesAction(itemsToSave)
      if (res.success) {
        toast.success(`¡Rol oficial de ${matrixPreview.monthLabel} guardado con éxito! (${itemsToSave.length} turnos registrados).`)
        setIsMatrixPreviewOpen(false)
        setMatrixPreview(null)
        window.location.reload()
      } else {
        toast.error(res.message)
      }
    })
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
          const matrixRows: MatrixRow[] = []
          const daysInMonth = new Date(refYear, refMonth, 0).getDate()

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
            } else if (upperLine.includes("ARAMBUR") || upperLine.includes("MIRAFLORES")) {
              currentCampus = "Campus Aramburú"
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

            const rowDays: Record<number, MatrixCell> = {}

            // Recorrer las columnas de los días
            for (let d = 1; d <= daysInMonth; d++) {
              const colObj = dayColMap.find((x) => x.day === d)
              const cellVal = colObj ? row[colObj.col] : ""
              const dateStr = `${refYear}-${String(refMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`
              const dObj = new Date(`${dateStr}T12:00:00Z`)
              const isSunday = dObj.getUTCDay() === 0

              rowDays[d] = resolveTokenToCell(cellVal, currentCampus, isSunday)
            }

            matrixRows.push({
              rowId: `excel-row-${r}-${tech.id || Math.random()}`,
              techId: tech.id,
              name: tech.name,
              dni: tech.dni,
              campusName: currentCampus,
              days: rowDays,
            })
          }

          const preview = buildMatrixPreviewStructure(refYear, refMonth, matrixRows)
          setMatrixPreview(preview)
          setIsBulkOpen(false)
          setIsMatrixPreviewOpen(true)
          toast.success(`¡Rol mensual de ${preview.monthLabel} detectado! Se abrió la vista previa tipo calendario por sedes para revisar o editar.`)
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

          const dObj = rawDate ? new Date(`${rawDate}T12:00:00Z`) : null
          const isSunday = dObj ? dObj.getUTCDay() === 0 : false

          let shiftVal: Shift = Shift.MANANA
          const sText = getVal(["turno", "shift", "horario"]).toUpperCase()
          if (sText.includes("EV") || sText.includes("EVENTO") || sText.includes("COMISION")) {
            shiftVal = Shift.COMISION
          } else if (sText.includes("DESC") || sText.includes("LIBRE") || sText === "D" || sText === "L") {
            shiftVal = Shift.DESCANSO
          } else if (sText.includes("TARDE") || sText === "T") {
            shiftVal = isSunday ? Shift.INTERMEDIO : Shift.TARDE
          } else if (sText.includes("INTER") || sText.includes("MED") || sText === "I") {
            shiftVal = Shift.INTERMEDIO
          } else if (sText.includes("NOCHE") || sText === "N") {
            shiftVal = Shift.NOCHE
          }

          let entryTime = getVal(["entrada", "hora", "ingreso", "hora_entrada"])
          if (!entryTime) {
            if (shiftVal === Shift.DESCANSO || shiftVal === Shift.COMISION) entryTime = "00:00"
            else if (isSunday && shiftVal === Shift.INTERMEDIO) entryTime = "09:00"
            else entryTime = DEFAULT_SHIFT_TIMES[shiftVal]?.entry || "06:00"
          }

          let notes = getVal(["notas", "observacion", "observaciones", "notes"])
          if (!notes) {
            if (shiftVal === Shift.COMISION) {
              notes = "Comisión de Servicio / Evento Especial en Provincia"
            } else if (shiftVal === Shift.DESCANSO) {
              notes = isSunday ? "Descanso dominical" : "Descanso compensatorio semanal"
            } else if (isSunday) {
              notes = `Guardia dominical (${shiftVal})`
            }
          }

          return {
            dni: getVal(["dni", "documento", "id"]),
            name: getVal(["nombre", "tecnico", "técnico", "nombres", "name"]),
            date: rawDate,
            campusName: canonicalCampusName(getVal(["sede", "campus", "local"])),
            shift: shiftVal,
            expectedEntryTime: entryTime,
            notes,
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

  // Guardar Lote Excel tabular tradicional
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
    const matrixRows: MatrixRow[] = []
    const daysInMonth = new Date(refYear, refMonth, 0).getDate()

    for (const line of lines) {
      const upperLine = line.toUpperCase()

      // Detección de sección de sede
      if (upperLine.includes("SEDE VILLA") || upperLine.includes("VILLA")) {
        currentCampus = "Campus Villa"
      } else if (upperLine.includes("SEDE NORTE") || upperLine.includes("NORTE")) {
        currentCampus = "Campus Norte"
      } else if (upperLine.includes("SEDE ATE") || upperLine.includes("ATE")) {
        currentCampus = "Campus Ate"
      } else if (upperLine.includes("ARAMBUR") || upperLine.includes("MIRAFLORES")) {
        currentCampus = "Campus Aramburú"
      }

      // Buscar si la línea corresponde a un técnico
      const matchedTech = matchTechFromText(line)
      if (matchedTech) {
        // Extraer los turnos y rotaciones en la línea (ej: EV, M, T, I, N, M(N), T(N), M(V), D, L)
        const tokens = line.match(/(EV\b|EV\s*\([^)]*\)|[MTIN]\s*\([NVA]\)|[MTINDL]|VAC|FER)/gi) || []
        const rowDays: Record<number, MatrixCell> = {}

        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${refYear}-${String(refMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`
          const dObj = new Date(`${dateStr}T12:00:00Z`)
          const isSunday = dObj.getUTCDay() === 0

          const cellToken = tokens[d - 1] || ""
          rowDays[d] = resolveTokenToCell(cellToken, currentCampus, isSunday)

          if (cellToken) {
            const parsed = rowDays[d]
            detectedRows.push({
              name: matchedTech.name,
              dni: matchedTech.dni || "",
              date: dateStr,
              campusName: parsed.campusName,
              shift: parsed.shift,
              entryTime: parsed.entryTime,
            })
          }
        }

        matrixRows.push({
          rowId: `ocr-row-${matchedTech.id || matrixRows.length}`,
          techId: matchedTech.id,
          name: matchedTech.name,
          dni: matchedTech.dni || "",
          campusName: currentCampus,
          days: rowDays,
        })
      }
    }

    setOcrParsedRows(detectedRows)
    if (matrixRows.length > 0) {
      const preview = buildMatrixPreviewStructure(refYear, refMonth, matrixRows)
      setMatrixPreview(preview)
      setIsOcrOpen(false)
      setIsMatrixPreviewOpen(true)
      toast.success(`¡Rol reconocido por OCR (${preview.monthLabel})! Puedes revisar la vista previa tipo calendario y editar cualquier celda antes de guardar.`)
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
            onClick={() => openCurrentMonthMatrix()}
            className="h-12 px-5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-extrabold rounded-xl shadow-md shadow-teal-600/20 flex items-center gap-2 transition-all hover:scale-105"
          >
            <CalendarDays size={18} />
            Vista Rol Mensual (Calendario)
          </Button>

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
                          s.shift === Shift.COMISION
                            ? "bg-violet-100 text-violet-900 border border-violet-400"
                            : s.shift === Shift.DESCANSO
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : s.shift === Shift.MANANA 
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : s.shift === Shift.INTERMEDIO
                            ? "bg-cyan-50 text-cyan-700 border border-cyan-200"
                            : "bg-purple-50 text-purple-700 border border-purple-200"
                        }`}>
                          {s.shift === Shift.COMISION ? "✈️ EV (EVENTO)" : s.shift === Shift.DESCANSO ? "🏖️ DESCANSO" : s.shift}
                        </span>
                      </TableCell>
                      <TableCell className="font-black text-slate-800 text-sm">
                        {s.shift === Shift.COMISION ? (
                          <span className="text-violet-700 text-xs font-bold">Comisión / Evento</span>
                        ) : s.shift === Shift.DESCANSO ? (
                          <span className="text-emerald-600 text-xs font-bold">Día Libre</span>
                        ) : (
                          `⏰ ${s.expectedEntryTime}`
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 font-medium">
                        {s.shift === Shift.COMISION || s.shift === Shift.DESCANSO ? (
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[
                { key: Shift.MANANA, label: "Mañana (06:00)", color: "border-amber-400 bg-amber-50" },
                { key: Shift.INTERMEDIO, label: "Intermedio (09:00)", color: "border-cyan-400 bg-cyan-50" },
                { key: Shift.TARDE, label: "Tarde (13:00)", color: "border-purple-400 bg-purple-50" },
                { key: Shift.DESCANSO, label: "🏖️ Descanso (Libre)", color: "border-emerald-400 bg-emerald-50 text-emerald-800" },
                { key: Shift.COMISION, label: "✈️ EV (Comisión/Evento)", color: "border-violet-400 bg-violet-50 text-violet-900" },
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
                            <option value={Shift.COMISION}>EV (COMISIÓN / EVENTO)</option>
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

      {/* MODAL GESTOR DE DOMINGOS POR SEDES */}
      <ScheduleModal
        isOpen={isSundayModalOpen}
        onClose={() => setIsSundayModalOpen(false)}
        title="Programación de Sedes y Rotaciones Dominicales"
        maxWidth="max-w-6xl"
      >
        <div className="space-y-6">
          {/* Banner explicativo multisede */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50 via-indigo-50/60 to-sky-50 border border-blue-200/80 flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-[#1967D2] text-white shrink-0 mt-0.5 shadow-sm">
              <Sun size={20} />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-black text-[#0B1B3D] flex items-center gap-2">
                <span>Configuración de Sedes con Actividad y Rotación de Personal</span>
              </h4>
              <p className="text-xs font-medium text-slate-700 leading-relaxed">
                Elige qué sedes tendrán actividad este domingo y qué técnicos estarán a cargo en cada turno (Mañana, Intermedio o Tarde). Puedes asignar técnicos de cualquier sede para brindar apoyo en otra sede (por ejemplo: personal de Sede Ate apoyando en Norte o Villa) y el sistema les permitirá registrar su asistencia sin inconvenientes. <strong>Los técnicos no asignados pasarán automáticamente a su DÍA DE DESCANSO.</strong>
              </p>
            </div>
          </div>

          {/* Selector de Fecha del Domingo y Contadores */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
            <div className="flex-1">
              <label className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-1.5 flex items-center gap-1.5">
                <CalendarDays size={16} className="text-[#1967D2]" /> Fecha del Domingo a Programar
              </label>
              <select
                value={sundayDate}
                onChange={(e) => openSundayManager(e.target.value)}
                className="w-full h-11 bg-white border border-slate-200 font-extrabold text-slate-800 rounded-xl px-3 outline-none focus:ring-2 focus:ring-[#1967D2] text-sm shadow-xs"
              >
                {sundaysList.map((sun) => (
                  <option key={sun.date} value={sun.date}>
                    {sun.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1 lg:pt-4">
              <div className="px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 font-black text-xs flex items-center gap-1.5 shadow-xs">
                <Building2 size={14} className="text-[#1967D2]" />
                <span>{activeCampusesCount} Sede(s) Activas</span>
              </div>
              <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-black text-xs flex items-center gap-1.5 shadow-xs">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>{workingCount} Trabajando</span>
              </div>
              <div className="px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5">
                <span>🏖️</span>
                <span>{restingCount} en Descanso</span>
              </div>
            </div>
          </div>

          {/* Barra de Acciones Rápidas y Plantillas */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 px-1">
            <span className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Sparkles size={14} className="text-amber-500" /> Plantillas y Acciones Rápidas:
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={applyTypicalSundayPreset}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs h-9 px-3.5 rounded-xl shadow-xs flex items-center gap-1.5"
                title="Configura Villa (2 técnicos) y Norte (2 técnicos con apoyo de Ate). Sede Ate vacía y resto a descanso"
              >
                <Zap size={14} />
                Plantilla Típica (Villa 2, Norte 2 c/ apoyo Ate, Ate vacía)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={activateAllCampuses}
                className="bg-white border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs h-9 px-3 rounded-xl flex items-center gap-1"
              >
                <Building2 size={13} />
                Activar Todas las Sedes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={applyAllDescanso}
                className="bg-white border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs h-9 px-3 rounded-xl flex items-center gap-1"
              >
                <span>🏖️</span>
                Todos a Descanso
              </Button>
            </div>
          </div>

          {/* TARJETAS DE SEDES: CONFIGURACIÓN Y ASIGNACIÓN DE TÉCNICOS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {campuses.map((campus) => {
              const isCampusActive = activeCampuses[campus.id] ?? false
              // Técnicos asignados a trabajar en esta sede este domingo
              const assignedTechs = technicians.filter(
                (t) => sundayAssignments[t.id]?.campusId === campus.id && sundayAssignments[t.id]?.shift !== Shift.DESCANSO
              )

              return (
                <div
                  key={campus.id}
                  className={`rounded-2xl border-2 transition-all p-4 flex flex-col justify-between ${
                    isCampusActive
                      ? "bg-white border-blue-200 shadow-md shadow-blue-500/5 ring-1 ring-blue-100"
                      : "bg-slate-50/70 border-slate-200/80 opacity-85"
                  }`}
                >
                  <div className="space-y-3">
                    {/* Encabezado de la Sede */}
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className={`p-2 rounded-xl text-white font-black shrink-0 ${
                          isCampusActive ? "bg-[#1967D2]" : "bg-slate-400"
                        }`}>
                          <Building2 size={16} />
                        </div>
                        <div>
                          <h4 className="font-black text-sm text-slate-900 leading-tight">
                            {campus.name}
                          </h4>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            {isCampusActive
                              ? `${assignedTechs.length} ${assignedTechs.length === 1 ? "técnico asignado" : "técnicos asignados"}`
                              : "Sin actividad este domingo"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleCampusActivity(campus.id)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 border ${
                            isCampusActive
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                              : "bg-white text-slate-600 border-slate-200 hover:bg-blue-50 hover:text-[#1967D2] hover:border-blue-200 shadow-xs"
                          }`}
                          title={isCampusActive ? "Clic para marcar esta sede sin actividad (vacía)" : "Clic para activar esta sede"}
                        >
                          {isCampusActive ? (
                            <>
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                              <span>Activa</span>
                            </>
                          ) : (
                            <>
                              <span>⚪</span>
                              <span>Activar Sede</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Contenido cuando la sede está activa */}
                    {isCampusActive ? (
                      <div className="space-y-2.5">
                        {assignedTechs.length === 0 ? (
                          <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/60 text-amber-900 text-xs font-medium space-y-1">
                            <p className="font-extrabold flex items-center gap-1.5 text-amber-950">
                              <AlertCircle size={14} className="text-amber-600 shrink-0" />
                              Sede activa sin técnicos asignados
                            </p>
                            <p className="text-[11px] text-amber-800">
                              Haz clic en <strong>"+ Asignar Técnico"</strong> o en <strong>"1 Mañana + 1 Tarde"</strong> para designar al personal de guardia.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {assignedTechs.map((t, idx) => {
                              const assignInfo = sundayAssignments[t.id]
                              const isSupport = t.campus?.id && t.campus.id !== campus.id

                              return (
                                <div
                                  key={t.id}
                                  className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col gap-2 transition-all hover:bg-slate-100/60"
                                >
                                  {/* Fila Selección de Técnico */}
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <span className="text-[10px] font-black uppercase text-slate-500">
                                          Técnico #{idx + 1}
                                        </span>
                                        {isSupport && (
                                          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-md bg-amber-100 text-amber-900 text-[10px] font-black border border-amber-300">
                                            <ArrowRightLeft size={10} />
                                            Apoyo desde {t.campus?.name}
                                          </span>
                                        )}
                                      </div>

                                      <select
                                        value={t.id}
                                        onChange={(e) => replaceTechInCampus(t.id, e.target.value, campus.id)}
                                        className="w-full h-9 bg-white border border-slate-200 font-extrabold text-xs text-slate-800 rounded-lg px-2 outline-none focus:ring-2 focus:ring-[#1967D2]"
                                      >
                                        <optgroup label={`Personal habitual de ${campus.name}`}>
                                          {technicians
                                            .filter((tech) => tech.campus?.id === campus.id)
                                            .map((tech) => {
                                              const otherAssign = sundayAssignments[tech.id]
                                              const isWorkingElsewhere =
                                                otherAssign?.shift !== Shift.DESCANSO &&
                                                otherAssign?.campusId !== campus.id
                                              return (
                                                <option key={tech.id} value={tech.id}>
                                                  {tech.name} (Habitual: {tech.defaultShift || "Sin turno"})
                                                  {isWorkingElsewhere ? " [Asignado en otra sede]" : ""}
                                                </option>
                                              )
                                            })}
                                        </optgroup>
                                        <optgroup label="Personal de Otras Sedes (Apoyo / Rotación)">
                                          {technicians
                                            .filter((tech) => tech.campus?.id !== campus.id)
                                            .map((tech) => {
                                              const otherAssign = sundayAssignments[tech.id]
                                              const isWorkingElsewhere =
                                                otherAssign?.shift !== Shift.DESCANSO &&
                                                otherAssign?.campusId !== campus.id
                                              return (
                                                <option key={tech.id} value={tech.id}>
                                                  {tech.name} (Base: {tech.campus?.name || "Sin sede"})
                                                  {isWorkingElsewhere ? " [Asignado en otra sede]" : ""}
                                                </option>
                                              )
                                            })}
                                        </optgroup>
                                      </select>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => unassignTech(t.id)}
                                      className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors self-end"
                                      title="Quitar técnico de esta sede (pasa a descanso)"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </div>

                                  {/* Fila Selección de Turno y Horario */}
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {[
                                      { shift: Shift.MANANA, label: "Mañana", entry: "06:00", icon: "🌅" },
                                      { shift: Shift.INTERMEDIO, label: "Interm. 9 AM", entry: "09:00", icon: "⛅" },
                                      { shift: Shift.INTERMEDIO, label: "Interm. 10 AM", entry: "10:00", icon: "⛅" },
                                      { shift: Shift.TARDE, label: "Tarde", entry: "13:00", icon: "🌆" },
                                    ].map((opt, sIdx) => {
                                      const isSel =
                                        assignInfo.shift === opt.shift && assignInfo.expectedEntryTime === opt.entry
                                      return (
                                        <button
                                          key={`${opt.shift}-${opt.entry}-${sIdx}`}
                                          type="button"
                                          onClick={() => assignTechToCampus(t.id, campus.id, opt.shift, opt.entry)}
                                          className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1 ${
                                            isSel
                                              ? "bg-[#1967D2] text-white border-[#1967D2] shadow-xs font-black ring-1 ring-blue-300 scale-105"
                                              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                                          }`}
                                        >
                                          <span>{opt.icon}</span>
                                          <span>{opt.label}</span>
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Vista cuando la sede está vacía / sin actividad */
                      <div className="p-4 rounded-xl bg-slate-100/80 border border-dashed border-slate-200 text-center space-y-1.5">
                        <p className="text-xs font-black text-slate-600">
                          Sede Vacía / Sin Actividad este Domingo
                        </p>
                        <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                          No se requiere personal en esta sede. Sus técnicos habituales descansarán o podrán apoyar en las sedes activas si son seleccionados.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Acciones de la Tarjeta al pie */}
                  {isCampusActive && (
                    <div className="flex flex-wrap items-center gap-2 pt-3 mt-3 border-t border-slate-100">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          // Buscar primer técnico disponible en descanso
                          const availableTech = technicians.find(
                            (tech) => !sundayAssignments[tech.id] || sundayAssignments[tech.id].shift === Shift.DESCANSO
                          )
                          if (!availableTech) {
                            toast.warning("Todos los técnicos ya están asignados a una sede.")
                            return
                          }
                          assignTechToCampus(availableTech.id, campus.id, Shift.MANANA, "06:00")
                        }}
                        className="bg-white border-blue-200 hover:bg-blue-50 text-[#1967D2] font-black text-xs h-8 px-2.5 rounded-lg flex items-center gap-1 shadow-xs"
                      >
                        <Plus size={13} /> Asignar Técnico
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => quickAssignMorningAndAfternoon(campus.id)}
                        className="text-[11px] font-extrabold text-blue-800 hover:bg-blue-100/60 h-8 px-2.5 rounded-lg flex items-center gap-1"
                        title="Asigna 1 técnico a la Mañana (06:00) y 1 técnico a la Tarde (13:00)"
                      >
                        <Zap size={12} className="text-amber-500" /> 1 Mañana + 1 Tarde
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* RESUMEN DE PERSONAL EN DESCANSO DOMINICAL */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <span>🏖️</span> Personal que pasa a DÍA DE DESCANSO este Domingo ({restingCount})
              </span>
              <span className="text-[11px] font-medium text-slate-500">
                Los no seleccionados pasan automáticamente a descanso
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {technicians
                .filter((t) => !sundayAssignments[t.id] || sundayAssignments[t.id].shift === Shift.DESCANSO)
                .map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-white text-slate-700 border border-slate-200 shadow-xs"
                  >
                    <span>🏖️</span>
                    <span>{t.name}</span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      ({t.campus?.name || "Sin sede"})
                    </span>
                  </span>
                ))}
              {restingCount === 0 && (
                <span className="text-xs text-slate-400 italic">
                  Todos los técnicos tienen guardia asignada para este domingo.
                </span>
              )}
            </div>
          </div>

          {/* TABLA TÉCNICO POR TÉCNICO (DETALLE GENERAL Y REAJUSTES RÁPIDOS) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-black uppercase tracking-wider text-slate-600">
                Detalle General de Asignación por Técnico
              </span>
              <span className="text-[11px] text-slate-400 font-medium">
                Puedes ajustar turnos y sedes individualmente en cualquier momento
              </span>
            </div>

            <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-xs">
              <div className="max-h-[340px] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-3 px-3">Técnico</th>
                      <th className="py-3 px-3">Sede Base</th>
                      <th className="py-3 px-3">Turno Dominical Asignado</th>
                      <th className="py-3 px-3">Sede de Asignación</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {technicians.map((t) => {
                      const current = sundayAssignments[t.id] || {
                        shift: Shift.DESCANSO,
                        campusId: t.campus?.id || campuses[0]?.id || "",
                        expectedEntryTime: "00:00",
                        notes: "Descanso dominical",
                      }
                      const isResting = current.shift === Shift.DESCANSO
                      const isSupport = !isResting && t.campus?.id && t.campus.id !== current.campusId
                      const assignedCampusObj = campuses.find((c) => c.id === current.campusId)

                      return (
                        <tr 
                          key={t.id} 
                          className={`transition-colors ${
                            !isResting ? "bg-blue-50/30 hover:bg-blue-50/50" : "hover:bg-slate-50/80"
                          }`}
                        >
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2.5">
                              <div className={`w-8 h-8 rounded-full font-black text-xs flex items-center justify-center shrink-0 ${
                                !isResting
                                  ? "bg-gradient-to-tr from-[#1967D2] to-indigo-600 text-white shadow-xs"
                                  : "bg-slate-200 text-slate-600"
                              }`}>
                                {t.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                              </div>
                              <div>
                                <p className="font-extrabold text-xs text-slate-800 leading-snug">{t.name}</p>
                                <p className="text-[10px] text-slate-400 font-mono">DNI: {t.dni}</p>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-3">
                            <span className="text-xs font-bold text-slate-700">
                              {t.campus?.name || "Sin sede asignada"}
                            </span>
                          </td>

                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1 flex-wrap">
                              {[
                                { shift: Shift.MANANA, label: "Mañana", entry: "06:00", icon: "🌅" },
                                { shift: Shift.INTERMEDIO, label: "Interm. 9 AM", entry: "09:00", icon: "⛅" },
                                { shift: Shift.INTERMEDIO, label: "Interm. 10 AM", entry: "10:00", icon: "⛅" },
                                { shift: Shift.TARDE, label: "Tarde", entry: "13:00", icon: "🌆" },
                                { shift: Shift.DESCANSO, label: "Descanso", entry: "00:00", icon: "🏖️" },
                              ].map((opt, idx) => {
                                const isSelected = current.shift === opt.shift && current.expectedEntryTime === opt.entry
                                return (
                                  <button
                                    key={`${opt.shift}-${opt.entry}-${idx}`}
                                    type="button"
                                    onClick={() => {
                                      const isNowResting = opt.shift === Shift.DESCANSO
                                      setSundayAssignments((prev) => ({
                                        ...prev,
                                        [t.id]: {
                                          ...current,
                                          shift: opt.shift,
                                          expectedEntryTime: opt.entry,
                                          notes: isNowResting
                                            ? "Descanso dominical" 
                                            : `Guardia especial de Domingo (${opt.label})`,
                                        },
                                      }))
                                      if (!isNowResting && current.campusId) {
                                        setActiveCampuses((prev) => ({ ...prev, [current.campusId]: true }))
                                      }
                                    }}
                                    className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1 ${
                                      isSelected
                                        ? opt.shift === Shift.DESCANSO
                                          ? "bg-slate-700 text-white border-slate-700 shadow-xs font-black scale-105"
                                          : "bg-[#1967D2] text-white border-[#1967D2] shadow-xs ring-1 ring-blue-300 font-black scale-105"
                                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                                    }`}
                                  >
                                    <span>{opt.icon}</span>
                                    <span>{opt.label}</span>
                                  </button>
                                )
                              })}
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              {isResting ? (
                                <span className="text-[9px] font-extrabold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1 border border-slate-200">
                                  <span>🏖️</span> En Descanso Dominical
                                </span>
                              ) : (
                                <span className="text-[9px] font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full inline-flex items-center gap-1 border border-emerald-200">
                                  <span>🟢</span> Asignado: {current.shift} ({current.expectedEntryTime}) en {assignedCampusObj?.name}
                                </span>
                              )}
                              {isSupport && (
                                <span className="text-[9px] font-black text-amber-900 bg-amber-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1 border border-amber-300">
                                  <ArrowRightLeft size={9} /> Apoyo desde {t.campus?.name}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-3">
                            <select
                              value={current.campusId}
                              disabled={isResting}
                              onChange={(e) => {
                                const newCampusId = e.target.value
                                setSundayAssignments((prev) => ({
                                  ...prev,
                                  [t.id]: {
                                    ...current,
                                    campusId: newCampusId,
                                  },
                                }))
                                setActiveCampuses((prev) => ({ ...prev, [newCampusId]: true }))
                              }}
                              className={`h-8 text-xs font-bold bg-white border border-slate-200 rounded-lg px-2 text-slate-700 outline-none focus:ring-1 focus:ring-blue-500 ${
                                isResting ? "opacity-50 cursor-not-allowed" : ""
                              }`}
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
                `Guardar Programación Dominical (${workingCount} trabajando en ${activeCampusesCount} sedes, ${restingCount} en descanso)`
              )}
            </Button>
          </div>
        </div>
      </ScheduleModal>

      {/* MODAL VISTA PREVIA / EDITOR TIPO CALENDARIO POR SEDES */}
      <ScheduleModal
        isOpen={isMatrixPreviewOpen}
        onClose={() => {
          setIsMatrixPreviewOpen(false)
          setActiveCellPopup(null)
        }}
        title={`Vista Previa del Rol Mensual — ${matrixPreview?.monthLabel || ""}`}
        maxWidth="max-w-[98vw]"
      >
        {matrixPreview && (
          <div className="space-y-4 max-h-[85vh] flex flex-col">
            {/* Header del Rol Institucional */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-900 text-white rounded-xl shadow-md">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-lg text-white">
                  <CalendarDays size={24} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-black text-lg tracking-wider uppercase text-blue-300">
                      ROL TÉCNICOS {matrixPreview.monthLabel}
                    </h3>

                    {/* Selector y Navegación de Mes */}
                    <div className="flex items-center gap-1 bg-slate-800/90 border border-slate-700/80 rounded-lg p-1 shadow-inner">
                      <button
                        type="button"
                        onClick={() => handleChangeMatrixMonth(getPrevMonth(selectedMonth))}
                        className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors"
                        title="Mes anterior"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => handleChangeMatrixMonth(e.target.value)}
                        className="bg-transparent text-white font-bold text-xs px-2 py-0.5 outline-none cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() => handleChangeMatrixMonth(getNextMonth(selectedMonth))}
                        className="p-1 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition-colors"
                        title="Mes siguiente"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    Vista calendario dividida por sedes institucionales. Puedes hacer clic en cualquier celda para corregir errores o rotaciones.
                  </p>
                </div>
              </div>

              {/* Guía Rápida de Turnos / Leyenda */}
              <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-bold">
                <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-800 border border-teal-300">
                  M: Mañana (06:00)
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                  T: Tarde (13:00 / 09:00 dom)
                </span>
                <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-300">
                  I: Intermedio (08:00)
                </span>
                <span className="px-2 py-0.5 rounded bg-violet-100 text-violet-900 border border-violet-400 font-black">
                  EV: Evento / Comisión
                </span>
                <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-900 border border-purple-300">
                  M(N)/T(N): Rot. Norte
                </span>
                <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 border border-indigo-300">
                  M(V): Rot. Villa
                </span>
                <span className="px-2 py-0.5 rounded bg-pink-100 text-pink-900 border border-pink-300">
                  M(A): Rot. Ate
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-600 border border-slate-300">
                  D: Descanso
                </span>
                <span className="px-2 py-0.5 rounded bg-yellow-200 text-yellow-900 border border-yellow-400">
                  F: Feriado
                </span>
              </div>
            </div>

            {/* Tabla Matriz Tipo Hoja de Cálculo / Calendario */}
            <div className="overflow-x-auto border-2 border-slate-300 rounded-xl shadow-sm bg-white max-h-[58vh] overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-20 shadow-xs">
                  {/* Fila 1: Días de la semana (J, V, S, D, L, Ma, Mi...) */}
                  <tr className="border-b border-slate-300">
                    <th className="sticky left-0 z-30 bg-slate-100 text-slate-800 font-extrabold px-3 py-1.5 border-r border-slate-300 min-w-[200px] text-left">
                      Nombres y Apellidos
                    </th>
                    {matrixPreview.daysMeta.map((meta) => (
                      <th
                        key={`letter-${meta.dayNumber}`}
                        className={`text-center px-1.5 py-1 border-r border-slate-300 min-w-[34px] font-black text-[11px] ${
                          meta.isSunday
                            ? "bg-amber-300 text-amber-950 border-r-amber-400"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {meta.dayLetter}
                      </th>
                    ))}
                  </tr>

                  {/* Fila 2: Números de los días (1, 2, 3, 4, 5...) */}
                  <tr className="border-b-2 border-slate-400">
                    <th className="sticky left-0 z-30 bg-slate-200 text-slate-600 font-bold px-3 py-1 border-r border-slate-300 text-[10px] text-left uppercase">
                      Sede Asignada / Acciones
                    </th>
                    {matrixPreview.daysMeta.map((meta) => (
                      <th
                        key={`num-${meta.dayNumber}`}
                        className={`text-center px-1.5 py-1 border-r border-slate-300 min-w-[34px] font-black text-xs ${
                          meta.isSunday
                            ? "bg-amber-300 text-amber-950 border-r-amber-400"
                            : "bg-slate-200 text-slate-800"
                        }`}
                      >
                        {meta.dayNumber}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {["Campus Villa", "Campus Norte", "Campus Ate", "Campus Aramburú"].map((sedeName) => {
                    const rowsInCampus = matrixPreview.rows.filter((r) => r.campusName === sedeName)
                    const sedeDisplay =
                      sedeName === "Campus Villa"
                        ? "SEDE VILLA"
                        : sedeName === "Campus Norte"
                        ? "SEDE NORTE"
                        : sedeName === "Campus Ate"
                        ? "SEDE ATE"
                        : "CAMPUS ARAMBURÚ"

                    return (
                      <React.Fragment key={sedeName}>
                        {/* Franja separadora de Sede */}
                        <tr className="bg-slate-800 text-white font-extrabold text-xs">
                          <td
                            colSpan={matrixPreview.daysInMonth + 1}
                            className="px-4 py-2 border-y border-slate-700 sticky left-0 z-10"
                          >
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-2 tracking-wider">
                                <Building2 size={16} className="text-blue-400" />
                                {sedeDisplay}
                                <span className="text-slate-300 font-normal text-[11px]">
                                  ({rowsInCampus.length} técnicos programados)
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => addMatrixRowToCampus(sedeName)}
                                className="px-2.5 py-1 text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center gap-1 shadow-xs transition-colors"
                              >
                                <Plus size={12} /> Agregar Técnico a {sedeDisplay}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {rowsInCampus.length === 0 ? (
                          <tr>
                            <td
                              colSpan={matrixPreview.daysInMonth + 1}
                              className="px-4 py-3 text-center text-slate-400 italic bg-slate-50 border-b border-slate-200"
                            >
                              Sin técnicos asignados en {sedeDisplay} para este mes.
                            </td>
                          </tr>
                        ) : (
                          rowsInCampus.map((row) => (
                            <tr
                              key={row.rowId}
                              className="border-b border-slate-200 hover:bg-slate-50/80 transition-colors"
                            >
                              {/* Columna fija Izquierda: Técnico y selector de Sede */}
                              <td className="sticky left-0 z-10 bg-white border-r border-slate-300 px-3 py-2 shadow-sm min-w-[200px]">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    <select
                                      value={row.techId || ""}
                                      onChange={(e) => updateRowTech(row.rowId, e.target.value)}
                                      className="w-full text-xs font-bold text-slate-800 bg-transparent border-0 focus:ring-1 focus:ring-blue-500 rounded px-1 py-0.5 truncate cursor-pointer hover:bg-slate-100"
                                    >
                                      {row.techId && !technicians.some((t) => t.id === row.techId) && (
                                        <option value={row.techId}>{row.name}</option>
                                      )}
                                      {technicians.map((t) => (
                                        <option key={t.id} value={t.id}>
                                          {t.name}
                                        </option>
                                      ))}
                                    </select>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      <select
                                        value={row.campusName}
                                        onChange={(e) => updateRowCampus(row.rowId, e.target.value)}
                                        className="text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded px-1 py-0.5 outline-none"
                                      >
                                        <option value="Campus Villa">Sede Villa</option>
                                        <option value="Campus Norte">Sede Norte</option>
                                        <option value="Campus Ate">Sede Ate</option>
                                        <option value="Campus Aramburú">Campus Aramburú</option>
                                      </select>
                                      {row.dni && (
                                        <span className="text-[10px] text-slate-400 font-mono">DNI: {row.dni}</span>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => deleteMatrixRow(row.rowId)}
                                    className="text-slate-300 hover:text-red-500 p-1 rounded transition-colors"
                                    title="Eliminar fila del cronograma"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>

                              {/* Columnas de los días (1 al 31) */}
                              {matrixPreview.daysMeta.map((meta) => {
                                const dayCell = row.days[meta.dayNumber] || {
                                  token: "D",
                                  shift: Shift.DESCANSO,
                                  campusName: row.campusName,
                                  entryTime: "00:00",
                                }
                                const isSunday = meta.isSunday
                                const isPopupOpen =
                                  activeCellPopup?.rowId === row.rowId && activeCellPopup?.day === meta.dayNumber

                                // Colorimetría exacta de la ficha
                                let badgeColor = "bg-white text-slate-400 hover:bg-slate-100"
                                if (dayCell.token === "M") {
                                  badgeColor = "bg-teal-50 text-teal-800 border-teal-300 font-bold"
                                } else if (dayCell.token === "T") {
                                  badgeColor = "bg-amber-100 text-amber-900 border-amber-300 font-bold"
                                } else if (dayCell.token === "I") {
                                  badgeColor = "bg-blue-100 text-blue-900 border-blue-300 font-bold"
                                } else if (dayCell.token.includes("(N)")) {
                                  badgeColor = "bg-purple-100 text-purple-900 border-purple-300 font-black"
                                } else if (dayCell.token.includes("(V)")) {
                                  badgeColor = "bg-indigo-100 text-indigo-900 border-indigo-300 font-black"
                                } else if (dayCell.token.includes("(A)")) {
                                  badgeColor = "bg-pink-100 text-pink-900 border-pink-300 font-black"
                                } else if (dayCell.token === "EV" || dayCell.token.startsWith("EV")) {
                                  badgeColor = "bg-violet-100 text-violet-900 border-violet-400 font-black shadow-xs ring-1 ring-violet-300"
                                } else if (dayCell.token === "F") {
                                  badgeColor = "bg-yellow-200 text-yellow-900 border-yellow-400 font-black"
                                } else if (dayCell.token === "VAC") {
                                  badgeColor = "bg-emerald-200 text-emerald-900 border-emerald-400 font-black"
                                } else if (dayCell.token === "D") {
                                  badgeColor = isSunday
                                    ? "bg-amber-50/70 text-amber-700/60 font-semibold"
                                    : "bg-slate-50 text-slate-400"
                                }

                                return (
                                  <td
                                    key={`cell-${row.rowId}-${meta.dayNumber}`}
                                    className={`relative p-0.5 text-center border-r border-slate-200 ${
                                      isSunday ? "bg-amber-50/40 border-r-amber-300" : ""
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isPopupOpen) setActiveCellPopup(null)
                                        else setActiveCellPopup({ rowId: row.rowId, day: meta.dayNumber })
                                      }}
                                      title={`Día ${meta.dayNumber} (${meta.dayLetter}): ${dayCell.token} - ${dayCell.shift} en ${dayCell.campusName}`}
                                      className={`w-full h-8 flex items-center justify-center rounded text-xs transition-all border ${badgeColor} ${
                                        isPopupOpen ? "ring-2 ring-blue-600 scale-105 z-20 shadow-md" : ""
                                      }`}
                                    >
                                      {dayCell.token || "—"}
                                    </button>

                                    {/* Selector Rápido Popup */}
                                    {isPopupOpen && (
                                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-white border-2 border-slate-300 rounded-xl shadow-2xl p-2 w-52 text-left animate-fade-in-up">
                                        <div className="text-[11px] font-black text-slate-700 mb-1.5 flex items-center justify-between border-b pb-1">
                                          <span>Día {meta.dayNumber} ({meta.dayLetter})</span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setActiveCellPopup(null)
                                            }}
                                            className="text-slate-400 hover:text-slate-600"
                                          >
                                            <X size={12} />
                                          </button>
                                        </div>

                                        <div className="grid grid-cols-3 gap-1">
                                          {[
                                            { t: "M", l: "Mañana" },
                                            { t: "T", l: isSunday ? "Tarde/09h" : "Tarde" },
                                            { t: "I", l: "Interm." },
                                            { t: "EV", l: "EV (Evento)" },
                                            { t: "M(N)", l: "Mañ. Norte" },
                                            { t: "T(N)", l: "Tar. Norte" },
                                            { t: "M(V)", l: "Mañ. Villa" },
                                            { t: "M(A)", l: "Mañ. Ate" },
                                            { t: "T(A)", l: "Tar. Ate" },
                                            { t: "D", l: "Descanso" },
                                            { t: "F", l: "Feriado" },
                                            { t: "VAC", l: "Vacaciones" },
                                          ].map((opt) => (
                                            <button
                                              key={opt.t}
                                              type="button"
                                              onClick={() => {
                                                updateMatrixCell(row.rowId, meta.dayNumber, opt.t)
                                                setActiveCellPopup(null)
                                              }}
                                              className={`px-1.5 py-1 text-[11px] font-bold rounded border text-center transition-colors ${
                                                dayCell.token === opt.t
                                                  ? "bg-blue-600 text-white border-blue-600 font-black"
                                                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-200"
                                              }`}
                                            >
                                              {opt.t}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          ))
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer con Resumen y Botón de Confirmación */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-200 bg-slate-50 p-4 rounded-xl">
              <div className="text-xs text-slate-600 space-y-0.5">
                <p className="font-bold text-slate-800">
                  Total de técnicos en plantilla: <span className="text-blue-700">{matrixPreview.rows.length}</span>
                </p>
                <p className="text-slate-500">
                  Total de turnos computados para {matrixPreview.monthLabel}:{" "}
                  <span className="font-semibold text-slate-700">
                    {matrixPreview.rows.length * matrixPreview.daysInMonth} días
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsMatrixPreviewOpen(false)}
                  className="h-11 px-6 rounded-xl font-bold flex-1 sm:flex-initial"
                >
                  Cerrar sin guardar
                </Button>
                <Button
                  type="button"
                  disabled={isPending}
                  onClick={handleSaveMatrixPreview}
                  className="h-11 px-8 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-extrabold rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 flex-1 sm:flex-initial transition-all hover:scale-105"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="animate-spin mr-2" size={18} />
                      Guardando Programación Oficial...
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      Confirmar y Guardar Cronograma Oficial
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </ScheduleModal>
    </div>
  )
}
