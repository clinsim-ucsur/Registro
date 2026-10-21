"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  Building2, 
  GraduationCap, 
  Plus, 
  Edit, 
  Trash2, 
  Search, 
  AlertTriangle, 
  Loader2, 
  Check, 
  Layers,
  MapPin,
  BookOpen,
  Crosshair,
  Navigation
} from "lucide-react"
import { toast } from "sonner"
import { 
  createCampusAction, 
  updateCampusAction, 
  updateCampusGeoAction,
  deleteCampusAction,
  createCourseAction, 
  updateCourseAction, 
  deleteCourseAction 
} from "@/actions/catalogs"

export type CatalogCampus = {
  id: string
  name: string
  _count?: { users: number; records: number; rules: number }
  geoEnforced?: boolean
  latitude?: number | null
  longitude?: number | null
  radiusMeters?: number
}

export type CatalogCourse = {
  id: string
  name: string
  _count?: { records: number }
}

interface CatalogsProps {
  campuses: CatalogCampus[]
  courses: CatalogCourse[]
}

export function DashboardCatalogs({ campuses: initialCampuses, courses: initialCourses }: CatalogsProps) {
  const [activeTab, setActiveTab] = useState<"sedes" | "cursos">("sedes")
  const [searchCampus, setSearchCampus] = useState("")
  const [searchCourse, setSearchCourse] = useState("")

  // Modals state
  const [campusModal, setCampusModal] = useState<{ isOpen: boolean; mode: "create" | "edit"; data?: CatalogCampus } | null>(null)
  const [campusNameInput, setCampusNameInput] = useState("")

  const [courseModal, setCourseModal] = useState<{ isOpen: boolean; mode: "create" | "edit"; data?: CatalogCourse } | null>(null)
  const [courseNameInput, setCourseNameInput] = useState("")

  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean
    type: "campus" | "course"
    id: string
    name: string
    subtext?: string
  } | null>(null)

  const [isProcessing, setIsProcessing] = useState(false)

  // Filtered lists
  const filteredCampuses = initialCampuses.filter(c =>
    c.name.toLowerCase().includes(searchCampus.toLowerCase())
  )

  const filteredCourses = initialCourses.filter(c =>
    c.name.toLowerCase().includes(searchCourse.toLowerCase())
  )

  // Handlers - Campus
  const handleOpenCreateCampus = () => {
    setCampusNameInput("")
    setCampusModal({ isOpen: true, mode: "create" })
  }

  const handleOpenEditCampus = (c: CatalogCampus) => {
    setCampusNameInput(c.name)
    setCampusModal({ isOpen: true, mode: "edit", data: c })
  }

  const handleSaveCampus = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!campusNameInput.trim()) {
      toast.error("Ingrese el nombre de la sede")
      return
    }

    setIsProcessing(true)
    try {
      if (campusModal?.mode === "create") {
        const res = await createCampusAction(campusNameInput)
        if (res.success) {
          toast.success(res.message)
          setCampusModal(null)
        } else {
          toast.error(res.message)
        }
      } else if (campusModal?.mode === "edit" && campusModal.data) {
        const res = await updateCampusAction(campusModal.data.id, campusNameInput)
        if (res.success) {
          toast.success(res.message)
          setCampusModal(null)
        } else {
          toast.error(res.message)
        }
      }
    } catch {
      toast.error("Error al procesar la sede")
    } finally {
      setIsProcessing(false)
    }
  }

  // Handlers - Course
  const handleOpenCreateCourse = () => {
    setCourseNameInput("")
    setCourseModal({ isOpen: true, mode: "create" })
  }

  const handleOpenEditCourse = (c: CatalogCourse) => {
    setCourseNameInput(c.name)
    setCourseModal({ isOpen: true, mode: "edit", data: c })
  }

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!courseNameInput.trim()) {
      toast.error("Ingrese el nombre del curso")
      return
    }

    setIsProcessing(true)
    try {
      if (courseModal?.mode === "create") {
        const res = await createCourseAction(courseNameInput)
        if (res.success) {
          toast.success(res.message)
          setCourseModal(null)
        } else {
          toast.error(res.message)
        }
      } else if (courseModal?.mode === "edit" && courseModal.data) {
        const res = await updateCourseAction(courseModal.data.id, courseNameInput)
        if (res.success) {
          toast.success(res.message)
          setCourseModal(null)
        } else {
          toast.error(res.message)
        }
      }
    } catch {
      toast.error("Error al procesar el curso")
    } finally {
      setIsProcessing(false)
    }
  }

  // Geocerca por sede
  const [geoModal, setGeoModal] = useState<CatalogCampus | null>(null)
  const [geoForm, setGeoForm] = useState({ enabled: false, lat: "", lng: "", radius: "300" })
  const [isLocating, setIsLocating] = useState(false)

  const handleOpenGeo = (c: CatalogCampus) => {
    setGeoForm({
      enabled: !!c.geoEnforced,
      lat: c.latitude != null ? String(c.latitude) : "",
      lng: c.longitude != null ? String(c.longitude) : "",
      radius: String(c.radiusMeters ?? 300),
    })
    setGeoModal(c)
  }

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Este navegador no soporta geolocalización.")
      return
    }
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeoForm((f) => ({ ...f, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }))
        toast.success(`Ubicación capturada (precisión ~${Math.round(p.coords.accuracy)} m).`)
        setIsLocating(false)
      },
      () => {
        toast.error("No se pudo obtener su ubicación. Verifique los permisos del navegador.")
        setIsLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  const handleSaveGeo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!geoModal) return
    const lat = geoForm.lat.trim() === "" ? null : Number(geoForm.lat.replace(",", "."))
    const lng = geoForm.lng.trim() === "" ? null : Number(geoForm.lng.replace(",", "."))
    if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) {
      toast.error("Latitud o longitud inválidas.")
      return
    }
    setIsProcessing(true)
    try {
      const res = await updateCampusGeoAction(geoModal.id, {
        geoEnforced: geoForm.enabled,
        latitude: lat,
        longitude: lng,
        radiusMeters: Number(geoForm.radius),
      })
      if (res.success) {
        toast.success(res.message)
        setGeoModal(null)
      } else {
        toast.error(res.message)
      }
    } catch {
      toast.error("Error al guardar la ubicación.")
    } finally {
      setIsProcessing(false)
    }
  }

  // Handle Deletions
  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return
    setIsProcessing(true)
    try {
      if (deleteConfirm.type === "campus") {
        const res = await deleteCampusAction(deleteConfirm.id)
        if (res.success) {
          toast.success(res.message)
          setDeleteConfirm(null)
        } else {
          toast.error(res.message)
        }
      } else {
        const res = await deleteCourseAction(deleteConfirm.id)
        if (res.success) {
          toast.success(res.message)
          setDeleteConfirm(null)
        } else {
          toast.error(res.message)
        }
      }
    } catch {
      toast.error("Error al intentar eliminar el registro.")
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* HEADER CARD */}
      <Card className="border-slate-200/60 shadow-sm rounded-3xl bg-white overflow-hidden">
        <CardHeader className="p-6 md:p-8 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[#1967D2] text-xs font-bold uppercase tracking-wider mb-1">
              <Layers size={13} /> Catálogos Académicos & Sedes
            </div>
            <CardTitle className="text-2xl md:text-3xl font-black text-slate-800">
              Gestión de Sedes y Cursos
            </CardTitle>
            <CardDescription className="text-slate-500 font-medium text-sm">
              Administra las sedes autorizadas (incluyendo Campus Aramburú) y el catálogo activo de cursos para el registro de asistencia.
            </CardDescription>
          </div>

          {/* Subtabs Selector Pill */}
          <div className="flex bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200/80 shadow-inner w-full md:w-auto">
            <button
              onClick={() => setActiveTab("sedes")}
              className={`flex-1 md:flex-initial flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-200 ${
                activeTab === "sedes"
                  ? "bg-white text-[#1967D2] shadow-sm font-black"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Building2 size={18} />
              Sedes ({initialCampuses.length})
            </button>
            <button
              onClick={() => setActiveTab("cursos")}
              className={`flex-1 md:flex-initial flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-200 ${
                activeTab === "cursos"
                  ? "bg-white text-[#1967D2] shadow-sm font-black"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <GraduationCap size={18} />
              Cursos ({initialCourses.length})
            </button>
          </div>
        </CardHeader>
      </Card>

      {/* CONTENIDO DE SEDES */}
      {activeTab === "sedes" && (
        <Card className="border-slate-200/60 shadow-sm rounded-3xl bg-white overflow-hidden animate-fade-in-up">
          <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <Input
                placeholder="Buscar sede (ej. Aramburú, Villa)..."
                value={searchCampus}
                onChange={e => setSearchCampus(e.target.value)}
                className="pl-12 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium focus-visible:ring-[#1967D2]"
              />
            </div>
            <Button
              onClick={handleOpenCreateCampus}
              className="h-12 bg-[#1967D2] hover:bg-[#1557b0] text-white rounded-xl font-bold px-6 shadow-md shadow-blue-500/20 flex items-center gap-2"
            >
              <Plus size={18} /> Nueva Sede
            </Button>
          </div>

          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow className="border-slate-100">
                  <TableHead className="px-6 font-bold text-slate-600 py-4">Sede / Campus</TableHead>
                  <TableHead className="font-bold text-slate-600 text-center">Personal Asignado</TableHead>
                  <TableHead className="font-bold text-slate-600 text-center">Registros de Asistencia</TableHead>
                  <TableHead className="font-bold text-slate-600 text-center">Reglas de Horario</TableHead>
                  <TableHead className="text-right px-8 font-bold text-slate-600">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCampuses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-16 text-slate-400 font-medium">
                      No se encontraron sedes con ese criterio.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCampuses.map((campus) => {
                    const usersCount = campus._count?.users ?? 0
                    const recordsCount = campus._count?.records ?? 0
                    const rulesCount = campus._count?.rules ?? 0
                    const isProtected = recordsCount > 0 || usersCount > 0

                    return (
                      <TableRow key={campus.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                        <TableCell className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1967D2] flex items-center justify-center font-bold shrink-0">
                              <MapPin size={18} />
                            </div>
                            <div>
                              <p className="font-extrabold text-slate-800 text-base">{campus.name}</p>
                              <span className="text-[11px] font-semibold text-slate-400">ID: {campus.id.slice(0, 10)}...</span>
                              <span className={`ml-2 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${campus.geoEnforced ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-400"}`}>
                                <Crosshair size={10} /> {campus.geoEnforced ? `GPS ${campus.radiusMeters ?? 300} m` : "Sin límite GPS"}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                            {usersCount} {usersCount === 1 ? "persona" : "personas"}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${recordsCount > 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500"}`}>
                            {recordsCount} marcaciones
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
                            {rulesCount} {rulesCount === 1 ? "regla" : "reglas"}
                          </span>
                        </TableCell>
                        <TableCell className="px-6 text-right space-x-2">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleOpenGeo(campus)}
                            className="h-9 w-9 text-emerald-600 border-emerald-200 hover:bg-emerald-50 rounded-xl transition-colors shadow-sm"
                            title="Ubicación y límite por GPS"
                          >
                            <Crosshair size={16} />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleOpenEditCampus(campus)}
                            className="h-9 w-9 text-blue-600 border-blue-200 hover:bg-blue-50 rounded-xl transition-colors shadow-sm"
                            title="Editar nombre de sede"
                          >
                            <Edit size={16} />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setDeleteConfirm({
                              isOpen: true,
                              type: "campus",
                              id: campus.id,
                              name: campus.name,
                              subtext: isProtected
                                ? `Esta sede cuenta con ${recordsCount} marcaciones y ${usersCount} usuarios asignados. No se puede eliminar directamente para proteger la integridad.`
                                : undefined
                            })}
                            className="h-9 w-9 text-rose-600 border-rose-200 hover:bg-rose-50 rounded-xl transition-colors shadow-sm"
                            title="Eliminar sede"
                          >
                            <Trash2 size={16} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* CONTENIDO DE CURSOS */}
      {activeTab === "cursos" && (
        <Card className="border-slate-200/60 shadow-sm rounded-3xl bg-white overflow-hidden animate-fade-in-up">
          <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <Input
                placeholder="Buscar curso (ej. Semiología, SCI)..."
                value={searchCourse}
                onChange={e => setSearchCourse(e.target.value)}
                className="pl-12 h-12 bg-slate-50 border-slate-200 rounded-xl font-medium focus-visible:ring-[#1967D2]"
              />
            </div>
            <Button
              onClick={handleOpenCreateCourse}
              className="h-12 bg-[#1967D2] hover:bg-[#1557b0] text-white rounded-xl font-bold px-6 shadow-md shadow-blue-500/20 flex items-center gap-2"
            >
              <Plus size={18} /> Nuevo Curso
            </Button>
          </div>

          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow className="border-slate-100">
                  <TableHead className="px-6 font-bold text-slate-600 py-4">Nombre del Curso</TableHead>
                  <TableHead className="font-bold text-slate-600 text-center">Registros Vinculados</TableHead>
                  <TableHead className="text-right px-8 font-bold text-slate-600">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCourses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-16 text-slate-400 font-medium">
                      No se encontraron cursos con ese criterio.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCourses.map((course) => {
                    const recordsCount = course._count?.records ?? 0
                    return (
                      <TableRow key={course.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                        <TableCell className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold shrink-0">
                              <BookOpen size={18} />
                            </div>
                            <div>
                              <p className="font-extrabold text-slate-800 text-base">{course.name}</p>
                              <span className="text-[11px] font-semibold text-slate-400">ID: {course.id.slice(0, 10)}...</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${recordsCount > 0 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500"}`}>
                            {recordsCount} marcaciones registradas
                          </span>
                        </TableCell>
                        <TableCell className="px-6 text-right space-x-2">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleOpenEditCourse(course)}
                            className="h-9 w-9 text-blue-600 border-blue-200 hover:bg-blue-50 rounded-xl transition-colors shadow-sm"
                            title="Editar nombre del curso"
                          >
                            <Edit size={16} />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setDeleteConfirm({
                              isOpen: true,
                              type: "course",
                              id: course.id,
                              name: course.name,
                              subtext: recordsCount > 0
                                ? `Este curso está vinculado a ${recordsCount} registros de asistencia históricos y no se puede eliminar.`
                                : undefined
                            })}
                            className="h-9 w-9 text-rose-600 border-rose-200 hover:bg-rose-50 rounded-xl transition-colors shadow-sm"
                            title="Eliminar curso"
                          >
                            <Trash2 size={16} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* MODAL CAMPUS (PORTAL) */}
      {typeof document !== "undefined" && campusModal?.isOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in-up">
          <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-6 md:p-8 relative">
            <button
              onClick={() => !isProcessing && setCampusModal(null)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
            >
              ✕
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#1967D2] flex items-center justify-center">
                <Building2 size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-black text-[#0B1B3D]">
                  {campusModal.mode === "create" ? "Nueva Sede" : "Editar Sede"}
                </h3>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Campus Universitario</p>
              </div>
            </div>

            <form onSubmit={handleSaveCampus} className="space-y-6">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                  Nombre de la Sede / Campus
                </label>
                <Input
                  value={campusNameInput}
                  onChange={e => setCampusNameInput(e.target.value)}
                  placeholder="Ej: Campus Aramburú, Campus Ate"
                  className="h-14 bg-slate-50 border-slate-200 font-bold text-base focus-visible:ring-[#1967D2] rounded-xl"
                  required
                  autoFocus
                />
                <p className="text-xs text-slate-400 mt-2 font-medium">
                  Este nombre aparecerá en la selección del portal de asistencia y en los filtros de reportes.
                </p>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-12 rounded-xl font-bold border-slate-200 text-slate-600 hover:bg-slate-50"
                  onClick={() => setCampusModal(null)}
                  disabled={isProcessing}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="flex-1 h-12 bg-[#1967D2] hover:bg-[#1557b0] text-white rounded-xl font-bold shadow-md shadow-blue-500/20"
                  disabled={isProcessing}
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={18} /> : (campusModal.mode === "create" ? "Crear Sede" : "Guardar")}
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL GEOCERCA (PORTAL) */}
      {typeof document !== "undefined" && geoModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in-up">
          <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-6 md:p-8 relative">
            <button
              onClick={() => !isProcessing && setGeoModal(null)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
            >
              ✕
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Crosshair size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-black text-[#0B1B3D]">Límite por GPS</h3>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">{geoModal.name}</p>
              </div>
            </div>

            <form onSubmit={handleSaveGeo} className="space-y-5">
              <div
                onClick={() => setGeoForm((f) => ({ ...f, enabled: !f.enabled }))}
                className={`flex items-center justify-between p-4 rounded-2xl border cursor-pointer transition-colors ${geoForm.enabled ? "bg-emerald-50 border-emerald-300" : "bg-slate-50 border-slate-200"}`}
              >
                <div>
                  <p className="font-bold text-sm text-slate-800">Solo permitir marcar dentro de la sede</p>
                  <p className="text-xs text-slate-500">Si está activo, se valida la ubicación del dispositivo.</p>
                </div>
                <div className={`w-12 h-7 rounded-full p-1 transition-colors ${geoForm.enabled ? "bg-emerald-500" : "bg-slate-300"}`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${geoForm.enabled ? "translate-x-5" : ""}`} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Latitud</label>
                  <Input
                    value={geoForm.lat}
                    onChange={(e) => setGeoForm((f) => ({ ...f, lat: e.target.value }))}
                    placeholder="-12.189400"
                    className="h-12 bg-slate-50 border-slate-200 font-semibold rounded-xl"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Longitud</label>
                  <Input
                    value={geoForm.lng}
                    onChange={(e) => setGeoForm((f) => ({ ...f, lng: e.target.value }))}
                    placeholder="-76.973800"
                    className="h-12 bg-slate-50 border-slate-200 font-semibold rounded-xl"
                  />
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={handleUseMyLocation}
                disabled={isLocating}
                className="w-full h-11 rounded-xl font-bold border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              >
                {isLocating ? <Loader2 className="animate-spin" size={16} /> : <><Navigation size={16} className="mr-2" /> Usar mi ubicación actual</>}
              </Button>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Radio permitido (metros)</label>
                <Input
                  type="number"
                  min={30}
                  max={5000}
                  value={geoForm.radius}
                  onChange={(e) => setGeoForm((f) => ({ ...f, radius: e.target.value }))}
                  className="h-12 bg-slate-50 border-slate-200 font-semibold rounded-xl"
                />
                <p className="text-xs text-slate-400 mt-2 font-medium">
                  Entre 30 y 5000 m. Se recomienda 200–500 m por la imprecisión del GPS en interiores.
                </p>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <Button type="button" variant="outline" className="flex-1 h-12 rounded-xl font-bold border-slate-200 text-slate-600 hover:bg-slate-50" onClick={() => setGeoModal(null)} disabled={isProcessing}>
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md shadow-emerald-600/20" disabled={isProcessing}>
                  {isProcessing ? <Loader2 className="animate-spin" size={18} /> : "Guardar"}
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL CURSO (PORTAL) */}
      {typeof document !== "undefined" && courseModal?.isOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in-up">
          <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-6 md:p-8 relative">
            <button
              onClick={() => !isProcessing && setCourseModal(null)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
            >
              ✕
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <GraduationCap size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-black text-[#0B1B3D]">
                  {courseModal.mode === "create" ? "Nuevo Curso" : "Editar Curso"}
                </h3>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Catálogo Académico</p>
              </div>
            </div>

            <form onSubmit={handleSaveCourse} className="space-y-6">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                  Nombre del Curso
                </label>
                <Input
                  value={courseNameInput}
                  onChange={e => setCourseNameInput(e.target.value)}
                  placeholder="Ej: Simulación Pediátrica Avanzada"
                  className="h-14 bg-slate-50 border-slate-200 font-bold text-base focus-visible:ring-indigo-600 rounded-xl"
                  required
                  autoFocus
                />
                <p className="text-xs text-slate-400 mt-2 font-medium">
                  Disponible para docentes y pacientes simulados al marcar entrada o salida.
                </p>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-12 rounded-xl font-bold border-slate-200 text-slate-600 hover:bg-slate-50"
                  onClick={() => setCourseModal(null)}
                  disabled={isProcessing}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md shadow-indigo-600/20"
                  disabled={isProcessing}
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={18} /> : (courseModal.mode === "create" ? "Crear Curso" : "Guardar")}
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL ELIMINAR CONFIRM (PORTAL) */}
      {typeof document !== "undefined" && deleteConfirm?.isOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in-up">
          <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-6 md:p-8 relative text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center border border-rose-100 mx-auto mb-4">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-2xl font-black text-slate-800 mb-2">
              ¿Eliminar {deleteConfirm.type === "campus" ? "Sede" : "Curso"}?
            </h3>
            <p className="text-slate-600 font-medium mb-2">
              Vas a remover <strong>"{deleteConfirm.name}"</strong> del sistema.
            </p>
            {deleteConfirm.subtext && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold text-left mb-4">
                ⚠️ {deleteConfirm.subtext}
              </div>
            )}
            <div className="flex gap-3 w-full mt-6">
              <Button
                variant="outline"
                className="flex-1 h-12 rounded-xl font-bold border-slate-200 text-slate-600 hover:bg-slate-50"
                onClick={() => setDeleteConfirm(null)}
                disabled={isProcessing}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-12 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold shadow-md shadow-rose-600/20"
                onClick={handleConfirmDelete}
                disabled={isProcessing}
              >
                {isProcessing ? <Loader2 className="animate-spin" size={18} /> : "Sí, Eliminar"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
