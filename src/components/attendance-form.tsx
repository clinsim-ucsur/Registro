"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Role, RecordType, Shift } from "@prisma/client"
import { validateUserAction, registerAttendanceAction, syncOfflineRecordsAction } from "@/actions/attendance"
import { type UserDailyProgramSummary } from "@/lib/daily-program-api"
import { toast } from "sonner"
import {
  Loader2,
  LogIn,
  LogOut,
  Search,
  UserCheck,
  WifiOff,
  Wifi,
  RefreshCw,
  ShieldCheck,
  Clock,
  MapPin,
  DoorOpen,
  BookOpen,
  BadgeCheck,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { detectAndValidateCampus, resolveGeoCampuses, isGeoActive, type GeoCampus } from "@/lib/geofence"

const formSchema = z.object({
  dni: z.string().length(8, "El DNI debe tener 8 dígitos numéricos").regex(/^\d+$/, "Solo números"),
})

const ROLE_UI_META: Record<
  string,
  { label: string; badgeClass: string; borderClass: string; accentBg: string }
> = {
  [Role.TECNICO]: {
    label: "Técnico",
    badgeClass: "bg-indigo-600 text-white",
    borderClass: "border-indigo-200",
    accentBg: "from-indigo-50/90 to-blue-50/70",
  },
  [Role.DOCENTE]: {
    label: "Docente",
    badgeClass: "bg-[#1967D2] text-white",
    borderClass: "border-blue-200",
    accentBg: "from-blue-50/90 to-slate-50/80",
  },
  [Role.PACIENTE_SIMULADO]: {
    label: "Paciente Simulado",
    badgeClass: "bg-emerald-600 text-white",
    borderClass: "border-emerald-200",
    accentBg: "from-emerald-50/90 to-teal-50/70",
  },
}

const SHIFT_LABELS: Record<string, string> = {
  MANANA: "Mañana",
  INTERMEDIO: "Intermedio",
  TARDE: "Tarde",
  NOCHE: "Noche",
}

interface AttendanceFormProps {
  campuses?: (Partial<GeoCampus> & { id: string; name: string })[]
  courses?: { id: string; name: string }[]
}

export default function AttendanceForm({ campuses: propCampuses }: AttendanceFormProps = {}) {
  const [isValidating, setIsValidating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState<RecordType | null>(null)
  const [validatedUser, setValidatedUser] = useState<{
    id: string
    name: string
    role: Role
    campusId?: string | null
    campusName?: string | null
    defaultShift?: string | null
  } | null>(null)
  const [technicianAssignment, setTechnicianAssignment] = useState<{
    campusName: string | null
    shift: string
    expectedEntryTime: string
    expectedExitTime?: string
    source: "SCHEDULE" | "DEFAULT_PROFILE"
  } | null>(null)
  const [dailyProgram, setDailyProgram] = useState<UserDailyProgramSummary | null>(null)
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [todayLastRecord, setTodayLastRecord] = useState<RecordType | null | "loading">(null)
  const [markingTimeStr, setMarkingTimeStr] = useState<string>("")

  const [isContingencyMode, setIsContingencyMode] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dni: "",
    },
  })

  // Reloj en vivo para mostrar la hora exacta en que está marcando el usuario en el resumen
  useEffect(() => {
    const updateClock = () => {
      const now = new Date()
      const formatted = new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now)
      setMarkingTimeStr(formatted)
    }
    updateClock()
    const timer = setInterval(updateClock, 1000)
    return () => clearInterval(timer)
  }, [])

  // Detección y Sincronización Offline
  const syncOfflineRecords = async () => {
    if (typeof window === "undefined") return
    const localData = localStorage.getItem("offline_records")
    if (!localData) {
      setPendingOfflineCount(0)
      return
    }

    try {
      const records = JSON.parse(localData)
      if (!Array.isArray(records) || records.length === 0) {
        setPendingOfflineCount(0)
        return
      }

      setPendingOfflineCount(records.length)
      const res = await syncOfflineRecordsAction(records)
      if (res.success) {
        localStorage.removeItem("offline_records")
        setPendingOfflineCount(0)
        setIsContingencyMode(false)
        toast.success(`Se sincronizaron automáticamente ${res.syncedCount} registros locales.`)
        if (res.errorCount && res.errorCount > 0) {
          toast.warning(`Se ignoraron ${res.errorCount} registros (DNI inválidos).`)
        }
      }
    } catch (error) {
      console.error("No se pudo sincronizar", error)
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsOffline(!navigator.onLine)
      const localData = localStorage.getItem("offline_records")
      if (localData) {
        try {
          const recs = JSON.parse(localData)
          setPendingOfflineCount(Array.isArray(recs) ? recs.length : 0)
        } catch {}
      }
    }

    const handleOnline = () => {
      setIsOffline(false)
      toast.success("¡Conexión restaurada! Sincronizando datos...")
      syncOfflineRecords()
    }
    const handleOffline = () => {
      setIsOffline(true)
      toast.error("Sin conexión a Internet. Activando Modo Offline.")
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    if (typeof window !== "undefined" && navigator.onLine) {
      syncOfflineRecords()
    }

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  const watchDni = form.watch("dni")

  const resetForm = () => {
    form.reset({ dni: "" })
    setValidatedUser(null)
    setTodayLastRecord(null)
    setTechnicianAssignment(null)
    setDailyProgram(null)
    setSelectedShift(null)
    setConnectionError(false)
  }

  useEffect(() => {
    if (watchDni?.length === 8) {
      validateDni(watchDni)
    } else {
      setValidatedUser(null)
      setTodayLastRecord(null)
      setTechnicianAssignment(null)
      setDailyProgram(null)
      setSelectedShift(null)
      setConnectionError(false)
    }
  }, [watchDni])

  const validateDni = async (dni: string, retryAttempts = 1) => {
    if (isOffline || isContingencyMode) {
      setValidatedUser({
        id: `offline_${dni}`,
        name: `Usuario DNI: ${dni} (Modo Local)`,
        role: Role.TECNICO,
        campusName: "Campus Villa",
      })
      setTodayLastRecord(null)
      setTechnicianAssignment(null)
      setDailyProgram(null)
      setConnectionError(false)
      return
    }

    setIsValidating(true)
    setConnectionError(false)
    setValidatedUser(null)
    setTechnicianAssignment(null)
    setDailyProgram(null)

    try {
      let res: any = null
      let lastError: any = null

      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          res = await validateUserAction(dni)
          break
        } catch (err) {
          lastError = err
          if (attempt < retryAttempts) {
            await new Promise((r) => setTimeout(r, 600))
          }
        }
      }

      if (!res && lastError) {
        throw lastError
      }

      if (res.success && res.user) {
        setValidatedUser(res.user)
        toast.success(`Identificado: ${res.user.name}`)

        if (res.user.role === Role.TECNICO && res.technicianAssignment) {
          setTechnicianAssignment(res.technicianAssignment)
          setSelectedShift((res.technicianAssignment.shift as Shift) || null)
        } else {
          setTechnicianAssignment(null)
          setSelectedShift(null)
        }

        if (res.dailyProgram) {
          setDailyProgram(res.dailyProgram)
        } else {
          setDailyProgram(null)
        }

        setTodayLastRecord(res.lastRecordType ?? null)
        setConnectionError(false)
      } else {
        setValidatedUser(null)
        setTodayLastRecord(null)
        setTechnicianAssignment(null)
        setDailyProgram(null)
        setSelectedShift(null)
        if (res.isComision) {
          toast.info(res.message, { duration: 9000, icon: "✈️" })
        } else {
          toast.error(res.message || "Usuario no encontrado")
        }
      }
    } catch (error) {
      console.error("Error al validar DNI:", error)
      setConnectionError(true)
      toast.error("Error de conexión al validar. Puede reintentar o activar el Modo Local.")
    } finally {
      setIsValidating(false)
    }
  }

  const getLocation = () =>
    new Promise<{ lat: number; lng: number; accuracy: number }>((resolve, reject) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        reject(new Error("Su dispositivo no soporta geolocalización."))
        return
      }

      let finished = false
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
            () => reject(new Error("Tiempo de espera agotado al obtener el GPS. Asegúrese de tener el GPS activado.")),
            { enableHighAccuracy: false, timeout: 6000, maximumAge: 10000 }
          )
        }
      }, 7000)

      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (!finished) {
            finished = true
            clearTimeout(timer)
            resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy })
          }
        },
        (err) => {
          if (!finished) {
            finished = true
            clearTimeout(timer)
            reject(
              new Error(
                err.code === err.PERMISSION_DENIED
                  ? "Debe permitir el acceso a su ubicación para marcar asistencia."
                  : "No se pudo obtener su ubicación GPS. Active el GPS o acérquese a una ventana."
              )
            )
          }
        },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
      )
    })

  const onSubmit = async (data: z.infer<typeof formSchema>, type: RecordType) => {
    if (!validatedUser && !isOffline && !isContingencyMode) {
      toast.error("Debe ingresar un DNI válido primero")
      return
    }

    const detectedRole = validatedUser?.role || Role.TECNICO
    const resolvedCampus =
      technicianAssignment?.campusName ||
      (dailyProgram?.found ? dailyProgram.campusName : null) ||
      validatedUser?.campusName ||
      "Campus Villa"
    const resolvedCourse = dailyProgram?.found ? dailyProgram.courseName : undefined
    const resolvedExpectedEntry =
      detectedRole === Role.TECNICO
        ? technicianAssignment?.expectedEntryTime
        : dailyProgram?.found
          ? dailyProgram.entryTime
          : undefined

    setIsSubmitting(type)

    let location: { lat: number; lng: number; accuracy: number } | undefined
    let detectedCampusName: string | undefined = undefined

    const geoCampuses: GeoCampus[] = (propCampuses ?? []).map((c) => ({
      name: c.name,
      geoEnforced: !!c.geoEnforced,
      latitude: c.latitude ?? null,
      longitude: c.longitude ?? null,
      radiusMeters: c.radiusMeters ?? 500,
    }))

    const resolvedCampuses = resolveGeoCampuses(geoCampuses)
    const targetCampusConfig = resolvedCampus
      ? resolvedCampuses.find((c) => c.name.toLowerCase() === resolvedCampus.toLowerCase())
      : null

    const requiresGeo = targetCampusConfig ? isGeoActive(targetCampusConfig) : resolvedCampuses.some(isGeoActive)

    if (requiresGeo && !isOffline && !isContingencyMode) {
      try {
        location = await getLocation()
      } catch (e: any) {
        toast.error(e.message || "Se requiere acceso a su ubicación GPS para registrar la asistencia en esta sede.", {
          duration: 6000,
        })
        setIsSubmitting(null)
        return
      }

      const geoResult = detectAndValidateCampus(location, geoCampuses, resolvedCampus)
      if (!geoResult.allowed) {
        toast.error(geoResult.error || "Ubicación fuera del perímetro de la sede autorizada.", { duration: 8000 })
        setIsSubmitting(null)
        return
      }

      detectedCampusName = geoResult.detectedCampusName || undefined
    }

    const targetCampusName = detectedCampusName || resolvedCampus || "Campus Villa"

    if (isOffline || isContingencyMode) {
      const newRecord = {
        dni: data.dni,
        role: detectedRole,
        type,
        campusId: targetCampusName,
        courseId: resolvedCourse,
        location,
        timestamp: new Date().toISOString(),
      }
      const localData = JSON.parse(localStorage.getItem("offline_records") || "[]")
      localData.push(newRecord)
      localStorage.setItem("offline_records", JSON.stringify(localData))
      setPendingOfflineCount(localData.length)

      toast.success(
        `✅ Marcación (${type === "ENTRADA" ? "Ingreso" : "Salida"}) guardada en la memoria local del dispositivo. Se sincronizará automáticamente.`,
        { duration: 7000 }
      )
      resetForm()
      setIsSubmitting(null)
      return
    }

    try {
      const res = await registerAttendanceAction({
        userId: validatedUser!.id,
        role: detectedRole,
        type,
        shift: selectedShift || undefined,
        campusId: targetCampusName,
        courseId: resolvedCourse,
        expectedEntryTime: resolvedExpectedEntry,
        clientTimestamp: new Date(),
        location,
        isOfflineSync: false,
      })

      if (res.success) {
        toast.success(res.message, { duration: 5000 })
        resetForm()
      } else {
        toast.error(res.message)
      }
    } catch (error: any) {
      console.warn("Fallo de red en registro online, activando respaldo local:", error)
      const newRecord = {
        dni: data.dni,
        role: detectedRole,
        type,
        campusId: targetCampusName,
        courseId: resolvedCourse,
        location,
        timestamp: new Date().toISOString(),
      }
      const localData = JSON.parse(localStorage.getItem("offline_records") || "[]")
      localData.push(newRecord)
      localStorage.setItem("offline_records", JSON.stringify(localData))
      setPendingOfflineCount(localData.length)

      toast.warning(
        `La red se interrumpió, pero su marcación (${type}) fue guardada de inmediato en el dispositivo y se sincronizará automáticamente.`,
        { duration: 8000 }
      )
      resetForm()
    } finally {
      setIsSubmitting(null)
    }
  }

  const roleMeta = validatedUser ? ROLE_UI_META[validatedUser.role] || ROLE_UI_META[Role.DOCENTE] : null

  return (
    <div className="bg-white rounded-[2rem] p-8 md:p-10 shadow-[0_45px_75px_-15px_rgba(0,0,0,0.6)] w-full relative overflow-hidden transition-all duration-500">
      <div className="absolute top-0 left-0 w-full h-2.5 bg-gradient-to-r from-blue-400 to-[#1967D2]"></div>

      {/* Barra de Estado de Conexión y Diagnóstico de Red */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6 p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs">
        <div className="flex items-center gap-2">
          {isOffline ? (
            <span className="flex items-center gap-1.5 font-black text-rose-600 bg-rose-50 px-3 py-1 rounded-full border border-rose-200">
              <WifiOff size={14} /> Modo Sin Conexión (Offline)
            </span>
          ) : isContingencyMode ? (
            <span className="flex items-center gap-1.5 font-black text-amber-700 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
              <ShieldCheck size={14} className="text-amber-600" /> Modo Contingencia Local Activo
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
              <Wifi size={14} className="text-emerald-600" /> Servidor Conectado (En Línea)
            </span>
          )}
        </div>

        {pendingOfflineCount > 0 && (
          <button
            type="button"
            onClick={syncOfflineRecords}
            className="flex items-center gap-1.5 font-black text-[#1967D2] hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded-full border border-blue-200 transition-colors cursor-pointer"
            title="Sincronizar registros guardados en la memoria del dispositivo con la base de datos"
          >
            <RefreshCw size={12} className="animate-spin" />
            {pendingOfflineCount} {pendingOfflineCount === 1 ? "registro pendiente" : "registros pendientes"} • Sincronizar
          </button>
        )}
      </div>

      <div className="text-center mb-7">
        <h2 className="text-2xl md:text-3xl font-black text-slate-800 tracking-wide">
          Registro de Asistencia
        </h2>
        <p className="text-slate-500 text-xs md:text-sm font-medium mt-1">
          Ingrese su número de DNI para identificar automáticamente su rol, sede y programación del día
        </p>
      </div>

      <Form {...form}>
        <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          <FormField
            control={form.control}
            name="dni"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-500 text-xs font-bold uppercase tracking-widest">
                  Número de DNI
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={24} />
                    <Input
                      placeholder="Ingrese sus 8 dígitos"
                      maxLength={8}
                      autoFocus
                      className="h-20 pl-14 pr-14 bg-slate-50 border-2 border-slate-200 text-slate-900 text-2xl font-black tracking-[0.4em] rounded-xl focus-visible:ring-[#1967D2] focus-visible:border-[#1967D2] transition-all placeholder:text-slate-300 placeholder:tracking-normal placeholder:font-medium"
                      {...field}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "")
                        field.onChange(val)
                      }}
                    />
                    {isValidating && (
                      <Loader2 className="absolute right-5 top-1/2 -translate-y-1/2 text-[#1967D2] animate-spin" size={26} />
                    )}
                    {validatedUser && !isValidating && (
                      <UserCheck className="absolute right-5 top-1/2 -translate-y-1/2 text-emerald-500" size={28} />
                    )}
                  </div>
                </FormControl>

                {/* Pantalla de carga mientras el sistema analiza el DNI y su programación */}
                {isValidating && (
                  <div className="mt-4 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50/90 to-indigo-50/70 p-6 flex flex-col items-center justify-center gap-3 text-center animate-fade-in-up">
                    <Loader2 size={32} className="text-[#1967D2] animate-spin" />
                    <div className="space-y-0.5">
                      <p className="text-sm font-black text-slate-800">
                        Analizando DNI y programación del día...
                      </p>
                      <p className="text-xs font-medium text-slate-500">
                        Verificando rol, horario de entrada/salida, sede y ambiente asignado
                      </p>
                    </div>
                  </div>
                )}

                {/* Alerta de error de conexión con opción de Modo Contingencia Local */}
                {connectionError && !isValidating && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50/90 p-4 text-xs space-y-2.5 mt-3 animate-fade-in-up shadow-xs">
                    <div className="flex items-center gap-2 font-black text-amber-900">
                      <WifiOff size={16} className="text-amber-700" />
                      <span>Problema de conexión con el servidor en esta red</span>
                    </div>
                    <p className="text-amber-800 leading-relaxed font-medium">
                      Ocurrió un problema de enlace o lentitud en la red Wi-Fi de esta sede. Para no retrasar su marcación ni perder su hora oficial de ingreso/salida, puede activar el <strong>Modo Local</strong> o reintentar la conexión.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => validateDni(watchDni, 2)}
                        disabled={isValidating}
                        className="h-9 px-4 rounded-xl font-black bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
                      >
                        <RefreshCw size={14} className={`mr-1.5 ${isValidating ? "animate-spin" : ""}`} /> Reintentar Conexión
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setIsContingencyMode(true)
                          setValidatedUser({
                            id: `offline_${watchDni}`,
                            name: `Usuario DNI: ${watchDni} (Modo Local)`,
                            role: Role.TECNICO,
                            campusName: "Campus Villa",
                          })
                          setConnectionError(false)
                          toast.info("Modo contingencia activado: Su marcación se guardará de inmediato en el dispositivo.")
                        }}
                        className="h-9 px-4 rounded-xl font-black border-amber-400 bg-white text-amber-900 hover:bg-amber-100 shadow-xs"
                      >
                        <ShieldCheck size={14} className="mr-1.5 text-emerald-600" /> Marcar en Modo Local
                      </Button>
                    </div>
                  </div>
                )}

                {/* Resumen de Información al validar el DNI */}
                {validatedUser && !isValidating && roleMeta && (
                  <div
                    className={`mt-4 rounded-2xl border-2 ${roleMeta.borderClass} bg-gradient-to-br ${roleMeta.accentBg} p-5 space-y-4 animate-fade-in-up shadow-xs`}
                  >
                    {/* Cabecera: Quién está marcando + Rol detectado */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/80">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-white shadow-xs border border-slate-200/80 flex items-center justify-center shrink-0">
                          <BadgeCheck size={20} className="text-emerald-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Colaborador Identificado
                          </p>
                          <p className="text-base md:text-lg font-black text-slate-900 truncate">
                            {validatedUser.name}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-xs font-black uppercase tracking-widest px-3.5 py-1.5 rounded-full shadow-xs ${roleMeta.badgeClass}`}
                      >
                        {roleMeta.label}
                      </span>
                    </div>

                    {/* CASO 1: Resumen para TÉCNICOS (Quién marca, Hora que marca / turno y Sede) */}
                    {validatedUser.role === Role.TECNICO && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="bg-white/90 rounded-xl p-3.5 border border-slate-200/70 flex items-start gap-3">
                          <Clock size={18} className="text-indigo-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Hora de Marcación y Turno
                            </p>
                            <p className="text-sm font-black text-slate-800">
                              Marcando: <span className="text-indigo-700">{markingTimeStr}</span>
                            </p>
                            {technicianAssignment && (
                              <p className="text-xs font-semibold text-slate-600 mt-0.5">
                                Turno {SHIFT_LABELS[technicianAssignment.shift] || technicianAssignment.shift}:{" "}
                                <span className="font-bold text-slate-800">
                                  {technicianAssignment.expectedEntryTime} — {technicianAssignment.expectedExitTime || "15:00"}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="bg-white/90 rounded-xl p-3.5 border border-slate-200/70 flex items-start gap-3">
                          <MapPin size={18} className="text-indigo-600 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Sede Asignada
                            </p>
                            <p className="text-sm font-black text-slate-800">
                              {technicianAssignment?.campusName || validatedUser.campusName || "Campus Villa"}
                            </p>
                            <p className="text-xs font-medium text-slate-500 mt-0.5">
                              {technicianAssignment?.source === "SCHEDULE" ? "Según cronograma del día" : "Sede base asignada"}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CASO 2: Resumen para DOCENTES y PACIENTES SIMULADOS */}
                    {(validatedUser.role === Role.DOCENTE || validatedUser.role === Role.PACIENTE_SIMULADO) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Hora de marcación y Horario (1er ingreso -> última salida del día) */}
                        <div className="bg-white/90 rounded-xl p-3.5 border border-slate-200/70 flex items-start gap-3">
                          <Clock size={18} className="text-[#1967D2] mt-0.5 shrink-0" />
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Hora de Marcación y Horario
                            </p>
                            <p className="text-sm font-black text-slate-800">
                              Marcando: <span className="text-[#1967D2]">{markingTimeStr}</span>
                            </p>
                            {dailyProgram?.found ? (
                              <p className="text-xs font-semibold text-slate-600 mt-0.5">
                                Turno hoy:{" "}
                                <span className="font-black text-slate-900">
                                  Ingreso {dailyProgram.entryTime} — Salida {dailyProgram.exitTime}
                                </span>
                              </p>
                            ) : (
                              <p className="text-xs font-medium text-amber-700 mt-0.5">
                                Sin horario programado en lista de hoy
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Sede */}
                        <div className="bg-white/90 rounded-xl p-3.5 border border-slate-200/70 flex items-start gap-3">
                          <MapPin size={18} className="text-[#1967D2] mt-0.5 shrink-0" />
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Sede Asignada
                            </p>
                            <p className="text-sm font-black text-slate-800">
                              {dailyProgram?.found
                                ? dailyProgram.campusName
                                : validatedUser.campusName || "Campus Villa"}
                            </p>
                            {dailyProgram?.found && dailyProgram.piso && (
                              <p className="text-xs font-medium text-slate-500 mt-0.5">
                                Ubicación: {dailyProgram.piso}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Ambiente donde ingresa */}
                        <div className="bg-white/90 rounded-xl p-3.5 border border-slate-200/70 flex items-start gap-3">
                          <DoorOpen size={18} className="text-emerald-600 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Ambiente Asignado
                            </p>
                            <p className="text-sm font-black text-slate-800 break-words">
                              {dailyProgram?.found ? dailyProgram.ambiente : "Por asignar en sede"}
                            </p>
                          </div>
                        </div>

                        {/* Curso / Sesión donde ingresa */}
                        <div className="bg-white/90 rounded-xl p-3.5 border border-slate-200/70 flex items-start gap-3">
                          <BookOpen size={18} className="text-emerald-600 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Curso / Sesión de Ingreso
                            </p>
                            <p className="text-sm font-black text-slate-800 break-words">
                              {dailyProgram?.found ? dailyProgram.courseName : "General"}
                            </p>
                            {dailyProgram?.found && dailyProgram.sesion && (
                              <p className="text-xs font-medium text-slate-500 mt-0.5 truncate" title={dailyProgram.sesion}>
                                {dailyProgram.sesion}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <FormMessage className="text-sm font-medium" />
              </FormItem>
            )}
          />

          {/* Botón de Marcación ENTRADA / SALIDA según el estado del día */}
          {(() => {
            const isLoadingState = todayLastRecord === "loading" || isValidating
            const lastType = isLoadingState ? null : (todayLastRecord as RecordType | null)
            const showEntrada = lastType !== RecordType.ENTRADA
            const showSalida = lastType === RecordType.ENTRADA

            const isButtonDisabled =
              (!validatedUser && !isOffline && !isContingencyMode) || isSubmitting !== null || isLoadingState

            return (
              <div className="grid grid-cols-1 gap-4 pt-2">
                {showEntrada && (
                  <Button
                    type="button"
                    disabled={isButtonDisabled}
                    onClick={form.handleSubmit((d) => onSubmit(d, RecordType.ENTRADA))}
                    className="h-20 rounded-xl bg-[#1967D2] hover:bg-[#124b9c] text-white font-black text-xl shadow-[0_10px_20px_-5px_rgba(25,103,210,0.5)] hover:shadow-[0_15px_25px_-5px_rgba(25,103,210,0.7)] transition-all hover:-translate-y-1 disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none cursor-pointer"
                  >
                    {isLoadingState ? (
                      <Loader2 size={24} className="animate-spin mr-2" />
                    ) : isSubmitting === RecordType.ENTRADA ? (
                      <Loader2 size={24} className="animate-spin mr-2" />
                    ) : (
                      <LogIn size={24} className="mr-2" />
                    )}
                    {isLoadingState ? "ANALIZANDO..." : "MARCAR ENTRADA"}
                  </Button>
                )}

                {showSalida && (
                  <Button
                    type="button"
                    disabled={isButtonDisabled}
                    onClick={form.handleSubmit((d) => onSubmit(d, RecordType.SALIDA))}
                    className="h-20 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-black text-xl shadow-[0_10px_20px_-5px_rgba(15,23,42,0.5)] hover:shadow-[0_15px_25px_-5px_rgba(15,23,42,0.7)] transition-all hover:-translate-y-1 disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none cursor-pointer"
                  >
                    {isSubmitting === RecordType.SALIDA ? (
                      <Loader2 size={24} className="animate-spin mr-2" />
                    ) : (
                      <LogOut size={24} className="mr-2" />
                    )}
                    MARCAR SALIDA
                  </Button>
                )}
              </div>
            )
          })()}
        </form>
      </Form>
    </div>
  )
}
