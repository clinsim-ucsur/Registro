"use client"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Edit, Trash2, Shield, AlertTriangle, Loader2, UserPlus, Key, Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"
import { editAdminAction, deleteUserAction, createAdminAction } from "@/actions/users"
import { Role } from "@prisma/client"

// Componente Modal Minimalista Integrado
function Modal({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-fade-in-up">
      <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-6 md:p-8 relative">
        <button onClick={onClose} className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full w-8 h-8 flex items-center justify-center transition-colors">
          ✕
        </button>
        <h3 className="text-2xl font-black text-[#0B1B3D] mb-6">{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function DashboardAdmins({ admins }: { admins: any[] }) {
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
    const res = await deleteUserAction(deletingAdmin.dni)
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
      password: editingAdmin.password // Opcional, si está vacío no se cambia
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
      password: addingAdmin.password
    })
    
    if (res.success) {
      toast.success(res.message)
      setAddingAdmin(null)
    } else {
      toast.error(res.message)
    }
    setIsProcessing(false)
  }

  return (
    <>
      <div className="animate-fade-in-up">
        <Card className="border-slate-200/60 shadow-sm rounded-2xl bg-white overflow-hidden">
        <CardHeader className="border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 py-5 px-6">
          <div>
            <CardTitle className="text-xl font-extrabold text-slate-800 flex items-center gap-2">
              <Shield size={22} className="text-indigo-600" /> Control de Acceso
            </CardTitle>
            <CardDescription className="text-sm font-medium mt-1">Gestiona los permisos y contraseñas de los administradores del sistema.</CardDescription>
          </div>
          <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
            <div className="relative w-full md:w-72">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <Input 
                placeholder="Buscar administrador..." 
                className="pl-12 h-12 bg-slate-50 border-slate-200 rounded-xl w-full font-medium focus-visible:ring-indigo-600"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <Button onClick={() => setAddingAdmin({ name: '', dni: '', role: 'ADMIN_SECUNDARIO', password: '' })} className="h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold px-6 shadow-md shadow-indigo-600/20">
              <UserPlus className="mr-2" size={20} /> Añadir Administrador
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader className="bg-slate-50/80 sticky top-0 z-10 backdrop-blur-sm">
                <TableRow className="border-slate-100">
                  <TableHead className="px-6 font-bold text-slate-500 py-4">Nombre Completo</TableHead>
                  <TableHead className="font-bold text-slate-500">DNI (Usuario)</TableHead>
                  <TableHead className="font-bold text-slate-500">Nivel de Acceso</TableHead>
                  <TableHead className="text-right px-8 font-bold text-slate-500">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAdmins.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-16 text-slate-500 font-medium text-lg">
                      No se encontraron administradores.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAdmins.map((admin) => (
                    <TableRow key={admin.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                      <TableCell className="px-6 font-bold text-slate-800">{admin.name}</TableCell>
                      <TableCell className="font-semibold text-slate-500">{admin.dni}</TableCell>
                      <TableCell>
                        <span className={`px-3 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase ${admin.role === 'SUPER_ADMIN' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                          {admin.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}
                        </span>
                      </TableCell>
                      <TableCell className="px-6 text-right space-x-3">
                        <Button variant="outline" size="icon" onClick={() => setEditingAdmin({ ...admin, oldDni: admin.dni, password: '' })} className="h-9 w-9 text-blue-600 border-blue-200 hover:bg-blue-100 hover:text-blue-800 rounded-xl transition-colors shadow-sm">
                          <Edit size={16} />
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => setDeletingAdmin(admin)} className="h-9 w-9 text-rose-600 border-rose-200 hover:bg-rose-100 hover:text-rose-800 rounded-xl transition-colors shadow-sm">
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

      {/* MODAL CREAR ADMIN */}
      <Modal isOpen={!!addingAdmin} onClose={() => !isProcessing && setAddingAdmin(null)} title="Nuevo Administrador">
         <form onSubmit={handleCreate} className="space-y-6">
           <div>
             <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nombre Completo</label>
             <Input 
               value={addingAdmin?.name || ""} 
               onChange={e => setAddingAdmin({...addingAdmin, name: e.target.value})}
               className="h-14 bg-slate-50 border-slate-200 font-semibold focus-visible:ring-indigo-600"
               required
             />
           </div>
           <div>
             <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Número de DNI (Se usará como Usuario)</label>
             <Input 
               value={addingAdmin?.dni || ""} 
               onChange={e => setAddingAdmin({...addingAdmin, dni: e.target.value.replace(/\D/g, '')})}
               className="h-14 bg-slate-50 border-slate-200 font-black tracking-widest focus-visible:ring-indigo-600"
               maxLength={8}
               required
             />
           </div>
           <div>
             <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Contraseña de Acceso</label>
             <div className="relative">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <Input 
                  type={showCreatePass ? "text" : "password"}
                  value={addingAdmin?.password || ""} 
                  onChange={e => setAddingAdmin({...addingAdmin, password: e.target.value})}
                  className="pl-12 pr-12 h-14 bg-slate-50 border-slate-200 font-medium focus-visible:ring-indigo-600"
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
             <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Privilegios</label>
             <select 
               value={addingAdmin?.role || ""} 
               onChange={e => setAddingAdmin({...addingAdmin, role: e.target.value})}
               className="w-full h-14 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-600 transition-all"
             >
               <option value="ADMIN_SECUNDARIO">Administrador Secundario</option>
               <option value="SUPER_ADMIN">Super Administrador (Control Total)</option>
             </select>
           </div>
           
           <div className="flex gap-4 pt-6 border-t border-slate-100">
              <Button type="button" variant="outline" className="flex-1 h-14 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600" onClick={() => setAddingAdmin(null)} disabled={isProcessing}>Cancelar</Button>
              <Button type="submit" className="flex-1 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md shadow-indigo-600/20" disabled={isProcessing}>
                {isProcessing ? <Loader2 className="animate-spin" /> : "Crear Admin"}
              </Button>
            </div>
         </form>
      </Modal>

      {/* MODAL ELIMINAR */}
      <Modal isOpen={!!deletingAdmin} onClose={() => !isProcessing && setDeletingAdmin(null)} title="Eliminar Admin">
         <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center border border-rose-100">
              <AlertTriangle size={32} />
            </div>
            <p className="text-slate-600 font-medium">
              ¿Estás seguro que deseas revocar el acceso a <strong>{deletingAdmin?.name}</strong>?
            </p>
            <div className="flex gap-4 w-full mt-6">
              <Button variant="outline" className="flex-1 h-14 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600" onClick={() => setDeletingAdmin(null)} disabled={isProcessing}>Cancelar</Button>
              <Button className="flex-1 h-14 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold shadow-md shadow-rose-600/20" onClick={handleDelete} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="animate-spin" /> : "Sí, Revocar"}
              </Button>
            </div>
         </div>
      </Modal>

      {/* MODAL EDITAR ADMIN */}
      <Modal isOpen={!!editingAdmin} onClose={() => !isProcessing && setEditingAdmin(null)} title="Editar Administrador">
         <form onSubmit={handleEdit} className="space-y-6">
           <div>
             <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nombre Completo</label>
             <Input 
               value={editingAdmin?.name || ""} 
               onChange={e => setEditingAdmin({...editingAdmin, name: e.target.value})}
               className="h-14 bg-slate-50 border-slate-200 font-semibold focus-visible:ring-indigo-600"
               required
             />
           </div>
           <div>
             <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">DNI (Usuario)</label>
             <Input 
               value={editingAdmin?.dni || ""} 
               onChange={e => setEditingAdmin({...editingAdmin, dni: e.target.value.replace(/\D/g, '')})}
               className="h-14 bg-slate-50 border-slate-200 font-black tracking-widest focus-visible:ring-indigo-600"
               maxLength={8}
               required
             />
           </div>
           <div>
             <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Nueva Contraseña (Dejar en blanco si no cambia)</label>
             <div className="relative">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <Input 
                  type={showEditPass ? "text" : "password"}
                  value={editingAdmin?.password || ""} 
                  onChange={e => setEditingAdmin({...editingAdmin, password: e.target.value})}
                  className="pl-12 pr-12 h-14 bg-slate-50 border-slate-200 font-medium focus-visible:ring-indigo-600"
                  placeholder="******"
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
             <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Privilegios</label>
             <select 
               value={editingAdmin?.role || ""} 
               onChange={e => setEditingAdmin({...editingAdmin, role: e.target.value})}
               className="w-full h-14 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-600 transition-all"
             >
               <option value="ADMIN_SECUNDARIO">Administrador Secundario</option>
               <option value="SUPER_ADMIN">Super Administrador (Control Total)</option>
             </select>
           </div>
           
           <div className="flex gap-4 pt-6 border-t border-slate-100">
              <Button type="button" variant="outline" className="flex-1 h-14 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600" onClick={() => setEditingAdmin(null)} disabled={isProcessing}>Cancelar</Button>
              <Button type="submit" className="flex-1 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md shadow-indigo-600/20" disabled={isProcessing}>
                {isProcessing ? <Loader2 className="animate-spin" /> : "Guardar"}
              </Button>
            </div>
         </form>
      </Modal>

    </>
  )
}
