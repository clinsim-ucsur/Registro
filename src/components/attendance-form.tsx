"use client"

import { useState, useEffect, useRef, memo } from "react"
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
  authorizeKioskWithOneTimeCodeAction,
  revokeKioskDeviceAction,
} from "@/actions/attendance"
import {
  resolveUserModulesState,
  getCurrentLimaMinutes,
  buildMobileRotationAlertPayload,
  type UserDailyProgramSummary,
  type TodayAttendanceRecordLite,
} from "@/lib/daily-program-api"
import {
  registerServiceWorker,
  requestSystemNotificationPermission,
  showSystemNotification,
  subscribeDeviceToWebPush,
  syncModuleAlarmsWithServiceWorker,
  scheduleClosedAppTestNotification,
} from "@/lib/background-alerts"
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
  BellRing,
  ArrowRight,
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
const MOBILE_ALARM_ONBOARDED_KEY = "clinsim_mobile_alarm_onboarded"

interface KioskConfig {
  token: string
  campusName: string
  authorizedAt: string
}

interface AttendanceFormProps {
  campuses?: (Partial<GeoCampus> & { id: string; name: string })[]
  courses?: { id: string; name: string }[]
}

const LiveMarkingTimeSpan = memo(function LiveMarkingTimeSpan({ className }: { className?: string }) {
  const [timeStr, setTimeStr] = useState<string>(() =>
    new Intl.DateTimeFormat("es-PE", {
      timeZone: "America/Lima",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date())
  )

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeStr(
        new Intl.DateTimeFormat("es-PE", {
          timeZone: "America/Lima",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date())
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return <span className={className}>{timeStr}</span>
})

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
  const [todayRecords, setTodayRecords] = useState<TodayAttendanceRecordLite[]>([])
  const [currentLimaMins, setCurrentLimaMins] = useState<number>(() => getCurrentLimaMinutes())
  const [dismissedRotationAlertKey, setDismissedRotationAlertKey] = useState<string | null>(null)
  const [mobileAlarmOnboarded, setMobileAlarmOnboarded] = useState<boolean>(true)
  const [isRefreshingSchedule, setIsRefreshingSchedule] = useState<boolean>(false)
  const [isTestingClosedAlert, setIsTestingClosedAlert] = useState<boolean>(false)
  const firedNotificationsRef = useRef<Set<string>>(new Set())

  const [isContingencyMode, setIsContingencyMode] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0)

  // Estado Modo Híbrido: Estación Fija (sin GPS) vs Celular Personal (con GPS + DNI recordado)
  const [kioskConfig, setKioskConfig] = useState<KioskConfig | null>(null)
  const [showKioskModal, setShowKioskModal] = useState(false)
  const [kioskAuthMethod, setKioskAuthMethod] = useState<"code" | "credentials">("code")
  const [kioskOneTimeCode, setKioskOneTimeCode] = useState("")
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
  const warmDirectoryPromiseRef = useRef<Promise<Record<string, any> | null> | null>(null)

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

  // 1. Cargar configuración de Kiosco o DNI recordado en celular al iniciar + registrar Service Worker
  useEffect(() => {
    if (typeof window === "undefined") return

    // Registrar Service Worker para permitir notificaciones flotantes con app cerrada / teléfono bloqueado
    void registerServiceWorker()

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

    // Si NO es PC Kiosco (es celular/dispositivo personal), recuperar DNI guardado y estado de primera activación de alarma
    try {
      const onboarded = localStorage.getItem(MOBILE_ALARM_ONBOARDED_KEY) === "true"
      const alreadyGranted =
        typeof Notification !== "undefined" && Notification.permission === "granted"
      setMobileAlarmOnboarded(onboarded || alreadyGranted)

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
      if (warmDirectoryPromiseRef.current) return warmDirectoryPromiseRef.current
      const p = (async () => {
        try {
          const res = await preloadAttendanceDirectoryAction()
          if (mounted && res.success && res.directory) {
            directoryRef.current = res.directory
            const currentDni = form.getValues("dni")
            if (currentDni?.length === 8 && res.directory[currentDni] && !validatedUser) {
              applyValidationResult(res.directory[currentDni], currentDni)
            }
            return res.directory
          }
          return null
        } catch {
          // Si falla la precarga silenciosa, validateDni consultará bajo demanda
          return null
        } finally {
          warmDirectoryPromiseRef.current = null
        }
      })()
      warmDirectoryPromiseRef.current = p
      return p
    }
    void warmDirectory()
    const refreshInterval = setInterval(() => {
      void warmDirectory()
    }, 90_000)
    return () => {
      mounted = false
      clearInterval(refreshInterval)
    }
  }, [])

  // Actualizar los minutos actuales en Lima cada 30 segundos (sin re-renderizar todo el formulario cada segundo)
  useEffect(() => {
    const updateMins = () => {
      setCurrentLimaMins(getCurrentLimaMinutes(new Date()))
    }
    updateMins()
    const timer = setInterval(updateMins, 30_000)
    return () => clearInterval(timer)
  }, [])

  // Alerta sonora (Web Audio API) + vibración para aviso de fin de clase y rotación en celulares
  const playRotationAlertSoundAndVibrate = () => {
    if (typeof window === "undefined" || kioskConfig) return
    try {
      if (navigator.vibrate) {
        navigator.vibrate([350, 150, 350, 150, 500])
      }
    } catch {}
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const notes = [587.33, 783.99, 1046.5] // D5 -> G5 -> C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = "sine"
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.22)
        gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.22)
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + idx * 0.22 + 0.04)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.22 + 0.2)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(ctx.currentTime + idx * 0.22)
        osc.stop(ctx.currentTime + idx * 0.22 + 0.21)
      })
    } catch {}
  }

  const requestMobileNotificationPermission = async () => {
    if (typeof window === "undefined" || kioskConfig) return
    try {
      localStorage.setItem(MOBILE_ALARM_ONBOARDED_KEY, "true")
      setMobileAlarmOnboarded(true)
      const res = await requestSystemNotificationPermission()
      if (res === "granted") {
        if (validatedUser && watchDni?.length === 8) {
          void subscribeDeviceToWebPush({
            dni: watchDni,
            userId: validatedUser.id,
            userName: validatedUser.name,
            role: validatedUser.role,
            campusName: validatedUser.campusName || "Campus Villa",
          })
        }
        toast.success("Avisos del sistema activados. Recibirá notificaciones en su pantalla incluso con la app cerrada.")
      }
    } catch {}
  }

  const handleTestClosedAppNotification = async () => {
    if (typeof window === "undefined" || kioskConfig || !validatedUser || watchDni?.length !== 8) return
    setIsTestingClosedAlert(true)
    try {
      const perm = await requestSystemNotificationPermission()
      if (perm !== "granted") {
        toast.error("Debe permitir las notificaciones en su navegador para recibir avisos con la app cerrada.")
        setIsTestingClosedAlert(false)
        return
      }
      await subscribeDeviceToWebPush({
        dni: watchDni,
        userId: validatedUser.id,
        userName: validatedUser.name,
        role: validatedUser.role,
        campusName: validatedUser.campusName || "Campus Villa",
      })
      await scheduleClosedAppTestNotification({
        dni: watchDni,
        userName: validatedUser.name,
        delayMs: 5000,
      })
      toast.info(
        "📲 En 5 segundos llegará la notificación. Minimice la app o bloquee su teléfono ahora para comprobarlo.",
        { duration: 6000 }
      )
    } finally {
      setTimeout(() => setIsTestingClosedAlert(false), 5500)
    }
  }

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
      setTodayRecords([])
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
      setTodayRecords([])
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
      setTodayRecords(Array.isArray(res.todayRecords) ? res.todayRecords : [])
      setConnectionError(false)
    } else {
      setValidatedUser(null)
      setTodayLastRecord(null)
      setTodayRecords([])
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

  const validateDni = async (dni: string, retryAttempts = 1, forceFreshExcel = false) => {
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

    // Resolución instantánea (0ms) desde memoria local + actualización en vivo del Excel en segundo plano
    if (!forceFreshExcel && directoryRef.current && directoryRef.current[dni]) {
      const cachedHit = directoryRef.current[dni]
      setIsValidating(false)
      setConnectionError(false)
      applyValidationResult(cachedHit, dni)

      // Si es Docente o Paciente Simulado, consultar SIEMPRE el Excel en vivo para detectar cambios de último minuto
      const hitRole = cachedHit?.user?.role
      if (hitRole === Role.DOCENTE || hitRole === Role.PACIENTE_SIMULADO) {
        setIsRefreshingSchedule(true)
        void (async () => {
          try {
            const freshRes = await validateUserAction(dni, undefined, true)
            if (freshRes?.success && freshRes.user && form.getValues("dni") === dni) {
              if (directoryRef.current) {
                directoryRef.current[dni] = freshRes
              }
              applyValidationResult(freshRes, dni)
            }
          } catch {
            // Conservar el resultado en memoria si hay micro-corte
          } finally {
            setIsRefreshingSchedule(false)
          }
        })()
      }
      return
    }

    if (forceFreshExcel) {
      setIsRefreshingSchedule(true)
    } else {
      setIsValidating(true)
      setValidatedUser(null)
      setTechnicianAssignment(null)
      setDailyProgram(null)
    }
    setConnectionError(false)

    try {
      // Si la precarga inicial del directorio ya está en vuelo, esperar hasta 700ms para reutilizarla
      if (!forceFreshExcel && warmDirectoryPromiseRef.current && !directoryRef.current) {
        const dir = await Promise.race([
          warmDirectoryPromiseRef.current,
          new Promise<null>((r) => setTimeout(() => r(null), 700)),
        ])
        if (dir && dir[dni]) {
          setIsValidating(false)
          setConnectionError(false)
          applyValidationResult(dir[dni], dni)
          return
        }
      }
      let res: any = null
      let lastError: any = null

      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          res = await validateUserAction(dni, undefined, true)
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
      if (forceFreshExcel && res?.success) {
        toast.success("Horario actualizado en vivo desde el Excel de programación.")
      }
    } catch (error) {
      console.error("Error al validar DNI:", error)
      setConnectionError(true)
      toast.error("Error de conexión al validar. Puede reintentar o activar el Modo Local.")
    } finally {
      setIsValidating(false)
      setIsRefreshingSchedule(false)
    }
  }

  const handleAuthorizeKioskByCode = async () => {
    const cleanCode = kioskOneTimeCode.replace(/\D/g, "").trim()
    if (!cleanCode) {
      toast.error("Ingrese el código de verificación")
      return
    }
    setIsAuthorizingKiosk(true)
    try {
      const res = await authorizeKioskWithOneTimeCodeAction(cleanCode, kioskCampusSelect)
      if (res.success && res.kioskToken && res.campusName) {
        const cfg: KioskConfig = {
          token: res.kioskToken,
          campusName: res.campusName,
          authorizedAt: new Date().toISOString(),
        }
        localStorage.setItem(KIOSK_STORAGE_KEY, JSON.stringify(cfg))
        localStorage.removeItem(SAVED_DNI_STORAGE_KEY)
        setKioskConfig(cfg)
        setRememberDniOnDevice(false)
        setHasRememberedDni(false)
        setShowKioskModal(false)
        setKioskOneTimeCode("")
        toast.success(res.message, { duration: 6000 })
      } else {
        toast.error(res.message || "Código inválido o ya utilizado")
      }
    } catch {
      toast.error("Error de conexión al verificar el código")
    } finally {
      setIsAuthorizingKiosk(false)
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
        toast.error(res.message || "No se pudo autorizar la Estación Fija")
      }
    } catch {
      toast.error("Error de conexión al autorizar la Estación Fija")
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
    toast.info("Estación Fija desactivada en este equipo. Ahora opera en Modo Móvil con GPS.")
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

  // Resolución automática de la clase actual para Docentes y Pacientes Simulados según el JSON/Excel
  const isModuleRole =
    validatedUser?.role === Role.DOCENTE || validatedUser?.role === Role.PACIENTE_SIMULADO

  const moduleResolution =
    isModuleRole && dailyProgram?.found && dailyProgram.sessions.length > 0
      ? resolveUserModulesState(
          dailyProgram.sessions,
          todayRecords,
          currentLimaMins,
          validatedUser?.role
        )
      : null

  const effectiveActiveModule = moduleResolution?.activeModule ?? null

  // Aviso de fin de clase y rotación EXCLUSIVO para teléfonos (!kioskConfig), nunca en Estaciones Oficiales (PC fijas)
  const mobileRotationAlert = buildMobileRotationAlertPayload(
    moduleResolution,
    Boolean(kioskConfig),
    validatedUser?.role
  )

  const currentRotationAlertKey =
    mobileRotationAlert.shouldAlert && validatedUser && mobileRotationAlert.currentModule
      ? `${validatedUser.id}_${mobileRotationAlert.reason}_${mobileRotationAlert.currentModule.moduleNumber}_${mobileRotationAlert.nextModule?.moduleNumber ?? 0}`
      : null

  useEffect(() => {
    if (
      kioskConfig ||
      !mobileRotationAlert.shouldAlert ||
      !currentRotationAlertKey ||
      firedNotificationsRef.current.has(currentRotationAlertKey)
    ) {
      return
    }

    firedNotificationsRef.current.add(currentRotationAlertKey)

    // Disparar sonido + vibración en el teléfono
    playRotationAlertSoundAndVibrate()

    // Mostrar notificación toast persistente en el teléfono
    toast.warning(mobileRotationAlert.title, {
      description: mobileRotationAlert.message,
      duration: 12000,
    })

    // Disparar Notificación Nativa de Sistema (Heads-up / Banner flotante sobre otras apps y pantalla bloqueada)
    void showSystemNotification({
      title: mobileRotationAlert.title,
      message: mobileRotationAlert.message,
      tag: currentRotationAlertKey,
      url: "/",
    })
  }, [kioskConfig, mobileRotationAlert.shouldAlert, currentRotationAlertKey])

  // Sincronizar suscripción Web Push + alarmas de fin de módulo en el Service Worker del teléfono
  useEffect(() => {
    if (kioskConfig || !validatedUser || !isModuleRole) return

    if (watchDni?.length === 8) {
      void subscribeDeviceToWebPush({
        dni: watchDni,
        userId: validatedUser.id,
        userName: validatedUser.name,
        role: validatedUser.role,
        campusName:
          effectiveActiveModule?.campusName ||
          (dailyProgram?.found ? dailyProgram.campusName : null) ||
          validatedUser.campusName ||
          "Campus Villa",
      })
    }

    if (moduleResolution && moduleResolution.modules.length > 0) {
      void syncModuleAlarmsWithServiceWorker({
        userId: validatedUser.id,
        role: validatedUser.role,
        modules: moduleResolution.modules,
        currentLimaMinutes: currentLimaMins,
      })
    }
  }, [
    kioskConfig,
    validatedUser?.id,
    validatedUser?.role,
    isModuleRole,
    watchDni,
    moduleResolution,
    currentLimaMins,
  ])

  const onSubmit = async (data: z.infer<typeof formSchema>, type: RecordType) => {
    if (!validatedUser && !isOffline && !isContingencyMode) {
      toast.error("Debe ingresar un DNI válido primero")
      return
    }

    // Si marca desde su celular personal y es Docente o Paciente Simulado, solicitar permiso de notificación para avisos de rotación
    if (!kioskConfig && isModuleRole) {
      void requestMobileNotificationPermission()
    }

    const isKioskAuthorized = Boolean(kioskConfig?.token)
    const detectedRole = validatedUser?.role || Role.TECNICO
    const resolvedCampus =
      technicianAssignment?.campusName ||
      effectiveActiveModule?.campusName ||
      (dailyProgram?.found ? dailyProgram.campusName : null) ||
      validatedUser?.campusName ||
      kioskConfig?.campusName ||
      "Campus Villa"
    const resolvedCourse =
      effectiveActiveModule?.courseName ||
      (dailyProgram?.found ? dailyProgram.courseName : undefined)
    const resolvedExpectedEntry =
      detectedRole === Role.TECNICO
        ? technicianAssignment?.expectedEntryTime
        : effectiveActiveModule?.horaInicio ||
          (dailyProgram?.found ? dailyProgram.entryTime : undefined)

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
    const previousTodayRecords = [...todayRecords]

    const optimisticEntry: TodayAttendanceRecordLite = {
      type,
      timestamp: new Date().toISOString(),
      courseName: resolvedCourse || null,
    }
    const updatedTodayRecords = [...todayRecords, optimisticEntry]

    if (directoryRef.current && directoryRef.current[data.dni]) {
      directoryRef.current[data.dni] = {
        ...directoryRef.current[data.dni],
        lastRecordType: type,
        todayRecords: updatedTodayRecords,
      }
    }
    setTodayLastRecord(type)
    setTodayRecords(updatedTodayRecords)

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
              todayRecords: previousTodayRecords,
            }
          }
          setTodayLastRecord(previousLastRecord)
          setTodayRecords(previousTodayRecords)
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
    <div className="bg-white rounded-2xl sm:rounded-3xl md:rounded-[2rem] p-4 sm:p-6 md:p-10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.55)] w-full relative overflow-hidden transition-all duration-500">
      <div className="absolute top-0 left-0 w-full h-2 sm:h-2.5 bg-gradient-to-r from-blue-400 to-[#1967D2]"></div>

      {/* Barra Superior: Estado de Red + Modo Híbrido (Estación Fija vs Celular GPS) */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 mb-4 sm:mb-6 p-2 sm:p-2.5 rounded-xl sm:rounded-2xl bg-slate-50 border border-slate-200/80 text-[11px] sm:text-xs">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {isOffline ? (
            <span className="flex items-center gap-1 sm:gap-1.5 font-black text-rose-600 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200">
              <WifiOff size={13} /> Sin Conexión
            </span>
          ) : isContingencyMode ? (
            <span className="flex items-center gap-1 sm:gap-1.5 font-black text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
              <ShieldCheck size={13} className="text-amber-600" /> Contingencia Local
            </span>
          ) : (
            <span className="flex items-center gap-1 sm:gap-1.5 font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              <Wifi size={13} className="text-emerald-600" /> En Línea
            </span>
          )}

          {/* Indicador del Modo Híbrido actual */}
          {kioskConfig ? (
            <span className="flex items-center gap-1 sm:gap-1.5 font-black text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-200">
              <MonitorCheck size={13} className="text-indigo-600" /> Estación Oficial: {kioskConfig.campusName}
            </span>
          ) : (
            <>
              {gpsStatus === "inside" && (
                <span className="flex items-center gap-1 sm:gap-1.5 font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  <Navigation size={12} className="text-emerald-600" /> En {gpsCampusDetected || "Campus"}
                </span>
              )}
              {gpsStatus === "locating" && (
                <span className="flex items-center gap-1 sm:gap-1.5 font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
                  <Loader2 size={12} className="animate-spin text-[#1967D2]" /> Verificando ubicación...
                </span>
              )}
              {gpsStatus === "outside" && (
                <span className="flex items-center gap-1 sm:gap-1.5 font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                  <MapPin size={12} className="text-amber-600" /> Fuera del campus
                </span>
              )}
              {gpsStatus === "denied" && (
                <span className="flex items-center gap-1 sm:gap-1.5 font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200">
                  <MapPin size={12} className="text-rose-600" /> Active el GPS
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 ml-auto sm:ml-0">
          {pendingOfflineCount > 0 && (
            <button
              type="button"
              onClick={syncOfflineRecords}
              className="flex items-center gap-1 font-black text-[#1967D2] hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-full border border-blue-200 transition-colors cursor-pointer"
              title="Sincronizar registros guardados en la memoria del dispositivo con la base de datos"
            >
              <RefreshCw size={11} className="animate-spin" />
              {pendingOfflineCount} pend.
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowKioskModal((prev) => !prev)}
            aria-label="Configuración administrativa"
            className="p-1 rounded-full text-slate-300 opacity-25 hover:opacity-80 hover:text-slate-500 transition-opacity cursor-pointer"
          >
            <Lock size={10} />
          </button>
        </div>
      </div>

      {/* Panel desplegable de Autorización de Estación Fija (Solo Administradores Autorizados) */}
      {showKioskModal && (
        <div className="mb-4 sm:mb-6 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl bg-slate-50 border-2 border-indigo-200 space-y-3 animate-fade-in-up">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <MonitorCheck size={17} className="text-indigo-600 shrink-0" />
              <h3 className="text-xs sm:text-sm font-black text-slate-800 truncate">
                {kioskConfig
                  ? `Estación Oficial: ${kioskConfig.campusName}`
                  : "Vincular Equipo como Estación Oficial"}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowKioskModal(false)
                setKioskAuthMethod("code")
              }}
              className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0 p-1"
            >
              <X size={16} />
            </button>
          </div>

          {kioskConfig ? (
            <div className="space-y-3 text-xs text-slate-600">
              <p>
                Este equipo está vinculado como <strong>Estación Oficial en {kioskConfig.campusName}</strong>. No requiere permisos de GPS y limpia el DNI automáticamente tras cada registro.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDeactivateKiosk}
                className="h-9 rounded-xl font-bold text-rose-600 border-rose-200 hover:bg-rose-50 cursor-pointer w-full sm:w-auto"
              >
                Desvincular Estación Oficial en este equipo
              </Button>
            </div>
          ) : kioskAuthMethod === "code" ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Ingrese el <strong>código de activación</strong> de Estación Oficial. La sede asignada al código se configurará automáticamente.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="Código de 6 dígitos (ej. 482915)"
                  maxLength={6}
                  inputMode="numeric"
                  value={kioskOneTimeCode}
                  onChange={(e) => setKioskOneTimeCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handleAuthorizeKioskByCode()
                    }
                  }}
                  className="h-10 text-sm font-black tracking-[0.3em] text-center sm:text-left bg-white flex-1"
                />
                {kioskOneTimeCode === "262026" && (
                  <select
                    value={kioskCampusSelect}
                    onChange={(e) => setKioskCampusSelect(e.target.value)}
                    className="h-10 rounded-md border border-indigo-200 bg-white px-3 text-xs sm:text-sm font-bold text-slate-800 shrink-0"
                  >
                    <option value="Campus Villa">Campus Villa</option>
                    <option value="Campus Norte">Campus Norte</option>
                    <option value="Campus Ate">Campus Ate</option>
                    <option value="Campus Aramburú">Campus Aramburú</option>
                  </select>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={isAuthorizingKiosk}
                  onClick={handleAuthorizeKioskByCode}
                  className="h-10 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs cursor-pointer shrink-0"
                >
                  {isAuthorizingKiosk ? (
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                  ) : (
                    <MonitorCheck size={14} className="mr-1.5" />
                  )}
                  Verificar Código
                </Button>
              </div>
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={() => setKioskAuthMethod("credentials")}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline underline-offset-2 cursor-pointer"
                >
                  Cambiar a Usuario y Contraseña →
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Ingrese sus credenciales de Super Admin (o administrador con permiso de Estación Fija) y elija la sede de este equipo:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input
                  placeholder="Usuario o DNI Admin"
                  value={kioskAdminUser}
                  onChange={(e) => setKioskAdminUser(e.target.value)}
                  className="h-9 sm:h-10 text-xs sm:text-sm bg-white"
                />
                <Input
                  type="password"
                  placeholder="Contraseña Admin"
                  value={kioskAdminPass}
                  onChange={(e) => setKioskAdminPass(e.target.value)}
                  className="h-9 sm:h-10 text-xs sm:text-sm bg-white"
                />
                <select
                  value={kioskCampusSelect}
                  onChange={(e) => setKioskCampusSelect(e.target.value)}
                  className="h-9 sm:h-10 rounded-md border border-slate-200 bg-white px-3 text-xs sm:text-sm font-semibold text-slate-800"
                >
                  <option value="Campus Villa">Campus Villa</option>
                  <option value="Campus Norte">Campus Norte</option>
                  <option value="Campus Ate">Campus Ate</option>
                  <option value="Campus Aramburú">Campus Aramburú</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => setKioskAuthMethod("code")}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline underline-offset-2 cursor-pointer"
                >
                  ← Usar código de un solo uso
                </button>
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
                  Vincular con Credenciales
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="text-center mb-4 sm:mb-6">
        <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-slate-800 tracking-wide">
          Registro de Asistencia
        </h2>
        <p className="text-slate-500 text-[11px] sm:text-xs md:text-sm font-medium mt-0.5 sm:mt-1 px-1">
          Ingrese su DNI para identificar su rol, sede, horario y ambiente asignado
        </p>
      </div>

      <Form {...form}>
        <form className="space-y-4 sm:space-y-6" onSubmit={(e) => e.preventDefault()}>
          <FormField
            control={form.control}
            name="dni"
            render={({ field }) => (
              <FormItem>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2">
                  <FormLabel className="text-slate-500 text-[11px] sm:text-xs font-bold uppercase tracking-widest">
                    Número de DNI
                  </FormLabel>

                  {/* En celulares personales: mostrar si el DNI está recordado y opción de cambiarlo */}
                  {!kioskConfig && (
                    <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 sm:gap-3">
                      <label className="flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-slate-500 cursor-pointer select-none">
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
                          className="rounded border-slate-300 text-[#1967D2] focus:ring-[#1967D2] w-3.5 h-3.5"
                        />
                        <Smartphone size={12} className="text-[#1967D2] shrink-0" />
                        <span>Recordar mi DNI</span>
                      </label>

                      {hasRememberedDni && watchDni?.length > 0 && (
                        <button
                          type="button"
                          onClick={() => clearOrResetForm(true)}
                          className="flex items-center gap-1 text-[11px] sm:text-xs font-bold text-[#1967D2] hover:text-blue-800 cursor-pointer"
                          title="Borrar DNI guardado para ingresar otro"
                        >
                          <UserX size={12} /> Cambiar DNI
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <FormControl>
                  <div className="relative">
                    <Search className="absolute left-3.5 sm:left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <Input
                      placeholder="Ingrese sus 8 dígitos"
                      maxLength={8}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      enterKeyHint="done"
                      autoComplete="off"
                      className="h-14 sm:h-16 md:h-20 pl-10 sm:pl-14 pr-10 sm:pr-14 bg-slate-50 border-2 border-slate-200 text-slate-900 text-xl sm:text-2xl font-black tracking-[0.22em] sm:tracking-[0.4em] rounded-xl focus-visible:ring-[#1967D2] focus-visible:border-[#1967D2] transition-all placeholder:text-slate-300 placeholder:tracking-normal placeholder:font-medium placeholder:text-sm sm:placeholder:text-lg"
                      {...field}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "")
                        field.onChange(val)
                      }}
                    />
                    {isValidating && (
                      <Loader2 className="absolute right-3.5 sm:right-5 top-1/2 -translate-y-1/2 text-[#1967D2] animate-spin" size={22} />
                    )}
                    {validatedUser && !isValidating && (
                      <UserCheck className="absolute right-3.5 sm:right-5 top-1/2 -translate-y-1/2 text-emerald-500" size={24} />
                    )}
                  </div>
                </FormControl>

                {/* Pantalla de carga mientras el sistema analiza el DNI y su programación */}
                {isValidating && (
                  <div className="mt-3 sm:mt-4 rounded-xl sm:rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50/90 to-indigo-50/70 p-4 sm:p-6 flex flex-col items-center justify-center gap-2 sm:gap-3 text-center animate-fade-in-up">
                    <Loader2 size={26} className="text-[#1967D2] animate-spin" />
                    <div className="space-y-0.5">
                      <p className="text-xs sm:text-sm font-black text-slate-800">
                        Analizando DNI y programación del día...
                      </p>
                      <p className="text-[11px] sm:text-xs font-medium text-slate-500">
                        Verificando rol, horario, sede y ambiente asignado
                      </p>
                    </div>
                  </div>
                )}

                {/* Alerta de error de conexión con opción de Modo Contingencia Local */}
                {connectionError && !isValidating && (
                  <div className="rounded-xl sm:rounded-2xl border border-amber-300 bg-amber-50/90 p-3 sm:p-4 text-xs space-y-2 mt-3 animate-fade-in-up shadow-xs">
                    <div className="flex items-center gap-2 font-black text-amber-900">
                      <WifiOff size={15} className="text-amber-700 shrink-0" />
                      <span>Problema de conexión con el servidor en esta red</span>
                    </div>
                    <p className="text-amber-800 leading-relaxed font-medium text-[11px] sm:text-xs">
                      Ocurrió un problema de enlace o lentitud en la red. Para no retrasar su marcación ni perder su hora oficial, puede activar el <strong>Modo Local</strong> o reintentar.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => validateDni(watchDni, 2)}
                        disabled={isValidating}
                        className="h-8 sm:h-9 px-3 sm:px-4 rounded-xl font-black bg-amber-600 hover:bg-amber-700 text-white shadow-xs text-xs"
                      >
                        <RefreshCw size={13} className={`mr-1.5 ${isValidating ? "animate-spin" : ""}`} /> Reintentar
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
                        className="h-8 sm:h-9 px-3 sm:px-4 rounded-xl font-black border-amber-400 bg-white text-amber-900 hover:bg-amber-100 shadow-xs text-xs"
                      >
                        <ShieldCheck size={13} className="mr-1.5 text-emerald-600" /> Marcar en Modo Local
                      </Button>
                    </div>
                  </div>
                )}

                {/* Resumen de Información al validar el DNI */}
                {validatedUser && !isValidating && roleMeta && (
                  <div
                    className={`mt-3 sm:mt-4 rounded-xl sm:rounded-2xl border-2 ${roleMeta.borderClass} bg-gradient-to-br ${roleMeta.accentBg} p-3 sm:p-5 space-y-2.5 sm:space-y-4 animate-fade-in-up shadow-xs`}
                  >
                    {/* Cabecera: Quién está marcando + Rol detectado */}
                    <div className="flex items-center justify-between gap-2 pb-2 sm:pb-3 border-b border-slate-200/80">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl bg-white shadow-xs border border-slate-200/80 flex items-center justify-center shrink-0">
                          <BadgeCheck size={18} className="text-emerald-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Colaborador Identificado
                          </p>
                          <p className="text-sm sm:text-base md:text-lg font-black text-slate-900 truncate">
                            {validatedUser.name}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] sm:text-xs font-black uppercase tracking-wider sm:tracking-widest px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full shadow-xs shrink-0 ${roleMeta.badgeClass}`}
                      >
                        {roleMeta.label}
                      </span>
                    </div>

                    {/* CASO 1: Resumen para TÉCNICOS (Quién marca, Hora que marca / turno y Sede) */}
                    {validatedUser.role === Role.TECNICO && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        <div className="bg-white/90 rounded-lg sm:rounded-xl p-2.5 sm:p-3.5 border border-slate-200/70 flex items-start gap-2.5 sm:gap-3">
                          <Clock size={16} className="text-indigo-600 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Hora de Marcación y Turno
                            </p>
                            <p className="text-xs sm:text-sm font-black text-slate-800">
                              Marcando: <LiveMarkingTimeSpan className="text-indigo-700" />
                            </p>
                            {technicianAssignment && (
                              <p className="text-[11px] sm:text-xs font-semibold text-slate-600 mt-0.5">
                                Turno {SHIFT_LABELS[technicianAssignment.shift] || technicianAssignment.shift}:{" "}
                                <span className="font-bold text-slate-800">
                                  {technicianAssignment.expectedEntryTime} — {technicianAssignment.expectedExitTime || "15:00"}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="bg-white/90 rounded-lg sm:rounded-xl p-2.5 sm:p-3.5 border border-slate-200/70 flex items-start gap-2.5 sm:gap-3">
                          <MapPin size={16} className="text-indigo-600 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                              Sede Asignada
                            </p>
                            <p className="text-xs sm:text-sm font-black text-slate-800">
                              {technicianAssignment?.campusName || validatedUser.campusName || "Campus Villa"}
                            </p>
                            <p className="text-[11px] sm:text-xs font-medium text-slate-500 mt-0.5">
                              {technicianAssignment?.source === "SCHEDULE" ? "Según cronograma del día" : "Sede base asignada"}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CASO 2: Resumen para DOCENTES y PACIENTES SIMULADOS */}
                    {(validatedUser.role === Role.DOCENTE || validatedUser.role === Role.PACIENTE_SIMULADO) && (
                      <div className="space-y-2.5 sm:space-y-3.5">
                        {/* AVISO DE ACTIVACIÓN SOLO LA PRIMERA VEZ EN EL CELULAR */}
                        {!kioskConfig && dailyProgram?.found && !mobileAlarmOnboarded && (
                          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-[11px] sm:text-xs animate-fade-in-up">
                            <div className="flex items-center gap-2 text-slate-700 font-semibold">
                              <BellRing size={14} className="text-[#1967D2] shrink-0" />
                              <span>
                                Active las notificaciones del sistema para recibir avisos sobre otras apps o con el teléfono bloqueado
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                void requestMobileNotificationPermission()
                                playRotationAlertSoundAndVibrate()
                              }}
                              className="px-3 py-1 rounded-lg bg-[#1967D2] hover:bg-[#124b9c] text-white font-black text-[11px] cursor-pointer shrink-0"
                            >
                              Activar avisos
                            </button>
                          </div>
                        )}

                        {/* AVISO DE FIN DE CLASE Y ROTACIÓN (EXCLUSIVO EN CELULARES, NUNCA EN ESTACIÓN FIJA PC) */}
                        {!kioskConfig &&
                          mobileRotationAlert.shouldAlert &&
                          dismissedRotationAlertKey !== currentRotationAlertKey && (
                            <div className="rounded-xl sm:rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 p-3 sm:p-4 shadow-sm space-y-2 animate-fade-in-up">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 animate-bounce">
                                    <BellRing size={17} />
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="text-xs sm:text-sm font-black text-amber-950 leading-snug">
                                      {mobileRotationAlert.title}
                                    </h4>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setDismissedRotationAlertKey(currentRotationAlertKey)}
                                  className="text-amber-700 hover:text-amber-950 p-1 cursor-pointer shrink-0"
                                  title="Ocultar aviso"
                                >
                                  <X size={15} />
                                </button>
                              </div>

                              <p className="text-[11px] sm:text-xs font-semibold text-amber-900 leading-relaxed">
                                {mobileRotationAlert.message}
                              </p>

                              {mobileRotationAlert.nextModule && (
                                <div className="bg-white/95 rounded-xl p-2.5 sm:p-3 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="space-y-0.5 min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-amber-700 flex items-center gap-1">
                                      <ArrowRight size={12} /> Siguiente Ambiente
                                    </p>
                                    <p className="text-xs sm:text-sm font-black text-slate-900">
                                      {mobileRotationAlert.nextAmbiente}
                                      {mobileRotationAlert.nextModule.piso
                                        ? ` • ${mobileRotationAlert.nextModule.piso}`
                                        : ""}
                                    </p>
                                    <p className="text-[11px] font-bold text-slate-600">
                                      Horario: {mobileRotationAlert.nextHorario} •{" "}
                                      {mobileRotationAlert.nextModule.courseName}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                        {/* Barra rápida: Actualizar horario desde Excel en vivo + Probar aviso con app cerrada */}
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/80 border border-slate-200/80 text-[11px] sm:text-xs">
                          <div className="flex items-center gap-1.5 text-slate-600 font-semibold">
                            <RefreshCw
                              size={12}
                              className={isRefreshingSchedule ? "animate-spin text-[#1967D2]" : "text-emerald-600"}
                            />
                            <span>
                              {isRefreshingSchedule
                                ? "Consultando cambios recientes en el Excel..."
                                : "Sincronizado con el Excel del día"}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isRefreshingSchedule}
                              onClick={() => validateDni(watchDni, 1, true)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                              title="Volver a consultar el Excel en vivo para detectar modificaciones de último momento"
                            >
                              <RefreshCw size={11} className={isRefreshingSchedule ? "animate-spin" : ""} />
                              Actualizar Excel
                            </button>
                            {!kioskConfig && (
                              <button
                                type="button"
                                disabled={isTestingClosedAlert}
                                onClick={handleTestClosedAppNotification}
                                className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-[#1967D2] border border-blue-200 font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                                title="Envía una notificación en 5 segundos para comprobar que suena con la app cerrada o pantalla bloqueada"
                              >
                                <BellRing size={11} />
                                {isTestingClosedAlert ? "Enviando en 5s..." : "Probar con app cerrada (5s)"}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Información necesaria: Hora que marca, Sede, Ambiente que le toca y Curso */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                          {/* Hora de marcación y Horario actual */}
                          <div className="bg-white/90 rounded-lg sm:rounded-xl p-2.5 sm:p-3.5 border border-slate-200/70 flex items-start gap-2.5 sm:gap-3">
                            <Clock size={16} className="text-[#1967D2] mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                Hora y Turno de Hoy
                              </p>
                              <p className="text-xs sm:text-sm font-black text-slate-800">
                                Marcando: <LiveMarkingTimeSpan className="text-[#1967D2]" />
                              </p>
                              {effectiveActiveModule ? (
                                <p className="text-[11px] sm:text-xs font-semibold text-slate-600 mt-0.5">
                                  Horario:{" "}
                                  <span className="font-black text-slate-900">
                                    {effectiveActiveModule.horaInicio} a {effectiveActiveModule.horaFin}
                                  </span>
                                </p>
                              ) : dailyProgram?.found ? (
                                <p className="text-[11px] sm:text-xs font-semibold text-slate-600 mt-0.5">
                                  Horario:{" "}
                                  <span className="font-black text-slate-900">
                                    {dailyProgram.entryTime} a {dailyProgram.exitTime}
                                  </span>
                                </p>
                              ) : (
                                <p className="text-[11px] sm:text-xs font-medium text-amber-700 mt-0.5">
                                  Sin horario en lista de hoy
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Sede */}
                          <div className="bg-white/90 rounded-lg sm:rounded-xl p-2.5 sm:p-3.5 border border-slate-200/70 flex items-start gap-2.5 sm:gap-3">
                            <MapPin size={16} className="text-[#1967D2] mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                Sede Asignada
                              </p>
                              <p className="text-xs sm:text-sm font-black text-slate-800">
                                {effectiveActiveModule?.campusName ||
                                  (dailyProgram?.found ? dailyProgram.campusName : null) ||
                                  validatedUser.campusName ||
                                  "Campus Villa"}
                              </p>
                              {(effectiveActiveModule?.piso || (dailyProgram?.found && dailyProgram.piso)) && (
                                <p className="text-[11px] sm:text-xs font-medium text-slate-500 mt-0.5 truncate">
                                  {effectiveActiveModule?.piso || dailyProgram?.piso}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Ambiente que le toca en ese momento (solo nombre después de ':') */}
                          <div className="bg-white/90 rounded-lg sm:rounded-xl p-2.5 sm:p-3.5 border border-slate-200/70 flex items-start gap-2.5 sm:gap-3">
                            <DoorOpen size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                Ambiente Asignado
                              </p>
                              <p className="text-xs sm:text-sm font-black text-slate-800 break-words leading-snug">
                                {effectiveActiveModule
                                  ? effectiveActiveModule.ambiente.replace(/^[^:]+:\s*/, "")
                                  : dailyProgram?.found
                                    ? dailyProgram.ambiente.replace(/^[^:]+:\s*/, "")
                                    : "Por asignar en sede"}
                              </p>
                            </div>
                          </div>

                          {/* Curso / Sesión que le toca en ese momento */}
                          <div className="bg-white/90 rounded-lg sm:rounded-xl p-2.5 sm:p-3.5 border border-slate-200/70 flex items-start gap-2.5 sm:gap-3">
                            <BookOpen size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                Curso / Sesión de Ingreso
                              </p>
                              <p className="text-xs sm:text-sm font-black text-slate-800 break-words leading-snug">
                                {effectiveActiveModule
                                  ? effectiveActiveModule.courseName
                                  : dailyProgram?.found
                                    ? dailyProgram.courseName
                                    : "General"}
                              </p>
                              {(effectiveActiveModule?.sesion || (dailyProgram?.found && dailyProgram.sesion)) && (
                                <p
                                  className="text-[11px] sm:text-xs font-medium text-slate-500 mt-0.5 truncate"
                                  title={effectiveActiveModule?.sesion || dailyProgram?.sesion}
                                >
                                  {effectiveActiveModule?.sesion || dailyProgram?.sesion}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <FormMessage className="text-xs sm:text-sm font-medium" />
              </FormItem>
            )}
          />

          {/* Botón de Marcación ENTRADA / SALIDA */}
          {(() => {
            const isLoadingState = todayLastRecord === "loading" || isValidating
            const lastType = isLoadingState ? null : (todayLastRecord as RecordType | null)
            const showEntrada = moduleResolution
              ? moduleResolution.nextAction === "ENTRADA"
              : lastType !== RecordType.ENTRADA
            const showSalida = moduleResolution
              ? moduleResolution.nextAction === "SALIDA"
              : lastType === RecordType.ENTRADA

            const isButtonDisabled =
              (!validatedUser && !isOffline && !isContingencyMode) || isSubmitting !== null || isLoadingState

            return (
              <div className="grid grid-cols-1 gap-3 sm:gap-4 pt-1 sm:pt-2">
                {showEntrada && (
                  <Button
                    type="button"
                    disabled={isButtonDisabled}
                    onClick={form.handleSubmit((d) => onSubmit(d, RecordType.ENTRADA))}
                    className="h-14 sm:h-16 md:h-20 rounded-xl bg-[#1967D2] hover:bg-[#124b9c] text-white font-black text-base sm:text-lg md:text-xl shadow-[0_10px_20px_-5px_rgba(25,103,210,0.5)] hover:shadow-[0_15px_25px_-5px_rgba(25,103,210,0.7)] transition-all hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none cursor-pointer"
                  >
                    {isLoadingState ? (
                      <Loader2 size={22} className="animate-spin mr-2" />
                    ) : isSubmitting === RecordType.ENTRADA ? (
                      <Loader2 size={22} className="animate-spin mr-2" />
                    ) : (
                      <LogIn size={22} className="mr-2" />
                    )}
                    {isLoadingState ? "ANALIZANDO..." : "MARCAR ENTRADA"}
                  </Button>
                )}

                {showSalida && (
                  <Button
                    type="button"
                    disabled={isButtonDisabled}
                    onClick={form.handleSubmit((d) => onSubmit(d, RecordType.SALIDA))}
                    className="h-14 sm:h-16 md:h-20 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-black text-base sm:text-lg md:text-xl shadow-[0_10px_20px_-5px_rgba(15,23,42,0.5)] hover:shadow-[0_15px_25px_-5px_rgba(15,23,42,0.7)] transition-all hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none cursor-pointer"
                  >
                    {isSubmitting === RecordType.SALIDA ? (
                      <Loader2 size={22} className="animate-spin mr-2" />
                    ) : (
                      <LogOut size={22} className="mr-2" />
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
