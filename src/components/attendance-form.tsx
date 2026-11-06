"use client"

import { useState, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Role, RecordType, Shift } from "@prisma/client"
import {
  validateUserAction,
  registerAttendanceAction,
  syncOfflineRecordsAction,
  preloadAttendanceDirectoryAction,
  authorizeKioskDeviceAction,
  revokeKioskDeviceAction,
} from "@/actions/attendance"
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
  MonitorCheck,
  Smartphone,
  Lock,
  X,
  UserX,
  Navigation,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { validateHybridLocation, type GeoCampus } from "@/lib/geofence"

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

const KIOSK_STORAGE_KEY = "clinsim_kiosk_config"
const SAVED_DNI_STORAGE_KEY = "clinsim_saved_personal_dni"

interface KioskConfig {
  token: string
  campusName: string
  authorizedAt: string
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

  // Estado Modo Híbrido: Kiosco PC (sin GPS) vs Celular Personal (con GPS + DNI recordado)
  const [kioskConfig, setKioskConfig] = useState<KioskConfig | null>(null)
  const [showKioskModal, setShowKioskModal] = useState(false)
  const [kioskAdminUser, setKioskAdminUser] = useState("")
  const [kioskAdminPass, setKioskAdminPass] = useState("")
  const [kioskCampusSelect, setKioskCampusSelect] = useState("Campus Villa")
  const [isAuthorizingKiosk, setIsAuthorizingKiosk] = useState(false)

  // DNI recordado en celular personal
  const [rememberDniOnDevice, setRememberDniOnDevice] = useState(true)
  const [hasRememberedDni, setHasRememberedDni] = useState(false)

  // GPS pre-cargado en segundo plano para celulares (0ms de espera al tocar Marcar)
  const cachedLocationRef = useRef<{ lat: number; lng: number; accuracy: number; timestamp: number } | null>(null)
  const [gpsStatus, setGpsStatus] = useState<"idle" | "locating" | "inside" | "outside" | "denied">("idle")
  const [gpsCampusDetected, setGpsCampusDetected] = useState<string | null>(null)

