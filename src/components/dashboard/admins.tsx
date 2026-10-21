"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Search,
  Edit,
  Trash2,
  Shield,
  AlertTriangle,
  Loader2,
  UserPlus,
  Key,
  Eye,
  EyeOff,
  Check,
  Sliders,
  Building2,
  Lock
} from "lucide-react"
import { toast } from "sonner"
import { editAdminAction, deleteUserAction, createAdminAction, revokeAdminAction } from "@/actions/users"
import { Role } from "@prisma/client"

export const AVAILABLE_MODULES = [
  { id: "overview", name: "Resumen General", desc: "Métricas del día, flujo de entradas y salidas en vivo." },
  { id: "analytics", name: "Métricas & Analítica", desc: "Gráficos de puntualidad, rankings y tendencias semanales/mensuales." },
  { id: "reports", name: "Exportación & Reportes", desc: "Filtros por fechas y exportación a Excel / PDF oficial." },
  { id: "rules", name: "Horarios & Tolerancias", desc: "Configurar horas de entrada esperadas, gracia y tardanzas." },
  { id: "users", name: "Personal Operativo", desc: "Directorio de docentes, técnicos y pacientes simulados." },
  { id: "catalogs", name: "Sedes & Cursos", desc: "Gestión de campus autorizados y catálogo académico." },
  { id: "admins", name: "Control de Acceso", desc: "Gestión de otros administradores y permisos de cuentas." },
] as const

const DEFAULT_SUPER_ADMIN_PERMS = ["overview", "analytics", "reports", "rules", "users", "catalogs", "admins"]
const DEFAULT_ADMIN_PERMS = ["overview", "reports", "users"]

interface DashboardAdminsProps {
  admins: any[]
  campuses: { id: string; name: string }[]
}

