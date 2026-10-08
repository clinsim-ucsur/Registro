"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Role, RecordType } from "@prisma/client"
import { validateUserAction, registerAttendanceAction, syncOfflineRecordsAction } from "@/actions/attendance"
import { toast } from "sonner"
import { Loader2, LogIn, LogOut, Search, UserCheck, CheckCircle2, WifiOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

const formSchema = z.object({
  role: z.nativeEnum(Role, { required_error: "Seleccione un rol" }),
  campusId: z.string().optional(),
  courseId: z.string().optional(),
  dni: z.string().length(8, "El DNI debe tener 8 dígitos numéricos").regex(/^\d+$/, "Solo números"),
})

export default function AttendanceForm() {
  const [isValidating, setIsValidating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState<RecordType | null>(null)
  const [validatedUser, setValidatedUser] = useState<{id: string, name: string} | null>(null)
  const [isOffline, setIsOffline] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      role: Role.DOCENTE,
      dni: "",
    },
  })

  // Detección y Sincronización Offline
  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsOffline(!navigator.onLine)
    }

    const syncOfflineRecords = async () => {
      const localData = localStorage.getItem('offline_records')
      if (!localData) return
      
      const records = JSON.parse(localData)
      if (records.length === 0) return

      try {
        const res = await syncOfflineRecordsAction(records)
        if (res.success) {
          localStorage.removeItem('offline_records')
          toast.success(`Se sincronizaron automáticamente ${res.syncedCount} registros offline.`)
          if (res.errorCount && res.errorCount > 0) {
            toast.warning(`Se ignoraron ${res.errorCount} registros (DNI inválidos).`)
          }
        }
      } catch (error) {
        console.error("No se pudo sincronizar", error)
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

  useEffect(() => {
    if (watchDni?.length === 8) {
      validateDni(watchDni, watchRole)
    } else {
      setValidatedUser(null)
    }
  }, [watchDni, watchRole])

  const validateDni = async (dni: string, role: Role) => {
    if (isOffline) {
      setValidatedUser({ id: 'offline_user', name: `Pendiente de validación` })
      return
    }

    setIsValidating(true)
    try {
      const res = await validateUserAction(dni, role)
      if (res.success && res.user) {
        setValidatedUser(res.user)
        toast.success(`Usuario encontrado: ${res.user.name}`)
      } else {
        setValidatedUser(null)
        toast.error(res.message || "Usuario no encontrado")
      }
    } catch (error) {
      toast.error("Error de conexión al validar")
    } finally {
      setIsValidating(false)
    }
  }

  const onSubmit = async (data: z.infer<typeof formSchema>, type: RecordType) => {
    if (!validatedUser) {
      toast.error("Debe validar su DNI primero")
      return
    }

    if (showExtraFields && (!data.campusId || !data.courseId)) {
      toast.error("Seleccione Sede y Curso")
      return
    }

    setIsSubmitting(type)
    
    if (isOffline) {
      const newRecord = {
        dni: data.dni,
        role: data.role,
        type: type,
        campusId: data.campusId,
        courseId: data.courseId,
        timestamp: new Date().toISOString()
      }
      const localData = JSON.parse(localStorage.getItem('offline_records') || '[]')
      localData.push(newRecord)
      localStorage.setItem('offline_records', JSON.stringify(localData))
      
      toast.success("Registro guardado en la memoria del dispositivo.")
      form.reset({ role: watchRole, dni: "", campusId: data.campusId, courseId: data.courseId })
      setValidatedUser(null)
      setIsSubmitting(null)
      return
    }

    try {
      const res = await registerAttendanceAction({
        userId: validatedUser.id,
        role: data.role,
        type: type,
        campusId: data.campusId, 
        courseId: data.courseId,
        clientTimestamp: new Date(),
        isOfflineSync: !navigator.onLine 
      })

      if (res.success) {
        toast.success(res.message, { duration: 5000 })
        form.reset({ role: watchRole, dni: "", campusId: data.campusId, courseId: data.courseId })
        setValidatedUser(null)
      } else {
        toast.error(res.message)
      }
    } catch (error) {
      if (!navigator.onLine) {
         toast.info("Sin conexión. Registro guardado localmente para sincronizar luego.")
         form.reset({ role: watchRole, dni: "", campusId: data.campusId, courseId: data.courseId })
         setValidatedUser(null)
      } else {
         toast.error("Ocurrió un error inesperado al registrar.")
      }
    } finally {
      setIsSubmitting(null)
    }
  }

  return (
    <div className="bg-white rounded-[2rem] p-8 md:p-10 shadow-[0_45px_75px_-15px_rgba(0,0,0,0.6)] w-full relative overflow-hidden transition-all duration-500 hover:-translate-y-2">
      <div className="absolute top-0 left-0 w-full h-2.5 bg-gradient-to-r from-blue-400 to-[#1967D2]"></div>

      <h2 className="text-2xl md:text-3xl font-black text-slate-800 mb-8 text-center tracking-wide">
        Registro de Asistencia
        {isOffline && (
          <div className="flex items-center justify-center gap-2 mt-3 text-sm font-bold text-rose-500 bg-rose-50 w-fit mx-auto px-4 py-1.5 rounded-full border border-rose-100 animate-pulse">
            <WifiOff size={16} /> MODO OFFLINE ACTIVADO
          </div>
        )}
      </h2>

      <Form {...form}>
        <form className="space-y-8">
          
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel className="text-slate-500 text-xs font-bold uppercase tracking-widest">Rol del Usuario</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    className="grid grid-cols-3 gap-3"
                  >
                    {[
                      { value: Role.DOCENTE, label: "Docente" },
                      { value: Role.TECNICO, label: "Técnico" },
                      { value: Role.PACIENTE_SIMULADO, label: "Paciente Sim." },
                    ].map((r) => (
                      <FormItem key={r.value} className="flex items-center space-x-0 space-y-0">
                        <FormControl>
                          <RadioGroupItem value={r.value} className="peer sr-only" />
                        </FormControl>
                        <FormLabel className="w-full text-center py-5 px-2 rounded-xl border-2 border-slate-200 bg-slate-50 text-slate-600 cursor-pointer transition-all duration-300 hover:bg-slate-100 peer-data-[state=checked]:border-[#1967D2] peer-data-[state=checked]:bg-[#1967D2]/10 peer-data-[state=checked]:text-[#1967D2] peer-data-[state=checked]:shadow-md peer-data-[state=checked]:font-black text-sm md:text-lg">
                          {r.label}
                        </FormLabel>
                      </FormItem>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {showExtraFields && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in-up">
              <FormField
                control={form.control}
                name="campusId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-slate-500 text-xs font-bold uppercase tracking-widest">Sede</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-16 text-lg font-normal bg-white border-2 border-slate-200 text-slate-800 rounded-xl focus:ring-[#1967D2] focus:border-[#1967D2]">
                          <SelectValue placeholder="Seleccione Sede" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false} side="bottom" sideOffset={4} className="bg-white text-slate-800 border-slate-200 rounded-xl text-2xl">
                        <SelectItem value="Campus Villa" className="py-4">Campus Villa</SelectItem>
                        <SelectItem value="Campus Norte" className="py-4">Campus Norte</SelectItem>
                        <SelectItem value="Campus Ate" className="py-4">Campus Ate</SelectItem>
                        <SelectItem value="Campus Aramburú" className="py-4">Campus Aramburú</SelectItem>
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
                    <FormLabel className="text-slate-500 text-xs font-bold uppercase tracking-widest">Curso</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-16 text-lg font-normal bg-white border-2 border-slate-200 text-slate-800 rounded-xl focus:ring-[#1967D2] focus:border-[#1967D2]">
                          <SelectValue placeholder="Seleccione Curso" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false} side="bottom" sideOffset={4} className="bg-white text-slate-800 border-slate-200 rounded-xl text-xl max-h-[300px] overflow-y-auto">
                        <SelectItem value="Simulación Quirúrgica" className="py-3">Simulación Quirúrgica</SelectItem>
                        <SelectItem value="Simulación Clínica Integrada (SCI)" className="py-3">Simulación Clínica Integrada (SCI)</SelectItem>
                        <SelectItem value="Semiología Basada en Simulación (SBS)" className="py-3">Semiología Basada en Simulación (SBS)</SelectItem>
                        <SelectItem value="Simulación Ginecológica" className="py-3">Simulación Ginecológica</SelectItem>
                        <SelectItem value="Simulación Pediátrica" className="py-3">Simulación Pediátrica</SelectItem>
                        <SelectItem value="Externado de Cirugía" className="py-3">Externado de Cirugía</SelectItem>
                        <SelectItem value="Externado de Medicina" className="py-3">Externado de Medicina</SelectItem>
                        <SelectItem value="Externado de Pediatría" className="py-3">Externado de Pediatría</SelectItem>
                        <SelectItem value="Externado de Ginecología" className="py-3">Externado de Ginecología</SelectItem>
                        <SelectItem value="Primeros Auxilios" className="py-3">Primeros Auxilios</SelectItem>
                        <SelectItem value="Medicina Legal" className="py-3">Medicina Legal</SelectItem>
                        <SelectItem value="Ecografía" className="py-3">Ecografía</SelectItem>
                        <SelectItem value="Otros" className="py-3">Otros</SelectItem>
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
                {validatedUser && (
                  <p className="text-emerald-600 text-sm mt-2 flex items-center gap-1.5 font-bold bg-emerald-50 p-2.5 rounded-md border border-emerald-100">
                    <CheckCircle2 size={18}/>
                    Validado: {validatedUser.name}
                  </p>
                )}
                <FormMessage className="text-sm font-medium" />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-5 pt-4">
            <Button
              type="button"
              disabled={!validatedUser || isSubmitting !== null}
              onClick={form.handleSubmit((d) => onSubmit(d, RecordType.ENTRADA))}
              className="h-20 rounded-xl bg-[#1967D2] hover:bg-[#124b9c] text-white font-black text-xl shadow-[0_10px_20px_-5px_rgba(25,103,210,0.5)] hover:shadow-[0_15px_25px_-5px_rgba(25,103,210,0.7)] transition-all hover:-translate-y-1 disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none"
            >
              {isSubmitting === RecordType.ENTRADA ? <Loader2 size={24} className="animate-spin mr-2" /> : <LogIn size={24} className="mr-2" />}
              ENTRADA
            </Button>

            {watchRole !== Role.DOCENTE && (
              <Button
                type="button"
                disabled={!validatedUser || isSubmitting !== null}
                onClick={form.handleSubmit((d) => onSubmit(d, RecordType.SALIDA))}
                className="h-20 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-black text-xl shadow-[0_10px_20px_-5px_rgba(15,23,42,0.5)] hover:shadow-[0_15px_25px_-5px_rgba(15,23,42,0.7)] transition-all hover:-translate-y-1 disabled:opacity-50 disabled:hover:translate-y-0 disabled:shadow-none"
              >
                {isSubmitting === RecordType.SALIDA ? <Loader2 size={24} className="animate-spin mr-2" /> : <LogOut size={24} className="mr-2" />}
                SALIDA
              </Button>
            )}
          </div>

        </form>
      </Form>
    </div>
  )
}