  const directoryRef = useRef<Record<string, any> | null>(null)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dni: "",
    },
  })

  const geoCampuses: GeoCampus[] = (propCampuses ?? []).map((c) => ({
    name: c.name,
    geoEnforced: true,
    latitude: c.latitude ?? null,
    longitude: c.longitude ?? null,
    radiusMeters: c.radiusMeters ?? 500,
  }))

  // 1. Cargar configuración de Kiosco o DNI recordado en celular al iniciar
  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const rawKiosk = localStorage.getItem(KIOSK_STORAGE_KEY)
      if (rawKiosk) {
        const parsed = JSON.parse(rawKiosk) as KioskConfig
        if (parsed && parsed.token) {
          setKioskConfig(parsed)
          setRememberDniOnDevice(false)
          return
        }
      }
    } catch {}

    // Si NO es PC Kiosco (es celular/dispositivo personal), recuperar DNI guardado
    try {
      const savedDni = localStorage.getItem(SAVED_DNI_STORAGE_KEY)
      if (savedDni && /^\d{8}$/.test(savedDni)) {
        setHasRememberedDni(true)
        form.setValue("dni", savedDni)
      }
    } catch {}
  }, [])

  // 2. Pre-calentar GPS en segundo plano cuando NO está en Modo Kiosco (Celulares)
  useEffect(() => {
    if (typeof window === "undefined" || kioskConfig) {
      setGpsStatus("idle")
      return
    }
    if (!navigator.geolocation) {
      setGpsStatus("denied")
      return
    }

    setGpsStatus("locating")

    const evaluatePosition = (pos: GeolocationPosition) => {
      const coords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: Date.now(),
      }
      cachedLocationRef.current = coords
      const check = validateHybridLocation(coords, geoCampuses, undefined, false)
      if (check.allowed) {
        setGpsStatus("inside")
        setGpsCampusDetected(check.detectedCampusName)
      } else {
        setGpsStatus("outside")
        setGpsCampusDetected(null)
      }
    }

    const watchId = navigator.geolocation.watchPosition(
      evaluatePosition,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsStatus("denied")
        }
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [kioskConfig])

  // 3. Precarga silenciosa del directorio diario apenas abre la página para respuesta en 0ms al digitar DNI
  useEffect(() => {
    let mounted = true
    const warmDirectory = async () => {
      try {
        const res = await preloadAttendanceDirectoryAction()
        if (mounted && res.success && res.directory) {
          directoryRef.current = res.directory
          const currentDni = form.getValues("dni")
          if (currentDni?.length === 8 && res.directory[currentDni]) {
            applyValidationResult(res.directory[currentDni], currentDni)
          }
        }
      } catch {
        // Si falla la precarga silenciosa, validateDni consultará bajo demanda
      }
    }
    warmDirectory()
    const refreshInterval = setInterval(warmDirectory, 60_000)
    return () => {
      mounted = false
      clearInterval(refreshInterval)
    }
  }, [])

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

  const clearOrResetForm = (forceClearRemembered = false) => {
    if (forceClearRemembered && typeof window !== "undefined") {
      localStorage.removeItem(SAVED_DNI_STORAGE_KEY)
      setHasRememberedDni(false)
    }

    // En PC Kiosco (o si no desea recordar DNI), limpiar el campo para la siguiente persona
    if (kioskConfig || !rememberDniOnDevice || forceClearRemembered) {
      form.reset({ dni: "" })
      setValidatedUser(null)
      setTodayLastRecord(null)
      setTechnicianAssignment(null)
      setDailyProgram(null)
      setSelectedShift(null)
      setConnectionError(false)
    }
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

  const applyValidationResult = (res: any, dni: string) => {
    if (res.success && res.user) {
      setValidatedUser(res.user)

      // Si es un celular/dispositivo personal y está activado "Recordar mi DNI", guardarlo en localStorage
      if (!kioskConfig && rememberDniOnDevice && typeof window !== "undefined") {
        localStorage.setItem(SAVED_DNI_STORAGE_KEY, dni)
        setHasRememberedDni(true)
      }

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
  }

  const validateDni = async (dni: string, retryAttempts = 1) => {
    if (isOffline || isContingencyMode) {
      setValidatedUser({
        id: `offline_${dni}`,
        name: `Usuario DNI: ${dni} (Modo Local)`,
        role: Role.TECNICO,
        campusName: kioskConfig?.campusName || "Campus Villa",
      })
      setTodayLastRecord(null)
      setTechnicianAssignment(null)
      setDailyProgram(null)
      setConnectionError(false)
      return
    }

    // Resolución instantánea (0ms) si el DNI ya está en el directorio precargado en memoria
    if (directoryRef.current && directoryRef.current[dni]) {
      setIsValidating(false)
      setConnectionError(false)
      applyValidationResult(directoryRef.current[dni], dni)
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
            await new Promise((r) => setTimeout(r, 400))
          }
        }
      }

      if (!res && lastError) {
        throw lastError
      }

      if (res.success && res.user && directoryRef.current) {
        directoryRef.current[dni] = res
      }

      applyValidationResult(res, dni)
    } catch (error) {
      console.error("Error al validar DNI:", error)
      setConnectionError(true)
      toast.error("Error de conexión al validar. Puede reintentar o activar el Modo Local.")
    } finally {
      setIsValidating(false)
    }
  }

  const handleAuthorizeKiosk = async () => {
    if (!kioskAdminUser.trim() || !kioskAdminPass.trim()) {
      toast.error("Ingrese usuario y contraseña de administrador")
      return
    }
    setIsAuthorizingKiosk(true)
    try {
      const res = await authorizeKioskDeviceAction({
        adminUser: kioskAdminUser,
        adminPass: kioskAdminPass,
        campusName: kioskCampusSelect,
      })
      if (res.success && res.kioskToken) {
        const cfg: KioskConfig = {
          token: res.kioskToken,
          campusName: res.campusName || kioskCampusSelect,
          authorizedAt: new Date().toISOString(),
        }
        localStorage.setItem(KIOSK_STORAGE_KEY, JSON.stringify(cfg))
        localStorage.removeItem(SAVED_DNI_STORAGE_KEY)
        setKioskConfig(cfg)
        setRememberDniOnDevice(false)
        setHasRememberedDni(false)
        setShowKioskModal(false)
        setKioskAdminUser("")
        setKioskAdminPass("")
        toast.success(res.message, { duration: 6000 })
      } else {
        toast.error(res.message || "No se pudo autorizar el Kiosco")
      }
    } catch {
      toast.error("Error de conexión al autorizar Kiosco")
    } finally {
      setIsAuthorizingKiosk(false)
    }
  }

  const handleDeactivateKiosk = async () => {
    localStorage.removeItem(KIOSK_STORAGE_KEY)
    setKioskConfig(null)
    setRememberDniOnDevice(true)
    setShowKioskModal(false)
    await revokeKioskDeviceAction()
    toast.info("Modo Kiosco desactivado en este navegador. Ahora opera en Modo Celular con GPS.")
  }

  const getLocation = () =>
    new Promise<{ lat: number; lng: number; accuracy: number }>((resolve, reject) => {
      // Si ya tenemos una coordenada GPS reciente (< 45 seg) en segundo plano, usarla en 0ms
      if (
        cachedLocationRef.current &&
        Date.now() - cachedLocationRef.current.timestamp < 45_000
      ) {
        resolve({
          lat: cachedLocationRef.current.lat,
          lng: cachedLocationRef.current.lng,
          accuracy: cachedLocationRef.current.accuracy,
        })
        return
      }

      if (typeof navigator === "undefined" || !navigator.geolocation) {
        reject(new Error("Su dispositivo no soporta geolocalización."))
        return
      }

      let finished = false
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true
          navigator.geolocation.getCurrentPosition(
            (p) => {
              const coords = {
                lat: p.coords.latitude,
                lng: p.coords.longitude,
                accuracy: p.coords.accuracy,
                timestamp: Date.now(),
              }
              cachedLocationRef.current = coords
              resolve(coords)
            },
            () =>
              reject(
                new Error(
                  "Tiempo de espera agotado al obtener el GPS. Asegúrese de tener la Ubicación (GPS) activada en su celular."
                )
              ),
            { enableHighAccuracy: false, timeout: 5000, maximumAge: 20000 }
          )
        }
      }, 4500)

      navigator.geolocation.getCurrentPosition(
        (p) => {
          if (!finished) {
            finished = true
            clearTimeout(timer)
            const coords = {
              lat: p.coords.latitude,
              lng: p.coords.longitude,
              accuracy: p.coords.accuracy,
              timestamp: Date.now(),
            }
            cachedLocationRef.current = coords
            resolve(coords)
          }
        },
        (err) => {
          if (!finished) {
            finished = true
            clearTimeout(timer)
            reject(
              new Error(
                err.code === err.PERMISSION_DENIED
                  ? "Debe permitir el acceso a su ubicación GPS en el navegador de su celular para marcar asistencia."
                  : "No se pudo obtener su ubicación GPS. Active el GPS de su celular."
              )
            )
          }
        },
        { enableHighAccuracy: true, timeout: 4500, maximumAge: 15000 }
      )
    })

  const onSubmit = async (data: z.infer<typeof formSchema>, type: RecordType) => {
    if (!validatedUser && !isOffline && !isContingencyMode) {
      toast.error("Debe ingresar un DNI válido primero")
      return
    }

    const isKioskAuthorized = Boolean(kioskConfig?.token)
    const detectedRole = validatedUser?.role || Role.TECNICO
    const resolvedCampus =
      technicianAssignment?.campusName ||
      (dailyProgram?.found ? dailyProgram.campusName : null) ||
      validatedUser?.campusName ||
      kioskConfig?.campusName ||
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

    // En Modo Híbrido:
    // - Si es PC Kiosco Autorizada -> NO pide GPS (0ms)
    // - Si es Celular / Dispositivo Personal -> Exige y valida GPS dentro del campus universitario
    if (!isKioskAuthorized && !isOffline && !isContingencyMode) {
      try {
        location = await getLocation()
      } catch (e: any) {
        toast.error(
          e.message ||
            "Para marcar desde su celular debe activar su ubicación GPS y encontrarse dentro de la universidad.",
          { duration: 6000 }
        )
        setIsSubmitting(null)
        return
      }

      const hybridResult = validateHybridLocation(location, geoCampuses, resolvedCampus, false)
      if (!hybridResult.allowed) {
        setGpsStatus("outside")
        toast.error(
          hybridResult.error || "Ubicación fuera del perímetro de la universidad. Solo puede marcar estando en el campus.",
          { duration: 8000 }
        )
        setIsSubmitting(null)
        return
      }

      setGpsStatus("inside")
      detectedCampusName = hybridResult.detectedCampusName || undefined
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
      clearOrResetForm()
      setIsSubmitting(null)
      return
    }

    // Marcación instantánea optimista (tanto en PC Kiosco como en Celular con GPS ya verificado)
    const currentUser = validatedUser!
    const currentShift = selectedShift || undefined
    const previousLastRecord = directoryRef.current?.[data.dni]?.lastRecordType ?? null

    if (directoryRef.current && directoryRef.current[data.dni]) {
      directoryRef.current[data.dni] = {
        ...directoryRef.current[data.dni],
        lastRecordType: type,
      }
    }
    setTodayLastRecord(type)

    toast.success(
      `✓ Se registró exitosamente su ${type.toLowerCase()}: ${currentUser.name} (${targetCampusName})`,
      { duration: 4500 }
    )
    clearOrResetForm()
    setIsSubmitting(null)

    // Persistir en segundo plano sin hacer esperar al colaborador
    void (async () => {
      try {
        const res = await registerAttendanceAction({
          userId: currentUser.id,
          role: detectedRole,
          type,
          shift: currentShift,
          campusId: targetCampusName,
          courseId: resolvedCourse,
          expectedEntryTime: resolvedExpectedEntry,
          kioskToken: kioskConfig?.token,
          clientTimestamp: new Date(),
          location,
          isOfflineSync: false,
        })
        if (!res.success) {
          if (directoryRef.current && directoryRef.current[data.dni]) {
            directoryRef.current[data.dni] = {
              ...directoryRef.current[data.dni],
              lastRecordType: previousLastRecord,
            }
          }
          setTodayLastRecord(previousLastRecord)
          toast.error(res.message, { duration: 7000 })
        }
      } catch (error) {
        console.warn("Fallo de red en registro en segundo plano, guardando en memoria local:", error)
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
      }
    })()
  }

  const roleMeta = validatedUser ? ROLE_UI_META[validatedUser.role] || ROLE_UI_META[Role.DOCENTE] : null

  return (
    <div className="bg-white rounded-[2rem] p-8 md:p-10 shadow-[0_45px_75px_-15px_rgba(0,0,0,0.6)] w-full relative overflow-hidden transition-all duration-500">
      <div className="absolute top-0 left-0 w-full h-2.5 bg-gradient-to-r from-blue-400 to-[#1967D2]"></div>

      {/* Barra Superior: Estado de Red + Modo Híbrido (Kiosco PC vs Celular GPS) */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6 p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {isOffline ? (
            <span className="flex items-center gap-1.5 font-black text-rose-600 bg-rose-50 px-3 py-1 rounded-full border border-rose-200">
              <WifiOff size={14} /> Sin Conexión (Offline)
            </span>
          ) : isContingencyMode ? (
            <span className="flex items-center gap-1.5 font-black text-amber-700 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
              <ShieldCheck size={14} className="text-amber-600" /> Contingencia Local
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
              <Wifi size={14} className="text-emerald-600" /> En Línea
            </span>
          )}

          {/* Indicador del Modo Híbrido actual */}
          {kioskConfig ? (
            <span className="flex items-center gap-1.5 font-black text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200">
              <MonitorCheck size={14} className="text-indigo-600" /> PC Kiosco: {kioskConfig.campusName} (Sin GPS)
            </span>
          ) : (
            <>
              {gpsStatus === "inside" && (
                <span className="flex items-center gap-1.5 font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                  <Navigation size={13} className="text-emerald-600" /> GPS en {gpsCampusDetected || "Campus"}
                </span>
              )}
              {gpsStatus === "locating" && (
                <span className="flex items-center gap-1.5 font-semibold text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
                  <Loader2 size={13} className="animate-spin text-[#1967D2]" /> Verificando GPS del celular...
                </span>
              )}
              {gpsStatus === "outside" && (
                <span className="flex items-center gap-1.5 font-bold text-amber-700 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                  <MapPin size={13} className="text-amber-600" /> Fuera del perímetro del campus
                </span>
              )}
              {gpsStatus === "denied" && (
                <span className="flex items-center gap-1.5 font-bold text-rose-700 bg-rose-50 px-3 py-1 rounded-full border border-rose-200">
                  <MapPin size={13} className="text-rose-600" /> Active el GPS para marcar en celular
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {pendingOfflineCount > 0 && (
            <button
              type="button"
              onClick={syncOfflineRecords}
              className="flex items-center gap-1.5 font-black text-[#1967D2] hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1 rounded-full border border-blue-200 transition-colors cursor-pointer"
              title="Sincronizar registros guardados en la memoria del dispositivo con la base de datos"
            >
              <RefreshCw size={12} className="animate-spin" />
              {pendingOfflineCount} pend.
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowKioskModal((prev) => !prev)}
            className="flex items-center gap-1 font-bold text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200 transition-colors cursor-pointer"
            title="Configurar Modo Kiosco para la PC fija de la oficina (sin GPS)"
          >
            <Lock size={12} />
            {kioskConfig ? "Kiosco Activo" : "Kiosco PC"}
          </button>
        </div>
      </div>

      {/* Panel desplegable de Autorización de PC Kiosco (Solo Administradores) */}
      {showKioskModal && (
        <div className="mb-6 p-4 rounded-2xl bg-slate-50 border-2 border-indigo-200 space-y-3 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MonitorCheck size={18} className="text-indigo-600" />
              <h3 className="text-sm font-black text-slate-800">
                {kioskConfig
                  ? `PC Kiosco Autorizada (${kioskConfig.campusName})`
                  : "Autorizar esta PC como Kiosco Oficial (Sin GPS)"}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowKioskModal(false)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {kioskConfig ? (
            <div className="space-y-3 text-xs text-slate-600">
              <p>
                Esta computadora está autorizada como <strong>Kiosco Fijo en {kioskConfig.campusName}</strong>. No requiere permisos de ubicación GPS y limpia el DNI automáticamente tras cada marcación.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDeactivateKiosk}
                className="h-9 rounded-xl font-bold text-rose-600 border-rose-200 hover:bg-rose-50 cursor-pointer"
              >
                Desactivar Modo Kiosco en este navegador
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Active esta opción <strong>únicamente en la computadora fija de la oficina/clínica</strong> donde TI tiene bloqueada la ubicación. Los celulares seguirán validando ubicación GPS dentro del campus.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                <Input
                  placeholder="Usuario o DNI Admin"
                  value={kioskAdminUser}
                  onChange={(e) => setKioskAdminUser(e.target.value)}
                  className="h-10 text-sm bg-white"
                />
                <Input
                  type="password"
                  placeholder="Contraseña Admin"
                  value={kioskAdminPass}
                  onChange={(e) => setKioskAdminPass(e.target.value)}
                  className="h-10 text-sm bg-white"
                />
                <select
                  value={kioskCampusSelect}
                  onChange={(e) => setKioskCampusSelect(e.target.value)}
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
                >
                  <option value="Campus Villa">Campus Villa</option>
                  <option value="Campus Norte">Campus Norte</option>
                  <option value="Campus Ate">Campus Ate</option>
                  <option value="Campus Aramburú">Campus Aramburú</option>
                </select>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={isAuthorizingKiosk}
                  onClick={handleAuthorizeKiosk}
                  className="h-9 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs cursor-pointer"
                >
                  {isAuthorizingKiosk ? (
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                  ) : (
                    <MonitorCheck size={14} className="mr-1.5" />
                  )}
                  Autorizar esta PC sin GPS
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

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
                <div className="flex items-center justify-between">
                  <FormLabel className="text-slate-500 text-xs font-bold uppercase tracking-widest">
                    Número de DNI
                  </FormLabel>

                  {/* En celulares personales: mostrar si el DNI está recordado y opción de cambiarlo */}
                  {!kioskConfig && (
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={rememberDniOnDevice}
                          onChange={(e) => {
                            const checked = e.target.checked
                            setRememberDniOnDevice(checked)
                            if (!checked && typeof window !== "undefined") {
                              localStorage.removeItem(SAVED_DNI_STORAGE_KEY)
                              setHasRememberedDni(false)
                            } else if (checked && watchDni?.length === 8 && typeof window !== "undefined") {
                              localStorage.setItem(SAVED_DNI_STORAGE_KEY, watchDni)
                              setHasRememberedDni(true)
                            }
                          }}
                          className="rounded border-slate-300 text-[#1967D2] focus:ring-[#1967D2]"
                        />
                        <Smartphone size={13} className="text-[#1967D2]" />
                        Recordar mi DNI en este celular
                      </label>

                      {hasRememberedDni && watchDni?.length > 0 && (
                        <button
                          type="button"
                          onClick={() => clearOrResetForm(true)}
                          className="flex items-center gap-1 text-xs font-bold text-[#1967D2] hover:text-blue-800 cursor-pointer"
                          title="Borrar DNI guardado para ingresar otro"
                        >
                          <UserX size={13} /> Cambiar DNI
                        </button>
                      )}
                    </div>
                  )}
                </div>

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
                            campusName: kioskConfig?.campusName || "Campus Villa",
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

                        {/* Ambiente donde ingresa (solo nombre después de ':') */}
                        <div className="bg-white/90 rounded-xl p-3.5 border border-slate-200/70 flex items-start gap-3">
                          <DoorOpen size={18} className="text-emerald-600 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Ambiente Asignado
                            </p>
                            <p className="text-sm font-black text-slate-800 break-words">
                              {dailyProgram?.found
                                ? dailyProgram.ambiente.replace(/^[^:]+:\s*/, "")
                                : "Por asignar en sede"}
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