export function DashboardAdmins({ admins, campuses }: DashboardAdminsProps) {
  const [searchTerm, setSearchTerm] = useState("")

  const [editingAdmin, setEditingAdmin] = useState<any | null>(null)
  const [deletingAdmin, setDeletingAdmin] = useState<any | null>(null)
  const [addingAdmin, setAddingAdmin] = useState<any | null>(null)

  const [showCreatePass, setShowCreatePass] = useState(false)
  const [showEditPass, setShowEditPass] = useState(false)

  const [isProcessing, setIsProcessing] = useState(false)

  const filteredAdmins = admins.filter(a =>
    a.dni.includes(searchTerm) ||
    a.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleDelete = async () => {
    if (!deletingAdmin) return
    setIsProcessing(true)
    const res = await revokeAdminAction(deletingAdmin.dni)
    if (res.success) {
      toast.success(res.message)
      setDeletingAdmin(null)
    } else {
      toast.error(res.message)
    }
    setIsProcessing(false)
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingAdmin) return
    setIsProcessing(true)
    const res = await editAdminAction(editingAdmin.oldDni, {
      name: editingAdmin.name,
      dni: editingAdmin.dni,
      role: editingAdmin.role as Role,
      password: editingAdmin.password,
      campusId: editingAdmin.campusId || null,
      permissions: editingAdmin.permissions || []
    })

    if (res.success) {
      toast.success(res.message)
      setEditingAdmin(null)
    } else {
      toast.error(res.message)
    }
    setIsProcessing(false)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addingAdmin) return
    setIsProcessing(true)
    const res = await createAdminAction({
      name: addingAdmin.name,
      dni: addingAdmin.dni,
      role: addingAdmin.role as Role,
      password: addingAdmin.password,
      campusId: addingAdmin.campusId || null,
      permissions: addingAdmin.permissions || []
    })

    if (res.success) {
      toast.success(res.message)
      setAddingAdmin(null)
    } else {
      toast.error(res.message)
    }
    setIsProcessing(false)
  }

  const togglePermission = (targetObj: any, setTargetObj: (val: any) => void, permId: string) => {
    const currentPerms: string[] = targetObj.permissions || []
    if (currentPerms.includes(permId)) {
      setTargetObj({ ...targetObj, permissions: currentPerms.filter(p => p !== permId) })
    } else {
      setTargetObj({ ...targetObj, permissions: [...currentPerms, permId] })
    }
  }

  const applyTemplate = (targetObj: any, setTargetObj: (val: any) => void, templateType: "super" | "admin" | "custom") => {
    if (templateType === "super") {
      setTargetObj({ ...targetObj, role: "SUPER_ADMIN", permissions: [...DEFAULT_SUPER_ADMIN_PERMS] })
    } else if (templateType === "admin") {
      setTargetObj({ ...targetObj, role: "ADMIN_SECUNDARIO", permissions: [...DEFAULT_ADMIN_PERMS] })
    }
  }

  return (
    <>
      <div className="animate-fade-in-up">
        <Card className="border-slate-200/60 shadow-sm rounded-3xl bg-white overflow-hidden">
          <CardHeader className="border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 py-6 px-8">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                <Shield size={13} /> Seguridad & Privilegios
              </div>
              <CardTitle className="text-2xl font-black text-slate-800 flex items-center gap-2">
                Control de Acceso y Permisos Granulares
              </CardTitle>
              <CardDescription className="text-sm font-medium mt-1 text-slate-500">
                Asigna privilegios módulo por módulo de forma personalizada a cada administrador o mediante plantillas predeterminadas.
              </CardDescription>
            </div>
            <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
              <div className="relative w-full md:w-72">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <Input
                  placeholder="Buscar administrador..."
                  className="pl-12 h-12 bg-slate-50 border-slate-200 rounded-xl w-full font-medium focus-visible:ring-indigo-600"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              <Button
                onClick={() => setAddingAdmin({
                  name: '',
                  dni: '',
                  role: 'ADMIN_SECUNDARIO',
                  password: '',
                  campusId: '',
                  permissions: [...DEFAULT_ADMIN_PERMS]
                })}
                className="h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold px-6 shadow-md shadow-indigo-600/20"
              >
                <UserPlus className="mr-2" size={18} /> Añadir Administrador
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="max-h-[600px] overflow-y-auto no-scrollbar">
              <Table>
                <TableHeader className="bg-slate-50/80 sticky top-0 z-10 backdrop-blur-sm">
                  <TableRow className="border-slate-100">
                    <TableHead className="px-6 font-bold text-slate-600 py-4">Administrador</TableHead>
                    <TableHead className="font-bold text-slate-600">DNI (Usuario)</TableHead>
                    <TableHead className="font-bold text-slate-600">Sede Asignada</TableHead>
                    <TableHead className="font-bold text-slate-600">Rol & Privilegios</TableHead>
                    <TableHead className="font-bold text-slate-600">Módulos Permitidos</TableHead>
                    <TableHead className="text-right px-8 font-bold text-slate-600">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAdmins.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-16 text-slate-400 font-medium text-base">
                        No se encontraron cuentas de administrador registradas.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAdmins.map((admin) => {
                      const adminPerms: string[] = admin.permissions && admin.permissions.length > 0
                        ? admin.permissions
                        : (admin.role === "SUPER_ADMIN" ? DEFAULT_SUPER_ADMIN_PERMS : DEFAULT_ADMIN_PERMS)

                      return (
                        <TableRow key={admin.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                          <TableCell className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm text-white ${admin.role === "SUPER_ADMIN" ? "bg-indigo-600" : "bg-[#1967D2]"}`}>
                                {admin.name.slice(0, 2).toUpperCase()}
                              </div>
                              <p className="font-bold text-slate-800">{admin.name}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-bold text-slate-600 font-mono text-sm">{admin.dni}</TableCell>
                          <TableCell>
                            {admin.campus ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                <Building2 size={13} /> {admin.campus.name}
                              </span>
                            ) : (
                              <span className="text-xs font-semibold text-slate-400">Todas las sedes</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={`px-3 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase ${admin.role === 'SUPER_ADMIN' ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-600'}`}>
                              {admin.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1 max-w-xs">
                              {admin.role === 'SUPER_ADMIN' ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-md border border-indigo-100">
                                  <Lock size={11} /> Control Total ({AVAILABLE_MODULES.length})
                                </span>
                              ) : (
                                adminPerms.map((pid: string) => {
                                  const mod = AVAILABLE_MODULES.find(m => m.id === pid)
                                  return (
                                    <span key={pid} className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                      {mod?.name.split(" ")[0] || pid}
                                    </span>
                                  )
                                })
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-6 text-right space-x-2">
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => setEditingAdmin({
                                ...admin,
                                oldDni: admin.dni,
                                password: '',
                                permissions: adminPerms,
                                campusId: admin.campusId || ''
                              })}
                              className="h-9 w-9 text-blue-600 border-blue-200 hover:bg-blue-50 rounded-xl transition-colors shadow-sm"
                              title="Configurar permisos y acceso"
                            >
                              <Edit size={16} />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => setDeletingAdmin(admin)}
                              className="h-9 w-9 text-rose-600 border-rose-200 hover:bg-rose-50 rounded-xl transition-colors shadow-sm"
                              title="Revocar acceso"
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
            </div>
          </CardContent>
        </Card>
      </div>

      {/* MODAL CREAR ADMIN (PORTAL) */}
      {typeof document !== "undefined" && !!addingAdmin && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in-up">
          <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto no-scrollbar rounded-[2rem] shadow-2xl p-6 md:p-8 relative">
            <button
              onClick={() => !isProcessing && setAddingAdmin(null)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <UserPlus size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-black text-[#0B1B3D]">Nuevo Administrador</h3>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Crea una cuenta y define sus accesos</p>
              </div>
            </div>

            <form onSubmit={handleCreate} className="space-y-6">
              {/* DATOS BÁSICOS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nombre Completo</label>
                  <Input
                    value={addingAdmin?.name || ""}
                    onChange={e => setAddingAdmin({ ...addingAdmin, name: e.target.value })}
                    className="h-12 bg-slate-50 border-slate-200 font-semibold focus-visible:ring-indigo-600 rounded-xl"
                    placeholder="Ej. Ing. Carlos Mendoza"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">DNI (Usuario)</label>
                  <Input
                    value={addingAdmin?.dni || ""}
                    onChange={e => setAddingAdmin({ ...addingAdmin, dni: e.target.value.replace(/\D/g, '') })}
                    className="h-12 bg-slate-50 border-slate-200 font-black tracking-widest focus-visible:ring-indigo-600 rounded-xl"
                    maxLength={8}
                    placeholder="8 dígitos"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Contraseña de Acceso</label>
                  <div className="relative">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <Input
                      type={showCreatePass ? "text" : "password"}
                      value={addingAdmin?.password || ""}
                      onChange={e => setAddingAdmin({ ...addingAdmin, password: e.target.value })}
                      className="pl-12 pr-12 h-12 bg-slate-50 border-slate-200 font-medium focus-visible:ring-indigo-600 rounded-xl"
                      placeholder="Mínimo 6 caracteres"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowCreatePass(!showCreatePass)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 outline-none"
                    >
                      {showCreatePass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Sede Asignada (Opcional)</label>
                  <select
                    value={addingAdmin?.campusId || ""}
                    onChange={e => setAddingAdmin({ ...addingAdmin, campusId: e.target.value })}
                    className="w-full h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-600"
                  >
                    <option value="">Todas las Sedes (Global)</option>
                    {campuses.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* PLANTILLAS PREDETERMINADAS */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Sliders size={14} className="text-indigo-600" /> Plantilla de Acceso Rápido
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => applyTemplate(addingAdmin, setAddingAdmin, "admin")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${addingAdmin?.role === "ADMIN_SECUNDARIO"
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                    >
                      Plantilla Estándar (Admin)
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTemplate(addingAdmin, setAddingAdmin, "super")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${addingAdmin?.role === "SUPER_ADMIN"
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                    >
                      Super Admin (Todo)
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  {addingAdmin?.role === "SUPER_ADMIN"
                    ? "El Super Administrador tiene acceso total a todos los módulos y la gestión de administradores."
                    : "La plantilla estándar asigna Resumen, Exportación de Reportes y Personal Operativo. Puedes personalizar cada permiso abajo."}
                </p>
              </div>

              {/* CONTROL MANUAL DE ACCESOS */}
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 block">
                  Permisos y Módulos Permitidos (Control Manual)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {AVAILABLE_MODULES.map((mod) => {
                    const isChecked = addingAdmin?.permissions?.includes(mod.id)
                    return (
                      <div
                        key={mod.id}
                        onClick={() => togglePermission(addingAdmin, setAddingAdmin, mod.id)}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${isChecked
                            ? "bg-indigo-50/70 border-indigo-300 text-indigo-900"
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                      >
                        <div className={`w-5 h-5 rounded-md mt-0.5 flex items-center justify-center shrink-0 border transition-colors ${isChecked ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300 bg-white"
                          }`}>
                          {isChecked && <Check size={14} strokeWidth={3} />}
                        </div>
                        <div className="space-y-0.5">
                          <p className="font-bold text-xs">{mod.name}</p>
                          <p className="text-[11px] text-slate-400 line-clamp-1">{mod.desc}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex gap-4 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-12 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600"
                  onClick={() => setAddingAdmin(null)}
                  disabled={isProcessing}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md shadow-indigo-600/20"
                  disabled={isProcessing}
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={18} /> : "Crear Administrador"}
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL EDITAR ADMIN (PORTAL) */}
      {typeof document !== "undefined" && !!editingAdmin && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in-up">
          <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto no-scrollbar rounded-[2rem] shadow-2xl p-6 md:p-8 relative">
            <button
              onClick={() => !isProcessing && setEditingAdmin(null)}
              className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                <Edit size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-black text-[#0B1B3D]">Editar Administrador</h3>
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Modifica credenciales y permisos granulares</p>
              </div>
            </div>

            <form onSubmit={handleEdit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nombre Completo</label>
                  <Input
                    value={editingAdmin?.name || ""}
                    onChange={e => setEditingAdmin({ ...editingAdmin, name: e.target.value })}
                    className="h-12 bg-slate-50 border-slate-200 font-semibold focus-visible:ring-indigo-600 rounded-xl"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">DNI (Usuario)</label>
                  <Input
                    value={editingAdmin?.dni || ""}
                    onChange={e => setEditingAdmin({ ...editingAdmin, dni: e.target.value.replace(/\D/g, '') })}
                    className="h-12 bg-slate-50 border-slate-200 font-black tracking-widest focus-visible:ring-indigo-600 rounded-xl"
                    maxLength={8}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                    Nueva Contraseña (Opcional)
                  </label>
                  <div className="relative">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <Input
                      type={showEditPass ? "text" : "password"}
                      value={editingAdmin?.password || ""}
                      onChange={e => setEditingAdmin({ ...editingAdmin, password: e.target.value })}
                      className="pl-12 pr-12 h-12 bg-slate-50 border-slate-200 font-medium focus-visible:ring-indigo-600 rounded-xl"
                      placeholder="Dejar en blanco para no cambiar"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPass(!showEditPass)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 outline-none"
                    >
                      {showEditPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Sede Asignada</label>
                  <select
                    value={editingAdmin?.campusId || ""}
                    onChange={e => setEditingAdmin({ ...editingAdmin, campusId: e.target.value })}
                    className="w-full h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-600"
                  >
                    <option value="">Todas las Sedes (Global)</option>
                    {campuses.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* PLANTILLAS */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Sliders size={14} className="text-indigo-600" /> Plantillas de Rol
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => applyTemplate(editingAdmin, setEditingAdmin, "admin")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${editingAdmin?.role === "ADMIN_SECUNDARIO"
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                    >
                      Admin Estándar
                    </button>
                    <button
                      type="button"
                      onClick={() => applyTemplate(editingAdmin, setEditingAdmin, "super")}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition-colors ${editingAdmin?.role === "SUPER_ADMIN"
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                    >
                      Super Admin (Todo)
                    </button>
                  </div>
                </div>
              </div>

              {/* PERMISOS GRANULARES */}
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 block">
                  Permisos Activos (Control Manual por Módulo)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {AVAILABLE_MODULES.map((mod) => {
                    const isChecked = editingAdmin?.permissions?.includes(mod.id)
                    return (
                      <div
                        key={mod.id}
                        onClick={() => togglePermission(editingAdmin, setEditingAdmin, mod.id)}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${isChecked
                            ? "bg-indigo-50/70 border-indigo-300 text-indigo-900"
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                      >
                        <div className={`w-5 h-5 rounded-md mt-0.5 flex items-center justify-center shrink-0 border transition-colors ${isChecked ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-300 bg-white"
                          }`}>
                          {isChecked && <Check size={14} strokeWidth={3} />}
                        </div>
                        <div className="space-y-0.5">
                          <p className="font-bold text-xs">{mod.name}</p>
                          <p className="text-[11px] text-slate-400 line-clamp-1">{mod.desc}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex gap-4 pt-4 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 h-12 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600"
                  onClick={() => setEditingAdmin(null)}
                  disabled={isProcessing}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md shadow-indigo-600/20"
                  disabled={isProcessing}
                >
                  {isProcessing ? <Loader2 className="animate-spin" size={18} /> : "Guardar Cambios"}
                </Button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL ELIMINAR (PORTAL) */}
      {typeof document !== "undefined" && !!deletingAdmin && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in-up">
          <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-6 md:p-8 relative text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center border border-rose-100 mx-auto mb-4">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-2xl font-black text-slate-800 mb-2">Revocar Acceso</h3>
            <p className="text-slate-600 font-medium mb-6">
              ¿Estás seguro que deseas eliminar la cuenta de administrador de <strong>{deletingAdmin?.name}</strong>?
            </p>
            <div className="flex gap-3 w-full">
              <Button
                variant="outline"
                className="flex-1 h-12 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600"
                onClick={() => setDeletingAdmin(null)}
                disabled={isProcessing}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-12 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold shadow-md shadow-rose-600/20"
                onClick={handleDelete}
                disabled={isProcessing}
              >
                {isProcessing ? <Loader2 className="animate-spin" size={18} /> : "Sí, Revocar"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
