"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Role, RecordType, Shift } from "@prisma/client"
import { validateUserAction, registerAttendanceAction, syncOfflineRecordsAction, getTodayAttendanceStateAction } from "@/actions/attendance"
import { getTodayTechnicianAssignmentAction } from "@/actions/schedules"
import { toast } from "sonner"
import {
  Loader2, LogIn, LogOut, Search, UserCheck, CheckCircle2, WifiOff,
  Wifi, RefreshCw, ShieldCheck, AlertCircle, AlertTriangle
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { checkGeofence, detectAndValidateCampus, isGeoActive, type GeoCampus } from "@/lib/geofence"

const formSchema = z.object({
  role: z.nativeEnum(Role, { required_error: "Seleccione un rol" }),
  campusId: z.string().optional(),
  courseId: z.string().optional(),
  dni: z.string().length(8, "El DNI debe tener 8 dígitos numéricos").regex(/^\d+$/, "Solo números"),
})

const DEFAULT_CAMPUSES = [
  "Campus Villa",
  "Campus Norte",
  "Campus Aramburú",
  "Campus Ate"
]

const DEFAULT_COURSES = [
  "Simulación Quirúrgica",
  "Simulación Clínica Integrada (SCI)",
  "Semiología Basada en Simulación (SBS)",
  "Simulación Ginecológica",
  "Simulación Pediátrica",
  "Externado de Cirugía",
  "Externado de Medicina",
  "Externado de Pediatría",
  "Externado de Ginecología",
  "Primeros Auxilios",
  "Medicina Legal",
  "Ecografía",
  "Otros"
]

interface AttendanceFormProps {
  campuses?: (Partial<GeoCampus> & { id: string; name: string })[]
  courses?: { id: string; name: string }[]
}

export default function AttendanceForm({ campuses: propCampuses, courses: propCourses }: AttendanceFormProps = {}) {
  const [isValidating, setIsValidating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState<RecordType | null>(null)
  const [validatedUser, setValidatedUser] = useState<{
    id: string
    name: string
    campusId?: string | null
    campusName?: string | null
    defaultShift?: string | null
  } | null>(null)
  const [technicianAssignment, setTechnicianAssignment] = useState<{
    campusName: string | null
    shift: string
    expectedEntryTime: string
    source: "SCHEDULE" | "DEFAULT_PROFILE"
  } | null>(null)
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [todayLastRecord, setTodayLastRecord] = useState<RecordType | null | "loading">(null)

  const [isContingencyMode, setIsContingencyMode] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0)
  const [selectResetKey, setSelectResetKey] = useState(0)

  const availableCampuses = (propCampuses && propCampuses.length > 0)
    ? propCampuses.map(c => c.name)
    : DEFAULT_CAMPUSES

  const availableCourses = (propCourses && propCourses.length > 0)
    ? propCourses.map(c => c.name)
    : DEFAULT_COURSES

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      role: Role.DOCENTE,
      dni: "",
    },
  })

  // Detección y Sincronización Offline
  const syncOfflineRecords = async () => {
    if (typeof window === "undefined") return
    const localData = localStorage.getItem('offline_records')
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
        localStorage.removeItem('offline_records')
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
      const localData = localStorage.getItem('offline_records')
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

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    if (typeof window !== "undefined" && navigator.onLine) {
      syncOfflineRecords()
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const watchRole = form.watch("role")
  const watchDni = form.watch("dni")
  const showExtraFields = watchRole === Role.DOCENTE || watchRole === Role.PACIENTE_SIMULADO

  const resetFormPreservingRole = (roleToKeep: Role) => {
    form.reset({
      role: roleToKeep,
      dni: "",
      campusId: undefined,
      courseId: undefined,
    })
    setSelectResetKey((prev) => prev + 1)
    setValidatedUser(null)
    setTodayLastRecord(null)
    setTechnicianAssignment(null)
    setSelectedShift(null)
    setConnectionError(false)
  }

  const handleRoleChange = (newRole: Role) => {
    if (newRole === watchRole) return
    form.setValue("role", newRole)
    form.setValue("dni", "")
    form.setValue("campusId", undefined)
    form.setValue("courseId", undefined)
    setSelectResetKey((prev) => prev + 1)
    setValidatedUser(null)
    setTodayLastRecord(null)
    setTechnicianAssignment(null)
    setSelectedShift(null)
    setConnectionError(false)
  }

  useEffect(() => {
    if (watchDni?.length === 8) {
      validateDni(watchDni, watchRole)
    } else {
      setValidatedUser(null)
      setTodayLastRecord(null)
      setConnectionError(false)
    }
  }, [watchDni, watchRole])

  const validateDni = async (dni: string, role: Role, retryAttempts = 1) => {
    if (isOffline || isContingencyMode) {
      setValidatedUser({ id: `offline_${dni}`, name: `Usuario DNI: ${dni} (Modo Local)` })
      setTodayLastRecord(null)
      setTechnicianAssignment(null)
      setConnectionError(false)
      return
    }

    setIsValidating(true)
    setConnectionError(false)

    try {
      let res: any = null
      let lastError: any = null

      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          res = await validateUserAction(dni, role)
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
        toast.success(`Usuario encontrado: ${res.user.name}`)

        // Asignación de técnico recibida directamente en 1 roundtrip
        if (role === Role.TECNICO && res.technicianAssignment) {
          setTechnicianAssignment(res.technicianAssignment)
          setSelectedShift((res.technicianAssignment.shift as Shift) || null)
          if (res.technicianAssignment.campusName) {
            form.setValue("campusId", res.technicianAssignment.campusName)
          }
        } else {
          setTechnicianAssignment(null)
          setSelectedShift(null)
        }

        // Estado del día recibido directamente
        setTodayLastRecord(res.lastRecordType ?? null)
        setConnectionError(false)
      } else {
        setValidatedUser(null)
        setTodayLastRecord(null)
        setTechnicianAssignment(null)
        setSelectedShift(null)
        toast.error(res.message || "Usuario no encontrado")
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
          // Reintentar sin highAccuracy (usando red/antenas) si el satélite GPS tarda mucho
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
            (err) => reject(new Error("Tiempo de espera agotado al obtener el GPS. Asegúrese de tener el GPS activado.")),
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
            reject(new Error(
              err.code === err.PERMISSION_DENIED
                ? "Debe permitir el acceso a su ubicación para marcar asistencia."
                : "No se pudo obtener su ubicación GPS. Active el GPS o acérquese a una ventana."
            ))
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

    if (showExtraFields && (!data.campusId || !data.courseId)) {
      toast.error("Por favor seleccione Sede y Curso")
      return
    }

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

    // Validación y detección multisede por GPS para todos los roles
    if (!isOffline && !isContingencyMode) {
      try {
        location = await getLocation()
      } catch (e: any) {
        toast.error(e.message || "Se requiere acceso a su ubicación GPS para registrar la asistencia.", { duration: 6000 })
        setIsSubmitting(null)
        return
      }

      const geoResult = detectAndValidateCampus(location, geoCampuses)
      if (!geoResult.allowed) {
        toast.error(geoResult.error || "Ubicación fuera del perímetro de las sedes autorizadas.", { duration: 8000 })
        setIsSubmitting(null)
        return
      }

      detectedCampusName = geoResult.detectedCampusName || undefined
    }

    const targetCampusName = data.campusId || detectedCampusName || technicianAssignment?.campusName || validatedUser?.campusName || "Campus Villa"
    
    // Si está offline o en modo contingencia local por red inestable
    if (isOffline || isContingencyMode) {
      const fallbackCampus = targetCampusName || "Campus Villa"
      const newRecord = {
        dni: data.dni,
        role: data.role,
        type: type,
        campusId: fallbackCampus,
        courseId: data.courseId,
        location,
        timestamp: new Date().toISOString()
      }
      const localData = JSON.parse(localStorage.getItem('offline_records') || '[]')
      localData.push(newRecord)
      localStorage.setItem('offline_records', JSON.stringify(localData))
      setPendingOfflineCount(localData.length)

      toast.success(`✅ Marcación (${type === "ENTRADA" ? "Ingreso" : "Salida"}) guardada en la memoria local del dispositivo. Se sincronizará automáticamente.`, { duration: 7000 })
      resetFormPreservingRole(watchRole)
      setIsSubmitting(null)
      return
    }

    try {
      const res = await registerAttendanceAction({
        userId: validatedUser!.id,
        role: data.role,
        type: type,
        shift: selectedShift || undefined,
        campusId: targetCampusName, 
        courseId: data.courseId,
        clientTimestamp: new Date(),
        location,
        isOfflineSync: false 
      })

      if (res.success) {
        toast.success(res.message, { duration: 5000 })
        resetFormPreservingRole(watchRole)
      } else {
        toast.error(res.message)
      }
    } catch (error: any) {
      console.warn("Fallo de red en registro online, activando respaldo local:", error)
      // Respaldo automático local para que el colaborador no pierda su marcación ni su hora
      const fallbackCampus = targetCampusName || "Campus Villa"
      const newRecord = {
        dni: data.dni,
        role: data.role,
        type: type,
        campusId: fallbackCampus,
        courseId: data.courseId,
        location,
        timestamp: new Date().toISOString()
      }
      const localData = JSON.parse(localStorage.getItem('offline_records') || '[]')
      localData.push(newRecord)
      localStorage.setItem('offline_records', JSON.stringify(localData))
      setPendingOfflineCount(localData.length)

      toast.warning(`La red se interrumpió, pero su marcación (${type}) fue guardada de inmediato en el dispositivo y se sincronizará automáticamente.`, { duration: 8000 })
      resetFormPreservingRole(watchRole)
    } finally {
      setIsSubmitting(null)
    }
  }

  return (
    <div className="bg-white rounded-[2rem] p-8 md:p-10 shadow-[0_45px_75px_-15px_rgba(0,0,0,0.6)] w-full relative overflow-hidden transition-all duration-500 hover:-translate-y-2">
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

      <h2 className="text-2xl md:text-3xl font-black text-slate-800 mb-8 text-center tracking-wide">
        Registro de Asistencia
      </h2>

      <Form {...form}>
        <form className="space-y-8">
          
          {/* Selector de Rol de Usuario limpio con color diferencial por rol */}
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel className="text-slate-500 text-xs font-bold uppercase tracking-widest">
                  Rol del Usuario
                </FormLabel>

                <div className="grid grid-cols-3 gap-3">
                  {[
                    {
                      value: Role.DOCENTE,
                      title: "Docente",
                      activeClass: "bg-[#1967D2] text-white border-[#1967D2] shadow-sm",
                    },
                    {
                      value: Role.TECNICO,
                      title: "Técnico",
                      activeClass: "bg-indigo-600 text-white border-indigo-600 shadow-sm",
                    },
                    {
                      value: Role.PACIENTE_SIMULADO,
                      title: "Paciente Sim.",
                      activeClass: "bg-emerald-600 text-white border-emerald-600 shadow-sm",
                    },
                  ].map((r) => {
                    const isSelected = watchRole === r.value
                    return (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => {
                          field.onChange(r.value)
                          handleRoleChange(r.value)
                        }}
                        className={`w-full py-4 px-2 rounded-xl border-2 text-center text-sm md:text-base font-bold transition-all duration-200 cursor-pointer ${
                          isSelected
                            ? `${r.activeClass}`
                            : "bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200"
                        }`}
                      >
                        {r.title}
                      </button>
                    )
                  })}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {showExtraFields && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in-up">
              <FormField
                control={form.control}
                name="campusId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-500 text-xs font-bold uppercase tracking-widest">
                      Sede
                    </FormLabel>
                    <Select
                      key={`campus-select-${selectResetKey}`}
                      value={field.value || ""}
                      onValueChange={(val) => field.onChange(val || undefined)}
                    >
                      <FormControl>
                        <SelectTrigger className="h-16 text-lg font-normal bg-white border-2 border-slate-200 text-slate-800 rounded-xl focus:ring-[#1967D2] focus:border-[#1967D2]">
                          <SelectValue placeholder="Seleccione Sede" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false} side="bottom" sideOffset={4} className="bg-white text-slate-800 border-slate-200 rounded-xl text-xl max-h-[300px] overflow-y-auto">
                        {availableCampuses.map((cName) => (
                          <SelectItem key={cName} value={cName} className="py-3">
                            {cName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="courseId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-500 text-xs font-bold uppercase tracking-widest">
                      Curso
                    </FormLabel>
                    <Select
                      key={`course-select-${selectResetKey}`}
                      value={field.value || ""}
                      onValueChange={(val) => field.onChange(val || undefined)}
                    >
                      <FormControl>
                        <SelectTrigger className="h-16 text-lg font-normal bg-white border-2 border-slate-200 text-slate-800 rounded-xl focus:ring-[#1967D2] focus:border-[#1967D2]">
                          <SelectValue placeholder="Seleccione Curso" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false} side="bottom" sideOffset={4} className="bg-white text-slate-800 border-slate-200 rounded-xl text-xl max-h-[300px] overflow-y-auto">
                        {availableCourses.map((crsName) => (
                          <SelectItem key={crsName} value={crsName} className="py-3">
                            {crsName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          <FormField
            control={form.control}
            name="dni"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-slate-500 text-xs font-bold uppercase tracking-widest">Número de DNI</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={24} />
                    <Input 
                      placeholder="Ingrese sus 8 dígitos" 
                      maxLength={8}
                      className="h-20 pl-14 bg-slate-50 border-2 border-slate-200 text-slate-900 text-2xl font-black tracking-[0.4em] rounded-xl focus-visible:ring-[#1967D2] focus-visible:border-[#1967D2] transition-all placeholder:text-slate-300 placeholder:tracking-normal placeholder:font-medium"
                      {...field}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        field.onChange(val);
                      }}
                    />
                    {isValidating && (
                      <Loader2 className="absolute right-5 top-1/2 -translate-y-1/2 text-[#1967D2] animate-spin" size={24} />
                    )}
                    {validatedUser && (
                      <UserCheck className="absolute right-5 top-1/2 -translate-y-1/2 text-emerald-500" size={28} />
                    )}
                  </div>
                </FormControl>

                {connectionError && (
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
                        onClick={() => validateDni(watchDni, watchRole, 2)}
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
                          setValidatedUser({ id: `offline_${watchDni}`, name: `Usuario DNI: ${watchDni} (Modo Local)` })
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

                {validatedUser && (
                  <div className="space-y-2 mt-2">
                    <p className="text-emerald-600 text-sm flex items-center gap-1.5 font-bold bg-emerald-50 p-2.5 rounded-md border border-emerald-100">
                      <CheckCircle2 size={18}/>
                      Validado: {validatedUser.name}
                    </p>

                    {watchRole === Role.TECNICO && (
                      <div className="p-3.5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="text-xs font-black uppercase tracking-wider text-[#1967D2] flex items-center gap-1">
                            📋 Sede Base / Asignada: {technicianAssignment?.campusName || validatedUser?.campusName || "Campus Villa"}
                          </span>
                          {technicianAssignment?.shift && (
                            <span className="text-[11px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-[#1967D2] text-white">
                              Turno: {technicianAssignment.shift} ({technicianAssignment.expectedEntryTime})
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <FormMessage className="text-sm font-medium" />
              </FormItem>
            )}
          />

          {/* Botones ENTRADA / SALIDA con lógica de secuencia */}
          {(() => {
            // Determinar qué botón mostrar según el último registro de hoy
            // null / "loading" = no hay registro → mostrar ENTRADA
            // último fue ENTRADA → mostrar SALIDA
            // último fue SALIDA → mostrar ENTRADA (posible nueva jornada o re-ingreso)
            const isLoadingState = todayLastRecord === "loading"
            const lastType = isLoadingState ? null : (todayLastRecord as RecordType | null)
            const showEntrada = lastType !== RecordType.ENTRADA
            const showSalida = lastType === RecordType.ENTRADA
            // Técnicos y Pacientes Sim. pueden marcar salida; Docentes registran solo Entrada
            const canMarkSalida = watchRole !== Role.DOCENTE

            const isButtonDisabled = (!validatedUser && !isOffline && !isContingencyMode) || isSubmitting !== null || isLoadingState

            return (
              <div className="grid grid-cols-1 gap-5 pt-4">
                {showEntrada && (
                  <Button
                    type="button"
                    disabled={isButtonDisabled}
                    onClick={form.handleSubmit((d) => onSubmit(d, RecordType.ENTRADA))}
                    className="h-20 rounded-xl bg-[#1967D2] hover:bg-[#124b9c] text-white font-black text-xl shadow-[0_10px_20px_-5px_rgba(25,103,210,0.5)] hover:shadow-[0_15px_25px_-5px_rgba(25,103,210,0.7)] transition-all hover:-translate-y-1 disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none"
                  >
                    {isLoadingState ? <Loader2 size={24} className="animate-spin mr-2" /> :
                      isSubmitting === RecordType.ENTRADA ? <Loader2 size={24} className="animate-spin mr-2" /> :
                      <LogIn size={24} className="mr-2" />}
                    {isLoadingState ? "Verificando..." : "ENTRADA"}
                  </Button>
                )}

                {showSalida && canMarkSalida && (
                  <Button
                    type="button"
                    disabled={isButtonDisabled}
                    onClick={form.handleSubmit((d) => onSubmit(d, RecordType.SALIDA))}
                    className="h-20 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-black text-xl shadow-[0_10px_20px_-5px_rgba(15,23,42,0.5)] hover:shadow-[0_15px_25px_-5px_rgba(15,23,42,0.7)] transition-all hover:-translate-y-1 disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none"
                  >
                    {isSubmitting === RecordType.SALIDA ? <Loader2 size={24} className="animate-spin mr-2" /> : <LogOut size={24} className="mr-2" />}
                    SALIDA
                  </Button>
                )}

                {showSalida && !canMarkSalida && (
                  <p className="text-center text-sm font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-xl py-4">
                    ✅ Entrada ya registrada hoy. No se requiere marca de salida para Docentes.
                  </p>
                )}
              </div>
            )
          })()}

        </form>
      </Form>
    </div>
  )
}
