"use client"
import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Edit, Trash2, Users, AlertTriangle, Loader2, UserPlus, UserCircle, FileSpreadsheet, Shield } from "lucide-react"
import { toast } from "sonner"
import { editUserAction, deleteUserAction, createUserAction, createAdminAction } from "@/actions/users"
import { Role } from "@prisma/client"

// Componente Modal Minimalista Integrado con Portal
function Modal({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!isOpen || !mounted || typeof document === "undefined") return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in-up p-4">
      <div className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto no-scrollbar rounded-[2rem] shadow-2xl p-6 md:p-8 relative">
        <button onClick={onClose} type="button" className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition-colors z-10">
          ✕
        </button>
        <h3 className="text-2xl font-black text-[#0B1B3D] mb-6">{title}</h3>
        {children}
      </div>
    </div>,
    document.body
  )
}

export function DashboardUsers({ users, campuses = [] }: { users: any[]; campuses?: { id: string; name: string }[] }) {
  const [searchTerm, setSearchTerm] = useState("")

  const [editingUser, setEditingUser] = useState<any | null>(null)
  const [deletingUser, setDeletingUser] = useState<any | null>(null)

  const [addingMethod, setAddingMethod] = useState(false)
  const [addingUser, setAddingUser] = useState<any | null>(null)
  const [promotingUser, setPromotingUser] = useState<any | null>(null)

  const [isProcessing, setIsProcessing] = useState(false)

  const [activeTab, setActiveTab] = useState<"TODOS" | "DOCENTE" | "TECNICO" | "PACIENTE_SIMULADO">("TODOS")

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.dni.includes(searchTerm) || u.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesTab = activeTab === "TODOS" || u.role === activeTab
    return matchesSearch && matchesTab
  })

  const handleDelete = async () => {
    if (!deletingUser) return
    setIsProcessing(true)
    const res = await deleteUserAction(deletingUser.dni)
    if (res.success) {
      toast.success(res.message)
      setDeletingUser(null)
    } else {
      toast.error(res.message)
    }
    setIsProcessing(false)
  }

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return
    setIsProcessing(true)
    try {
      const res = await editUserAction(editingUser.oldDni, {
        name: editingUser.name,
        dni: editingUser.dni,
        role: editingUser.role as Role,
        campusId: editingUser.campusId || null,
        defaultShift: editingUser.defaultShift || null,
      })

      if (res.success) {
        toast.success(res.message)
        setEditingUser(null)
      } else {
        toast.error(res.message)
      }
    } catch (err: any) {
      console.error("Error al editar usuario:", err)
      toast.error(err?.message || "Ocurrió un error inesperado al guardar los cambios.")
    } finally {
      setIsProcessing(false)
    }
  }

  const handlePromoteToAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!promotingUser) return
    setIsProcessing(true)
    try {
      const res = await createAdminAction({
        name: promotingUser.name,
        dni: promotingUser.dni,
        role: (promotingUser.adminRole || Role.ADMIN_SECUNDARIO) as Role,
        password: promotingUser.password,
        campusId: promotingUser.campusId || null,
      })

      if (res.success) {
        toast.success(res.message)
        setPromotingUser(null)
      } else {
        toast.error(res.message)
      }
    } catch (err: any) {
      toast.error(err?.message || "Error al asignar cargo administrativo.")
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addingUser) return
    setIsProcessing(true)
    const res = await createUserAction({
      name: addingUser.name,
      dni: addingUser.dni,
      role: addingUser.role as Role,
      campusId: addingUser.campusId || null,
      defaultShift: addingUser.defaultShift || null,
    })

    if (res.success) {
      toast.success(res.message)
      setAddingUser(null)
    } else {
      toast.error(res.message)
    }
    setIsProcessing(false)
  }

  return (
    <>
      <div className="animate-fade-in-up">
        <Card className="border-slate-200/60 shadow-sm rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-slate-100 flex flex-col gap-4 py-5 px-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <CardTitle className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
                  <Users size={22} className="text-[#1967D2]" /> Personal Operativo
                </CardTitle>
                <CardDescription className="text-sm font-medium mt-1">Busca, edita o da de baja docentes, técnicos o pacientes simulados.</CardDescription>
              </div>
              <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                <div className="relative w-full md:w-72">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <Input
                    placeholder="Buscar por DNI o Nombre..."
                    className="pl-12 h-12 bg-slate-50 border-slate-200 rounded-xl w-full font-medium focus-visible:ring-[#1967D2]"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
                <Button onClick={() => setAddingMethod(true)} className="h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold px-6 shadow-md shadow-emerald-600/20">
                  <UserPlus className="mr-2" size={20} /> Añadir Usuario
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {[
                { id: "TODOS", label: "Todos" },
                { id: "DOCENTE", label: "Docentes" },
                { id: "TECNICO", label: "Técnicos" },
                { id: "PACIENTE_SIMULADO", label: "Pacientes Simulados" }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-5 py-2 rounded-full text-xs font-bold transition-all ${activeTab === tab.id
                      ? 'bg-[#1967D2] text-white shadow-md shadow-blue-500/20 scale-105'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader className="bg-slate-50/80 sticky top-0 z-10 backdrop-blur-sm">
                  <TableRow className="border-slate-100">
                    <TableHead className="px-6 font-bold text-slate-500 py-4">Nombre Completo</TableHead>
                    <TableHead className="font-bold text-slate-500">DNI</TableHead>
                    <TableHead className="font-bold text-slate-500">Rol</TableHead>
                    <TableHead className="font-bold text-slate-500">Sede Base</TableHead>
                    <TableHead className="font-bold text-slate-500">Turno</TableHead>
                    <TableHead className="text-right px-8 font-bold text-slate-500">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-16 text-slate-500 font-medium text-lg">
                        No se encontraron usuarios que coincidan con la búsqueda.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                        <TableCell className="px-6 font-bold text-slate-800">{user.name}</TableCell>
                        <TableCell className="font-semibold text-slate-500">{user.dni}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 items-center">
                            <span className="px-3 py-1 bg-slate-100 rounded-lg text-[10px] font-black tracking-widest text-slate-600 uppercase">
                              {user.role}
                            </span>
                            {(user.adminRole || user.role === "SUPER_ADMIN" || user.role === "ADMIN_SECUNDARIO") && (
                              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-[9px] font-bold tracking-wider uppercase flex items-center gap-1">
                                <Shield size={10} /> Admin
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-bold text-slate-600">
                          {user.campus?.name ? (
                            <span className="px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
                              📍 {user.campus.name}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">Sin asignar</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-bold text-slate-600">
                          {user.defaultShift === "MANANA" && (
                            <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wider text-[10px] font-black">
                              🌅 Mañana
                            </span>
                          )}
                          {user.defaultShift === "INTERMEDIO" && (
                            <span className="px-2.5 py-1 rounded-md bg-cyan-50 text-cyan-700 border border-cyan-200 uppercase tracking-wider text-[10px] font-black">
                              ⛅ Intermedio
                            </span>
                          )}
                          {user.defaultShift === "TARDE" && (
                            <span className="px-2.5 py-1 rounded-md bg-purple-50 text-purple-700 border border-purple-200 uppercase tracking-wider text-[10px] font-black">
                              🌆 Tarde
                            </span>
                          )}
                          {user.defaultShift === "NOCHE" && (
                            <span className="px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase tracking-wider text-[10px] font-black">
                              🌙 Noche
                            </span>
                          )}
                          {!user.defaultShift && (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-6 text-right space-x-2">
                          <Button
                            variant="outline"
                            size="icon"
                            title="Habilitar Acceso Administrativo (Dashboard)"
                            onClick={() => setPromotingUser({ ...user, adminRole: "ADMIN_SECUNDARIO", password: "" })}
                            className="h-9 w-9 text-indigo-600 border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800 rounded-xl transition-colors shadow-sm"
                          >
                            <Shield size={16} />
                          </Button>
                          <Button variant="outline" size="icon" onClick={() => setEditingUser({ ...user, oldDni: user.dni, campusId: user.campusId || "", defaultShift: user.defaultShift || "" })} className="h-9 w-9 text-blue-600 border-blue-200 hover:bg-blue-100 hover:text-blue-800 rounded-xl transition-colors shadow-sm">
                            <Edit size={16} />
                          </Button>
                          <Button variant="outline" size="icon" onClick={() => setDeletingUser(user)} className="h-9 w-9 text-rose-600 border-rose-200 hover:bg-rose-100 hover:text-rose-800 rounded-xl transition-colors shadow-sm">
                            <Trash2 size={16} />
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
      </div>

      {/* MODAL MODO DE CREACIÓN */}
      <Modal isOpen={addingMethod} onClose={() => setAddingMethod(false)} title="Registrar Usuarios">
        <p className="text-slate-500 font-medium text-center mb-6">Selecciona cómo deseas ingresar a los nuevos usuarios al sistema.</p>
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button onClick={() => { setAddingMethod(false); setAddingUser({ name: '', dni: '', role: 'DOCENTE' }) }} className="flex flex-col items-center justify-center p-6 border-2 border-slate-200 rounded-2xl hover:border-[#1967D2] hover:bg-blue-50 transition-all group bg-white">
            <UserCircle className="text-slate-400 group-hover:text-[#1967D2] mb-3 transition-colors" size={48} />
            <span className="font-extrabold text-slate-700 group-hover:text-[#1967D2]">Individual</span>
            <span className="text-xs text-slate-400 mt-1">Uno por uno</span>
          </button>
          <button onClick={() => {
            setAddingMethod(false);
            const btn = document.getElementById('trigger-upload');
            if (btn) {
              btn.click();
              btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            }
          }} className="flex flex-col items-center justify-center p-6 border-2 border-slate-200 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50 transition-all group bg-white">
            <FileSpreadsheet className="text-slate-400 group-hover:text-emerald-600 mb-3 transition-colors" size={48} />
            <span className="font-extrabold text-slate-700 group-hover:text-emerald-600">Masivamente</span>
            <span className="text-xs text-slate-400 mt-1">Subir archivo Excel</span>
          </button>
        </div>

        <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Descargar Plantillas Excel Oficiales</p>
          <div className="flex flex-col gap-3">
            <a href="/templates/plantilla_docentes.xlsx" download className="text-sm font-bold text-[#1967D2] hover:text-blue-800 hover:bg-blue-100/50 p-2 rounded-lg transition-colors flex items-center gap-3">
              <FileSpreadsheet size={18} /> Plantilla para Docentes
            </a>
            <a href="/templates/plantilla_tecnicos.xlsx" download className="text-sm font-bold text-emerald-600 hover:text-emerald-800 hover:bg-emerald-100/50 p-2 rounded-lg transition-colors flex items-center gap-3">
              <FileSpreadsheet size={18} /> Plantilla para Técnicos
            </a>
            <a href="/templates/plantilla_pacientes.xlsx" download className="text-sm font-bold text-purple-600 hover:text-purple-800 hover:bg-purple-100/50 p-2 rounded-lg transition-colors flex items-center gap-3">
              <FileSpreadsheet size={18} /> Plantilla para Pacientes Simulados
            </a>
          </div>
        </div>
      </Modal>

      {/* MODAL CREAR INDIVIDUAL */}
      <Modal isOpen={!!addingUser} onClose={() => !isProcessing && setAddingUser(null)} title="Nuevo Usuario">
        <form onSubmit={handleCreate} className="space-y-6">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nombre Completo</label>
            <Input
              value={addingUser?.name || ""}
              onChange={e => setAddingUser({ ...addingUser, name: e.target.value })}
              className="h-14 bg-slate-50 border-slate-200 font-semibold focus-visible:ring-[#1967D2]"
              required
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Número de DNI</label>
            <Input
              value={addingUser?.dni || ""}
              onChange={e => setAddingUser({ ...addingUser, dni: e.target.value.replace(/\D/g, '') })}
              className="h-14 bg-slate-50 border-slate-200 font-black tracking-widest focus-visible:ring-[#1967D2]"
              maxLength={8}
              required
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Rol de Sistema</label>
            <select
              value={addingUser?.role || ""}
              onChange={e => setAddingUser({ ...addingUser, role: e.target.value })}
              className="w-full h-14 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2] transition-all"
            >
              <option value="DOCENTE">Docente</option>
              <option value="TECNICO">Técnico</option>
              <option value="PACIENTE_SIMULADO">Paciente Simulado</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Sede Base / Asignada</label>
            <select
              value={addingUser?.campusId || ""}
              onChange={e => setAddingUser({ ...addingUser, campusId: e.target.value })}
              className="w-full h-14 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2] transition-all"
            >
              <option value="">(Sin sede base)</option>
              {campuses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {addingUser?.role === "TECNICO" && (
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Turno Predeterminado (Técnicos)</label>
              <select
                value={addingUser?.defaultShift || "MANANA"}
                onChange={e => setAddingUser({ ...addingUser, defaultShift: e.target.value })}
                className="w-full h-14 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2] transition-all"
              >
                <option value="MANANA">Mañana (6:00 AM — 3:00 PM)</option>
                <option value="INTERMEDIO">Intermedio (9:00 AM — 6:00 PM / Sáb 8 AM / Dom 10 AM)</option>
                <option value="TARDE">Tarde (1:00 PM — 10:00 PM)</option>
              </select>
            </div>
          )}

          <div className="flex gap-4 pt-6 border-t border-slate-100">
            <Button type="button" variant="outline" className="flex-1 h-14 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600" onClick={() => setAddingUser(null)} disabled={isProcessing}>Cancelar</Button>
            <Button type="submit" className="flex-1 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md shadow-emerald-600/20" disabled={isProcessing}>
              {isProcessing ? <Loader2 className="animate-spin" /> : "Registrar Usuario"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL ELIMINAR */}
      <Modal isOpen={!!deletingUser} onClose={() => !isProcessing && setDeletingUser(null)} title="Eliminar Usuario">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center border border-rose-100">
            <AlertTriangle size={32} />
          </div>
          <p className="text-slate-600 font-medium">
            ¿Estás seguro que deseas eliminar a <strong>{deletingUser?.name}</strong>? Esta acción borrará también todo su historial de asistencia de forma permanente.
          </p>
          <div className="flex gap-4 w-full mt-6">
            <Button variant="outline" className="flex-1 h-14 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600" onClick={() => setDeletingUser(null)} disabled={isProcessing}>Cancelar</Button>
            <Button className="flex-1 h-14 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold shadow-md shadow-rose-600/20" onClick={handleDelete} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="animate-spin" /> : "Sí, Eliminar"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL EDITAR */}
      <Modal isOpen={!!editingUser} onClose={() => !isProcessing && setEditingUser(null)} title="Editar Información">
        <form onSubmit={handleEdit} className="space-y-6">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nombre Completo</label>
            <Input
              value={editingUser?.name || ""}
              onChange={e => setEditingUser({ ...editingUser, name: e.target.value })}
              className="h-14 bg-slate-50 border-slate-200 font-semibold focus-visible:ring-[#1967D2]"
              required
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Número de DNI</label>
            <Input
              value={editingUser?.dni || ""}
              onChange={e => setEditingUser({ ...editingUser, dni: e.target.value.replace(/\D/g, '') })}
              className="h-14 bg-slate-50 border-slate-200 font-black tracking-widest focus-visible:ring-[#1967D2]"
              maxLength={8}
              required
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nivel de Acceso (Rol)</label>
            <select
              value={editingUser?.role || ""}
              onChange={e => setEditingUser({ ...editingUser, role: e.target.value })}
              className="w-full h-14 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2] transition-all"
            >
              <option value="DOCENTE">Docente</option>
              <option value="TECNICO">Técnico</option>
              <option value="PACIENTE_SIMULADO">Paciente Simulado</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Sede Base / Predeterminada</label>
            <select
              value={editingUser?.campusId || ""}
              onChange={e => setEditingUser({ ...editingUser, campusId: e.target.value })}
              className="w-full h-14 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2] transition-all"
            >
              <option value="">(Sin sede base)</option>
              {campuses.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {editingUser?.role === "TECNICO" && (
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Turno Predeterminado</label>
              <select
                value={editingUser?.defaultShift || "MANANA"}
                onChange={e => setEditingUser({ ...editingUser, defaultShift: e.target.value })}
                className="w-full h-14 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#1967D2] transition-all"
              >
                <option value="MANANA">Mañana (6:00 AM — 3:00 PM)</option>
                <option value="INTERMEDIO">Intermedio (9:00 AM — 6:00 PM / Sáb 8 AM / Dom 10 AM)</option>
                <option value="TARDE">Tarde (1:00 PM — 10:00 PM)</option>
              </select>
            </div>
          )}

          <div className="flex gap-4 pt-6 border-t border-slate-100">
            <Button type="button" variant="outline" className="flex-1 h-14 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600" onClick={() => setEditingUser(null)} disabled={isProcessing}>Cancelar</Button>
            <Button type="submit" className="flex-1 h-14 bg-[#1967D2] hover:bg-blue-800 text-white rounded-xl font-bold shadow-md shadow-blue-600/20" disabled={isProcessing}>
              {isProcessing ? <Loader2 className="animate-spin" /> : "Guardar Cambios"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL PROMOVER A ADMINISTRADOR */}
      <Modal isOpen={!!promotingUser} onClose={() => !isProcessing && setPromotingUser(null)} title="Asignar Cargo de Administrador">
        <form onSubmit={handlePromoteToAdmin} className="space-y-5">
          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs text-indigo-900 flex items-start gap-3">
            <Shield className="text-indigo-600 shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-bold text-sm">Acceso al Dashboard Administrativo</p>
              <p className="mt-1 leading-relaxed text-indigo-700">
                <strong>{promotingUser?.name}</strong> (DNI: {promotingUser?.dni}) mantendrá su registro y podrá seguir marcando su asistencia de <strong>{promotingUser?.role}</strong>, pero ahora tendrá credenciales para iniciar sesión en el panel y ver todas las marcaciones.
              </p>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nivel de Administrador</label>
            <select
              value={promotingUser?.adminRole || "ADMIN_SECUNDARIO"}
              onChange={e => setPromotingUser({ ...promotingUser, adminRole: e.target.value })}
              className="w-full h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-600 transition-all"
            >
              <option value="ADMIN_SECUNDARIO">Admin Secundario (Gestión y Reportes)</option>
              <option value="SUPER_ADMIN">Super Administrador (Control Total del Sistema)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Contraseña para Iniciar Sesión</label>
            <Input
              type="password"
              value={promotingUser?.password || ""}
              onChange={e => setPromotingUser({ ...promotingUser, password: e.target.value })}
              className="h-12 bg-slate-50 border-slate-200 font-medium focus-visible:ring-indigo-600 rounded-xl"
              placeholder="Mínimo 6 caracteres"
              required
            />
            <p className="text-[11px] text-slate-400 mt-1">Con su DNI ({promotingUser?.dni}) y esta contraseña podrá ingresar al Dashboard.</p>
          </div>

          <div className="flex gap-4 pt-4 border-t border-slate-100">
            <Button type="button" variant="outline" className="flex-1 h-12 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600" onClick={() => setPromotingUser(null)} disabled={isProcessing}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md shadow-indigo-600/20" disabled={isProcessing}>
              {isProcessing ? <Loader2 className="animate-spin" /> : "Otorgar Acceso Admin"}
            </Button>
          </div>
        </form>
      </Modal>

    </>
  )
}
