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
  Lock,
  Globe,
  MonitorCheck,
  Copy,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { editAdminAction, createAdminAction, revokeAdminAction } from "@/actions/users"
import {
  generateKioskOneTimeCodeAction,
  deleteKioskOneTimeCodeAction,
} from "@/actions/attendance"
import type { KioskOneTimeCode } from "@/lib/kiosk-codes"
import { Role } from "@prisma/client"
import {
  extractAdminCampusId,
  extractAdminTier,
  extractModulePermissions,
  type AdminTier,
} from "@/lib/admin-scope"

export const AVAILABLE_MODULES = [
  { id: "overview", name: "Resumen General", desc: "Métricas del día, flujo de entradas y salidas en vivo." },
  { id: "analytics", name: "Métricas & Analítica", desc: "Gráficos de puntualidad, rankings y tendencias semanales/mensuales." },
  { id: "reports", name: "Exportación & Reportes", desc: "Filtros por fechas y exportación a Excel / PDF oficial." },
  { id: "rules", name: "Horarios & Tolerancias", desc: "Configurar horas de entrada esperadas, gracia y tardanzas." },
  { id: "users", name: "Personal Operativo", desc: "Directorio de docentes, técnicos y pacientes simulados." },
  { id: "catalogs", name: "Sedes & Cursos", desc: "Gestión de campus autorizados y catálogo académico." },
  { id: "admins", name: "Control de Acceso", desc: "Gestión de otros administradores y permisos de cuentas." },
  { id: "kiosk", name: "Vincular Estación Fija", desc: "Autorizar o desvincular equipos fijos de sede para marcar sin GPS." },
] as const

const DEFAULT_SUPER_ADMIN_PERMS = ["overview", "analytics", "reports", "rules", "users", "catalogs", "admins", "kiosk"]
const DEFAULT_ADMIN_GLOBAL_PERMS = ["overview", "analytics", "reports", "rules", "users", "catalogs"]
const DEFAULT_ADMIN_SEDE_PERMS = ["overview", "analytics", "reports", "users"]

interface DashboardAdminsProps {
  admins: any[]
  campuses: { id: string; name: string }[]
  currentUserRole?: "SUPER_ADMIN" | "ADMIN_SECUNDARIO"
  canManageKiosk?: boolean
  initialKioskCodes?: KioskOneTimeCode[]
}

export function DashboardAdmins({
  admins,
  campuses,
  currentUserRole = "SUPER_ADMIN",
  canManageKiosk = true,
  initialKioskCodes = [],
}: DashboardAdminsProps) {
  const [searchTerm, setSearchTerm] = useState("")

  const [editingAdmin, setEditingAdmin] = useState<any | null>(null)
  const [deletingAdmin, setDeletingAdmin] = useState<any | null>(null)
  const [addingAdmin, setAddingAdmin] = useState<any | null>(null)

  const [showCreatePass, setShowCreatePass] = useState(false)
  const [showEditPass, setShowEditPass] = useState(false)

  const [isProcessing, setIsProcessing] = useState(false)

  // Estado para Generador de Códigos de 1 Solo Uso (Estación Oficial)
  const [kioskCodes, setKioskCodes] = useState<KioskOneTimeCode[]>(initialKioskCodes)
  const [codeCampusName, setCodeCampusName] = useState<string>(
    campuses[0]?.name || "Campus Villa"
  )
  const [isGeneratingCode, setIsGeneratingCode] = useState(false)

  const handleGenerateOneTimeCode = async () => {
    setIsGeneratingCode(true)
    try {
      const res = await generateKioskOneTimeCodeAction(codeCampusName)
      if (res.success && res.entry) {
        setKioskCodes((prev) => [res.entry!, ...prev])
        toast.success(`Código [${res.entry.code}] generado para ${res.entry.campusName}`)
      } else {
        toast.error(res.message || "No se pudo generar el código")
      }
    } catch {
      toast.error("Error al generar el código")
    } finally {
      setIsGeneratingCode(false)
    }
  }

  const handleDeleteOneTimeCode = async (code: string) => {
    const res = await deleteKioskOneTimeCodeAction(code)
    if (res.success) {
      setKioskCodes((prev) => prev.filter((c) => c.code !== code))
      toast.info(`Código ${code} eliminado`)
    } else {
      toast.error(res.message)
    }
  }

  const filteredAdmins = admins.filter(
    (a) =>
      a.dni.includes(searchTerm) ||
      a.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getCampusNameById = (id: string | null | undefined) => {
    if (!id) return null
    return campuses.find((c) => c.id === id)?.name || null
  }

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
    const tier: AdminTier = editingAdmin.adminTier || "ADMIN_GLOBAL"
    if (tier === "ADMIN_SEDE" && !editingAdmin.adminCampusId) {
      toast.error("Seleccione la sede asignada para el Admin por Sede.")
      return
    }
    setIsProcessing(true)
    const res = await editAdminAction(editingAdmin.oldDni, {
      name: editingAdmin.name,
      dni: editingAdmin.dni,
      role: (tier === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN_SECUNDARIO") as Role,
      adminTier: tier,
      password: editingAdmin.password,
      campusId: tier === "ADMIN_SEDE" ? editingAdmin.adminCampusId : null,
      permissions: editingAdmin.permissions || [],
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
    const tier: AdminTier = addingAdmin.adminTier || "ADMIN_SEDE"
    if (tier === "ADMIN_SEDE" && !addingAdmin.adminCampusId) {
      toast.error("Seleccione la sede asignada para el Admin por Sede.")
      return
    }
    setIsProcessing(true)
    const res = await createAdminAction({
      name: addingAdmin.name,
      dni: addingAdmin.dni,
      role: (tier === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN_SECUNDARIO") as Role,
      adminTier: tier,
      password: addingAdmin.password,
      campusId: tier === "ADMIN_SEDE" ? addingAdmin.adminCampusId : null,
      permissions: addingAdmin.permissions || [],
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
      setTargetObj({ ...targetObj, permissions: currentPerms.filter((p) => p !== permId) })
    } else {
      setTargetObj({ ...targetObj, permissions: [...currentPerms, permId] })
    }
  }

  const applyTierTemplate = (
    targetObj: any,
    setTargetObj: (val: any) => void,
    tier: AdminTier
  ) => {
    if (tier === "SUPER_ADMIN") {
      setTargetObj({
        ...targetObj,
        role: "SUPER_ADMIN",
        adminTier: "SUPER_ADMIN",
        adminCampusId: "",
        permissions: [...DEFAULT_SUPER_ADMIN_PERMS],
      })
    } else if (tier === "ADMIN_GLOBAL") {
      setTargetObj({
        ...targetObj,
        role: "ADMIN_SECUNDARIO",
        adminTier: "ADMIN_GLOBAL",
        adminCampusId: "",
        permissions: [...DEFAULT_ADMIN_GLOBAL_PERMS],
      })
    } else {
      setTargetObj({
        ...targetObj,
        role: "ADMIN_SECUNDARIO",
        adminTier: "ADMIN_SEDE",
        adminCampusId: targetObj.adminCampusId || campuses[0]?.id || "",
        permissions: [...DEFAULT_ADMIN_SEDE_PERMS],
      })
    }
  }

  return (
    <>
      <div className="space-y-6 animate-fade-in-up">
        {/* TARJETA DE GENERACIÓN DE CÓDIGOS DE 1 SOLO USO PARA ESTACIÓN OFICIAL */}
        {(currentUserRole === "SUPER_ADMIN" || canManageKiosk) && (
          <Card className="border-indigo-200/80 shadow-sm rounded-3xl bg-gradient-to-br from-indigo-50/50 via-white to-blue-50/40 overflow-hidden">
            <CardHeader className="border-b border-indigo-100/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4 py-5 px-8">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-100/80 text-indigo-700 text-xs font-bold uppercase tracking-wider mb-1.5">
                  <MonitorCheck size={13} /> Código de 1 Solo Uso &bull; Estación Oficial (PC)
                </div>
                <CardTitle className="text-xl font-black text-slate-800">
                  Vincular PC de Sede mediante Código de Un Solo Uso
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm font-medium text-slate-500 mt-0.5">
                  Elige la sede, genera un código de 6 dígitos e ingrésalo en la PC de la oficina. Al usarse una vez, configura esa sede automáticamente y el código queda invalidado.
                </CardDescription>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
                <select
                  value={codeCampusName}
                  onChange={(e) => setCodeCampusName(e.target.value)}
                  className="h-11 rounded-xl bg-white border border-indigo-200 px-4 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-600"
                >
                  {campuses.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  disabled={isGeneratingCode}
                  onClick={handleGenerateOneTimeCode}
                  className="h-11 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black px-5 shadow-md shadow-indigo-600/20 cursor-pointer"
                >
                  {isGeneratingCode ? (
                    <Loader2 size={16} className="animate-spin mr-2" />
                  ) : (
                    <Sparkles size={16} className="mr-2" />
                  )}
                  Generar Código (1 Uso)
                </Button>
              </div>
            </CardHeader>

            {kioskCodes.length > 0 && (
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {kioskCodes.slice(0, 9).map((item) => (
                    <div
                      key={item.code}
                      className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
                        item.used
                          ? "bg-slate-50 border-slate-200 opacity-65"
                          : "bg-white border-indigo-200 shadow-xs"
                      }`}
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono text-lg font-black tracking-[0.25em] ${
                              item.used ? "line-through text-slate-400" : "text-indigo-700"
                            }`}
                          >
                            {item.code}
                          </span>
                          <span
                            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                              item.used
                                ? "bg-slate-200 text-slate-600"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {item.used ? "Usado" : "Disponible (1 uso)"}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-700 truncate">
                          📍 {item.campusName}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          Por: {item.createdBy}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {!item.used && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              navigator.clipboard.writeText(item.code)
                              toast.success(`Código ${item.code} copiado al portapapeles`)
                            }}
                            className="h-8 w-8 rounded-lg border-indigo-200 text-indigo-600 hover:bg-indigo-50 cursor-pointer"
                            title="Copiar código"
                          >
                            <Copy size={14} />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleDeleteOneTimeCode(item.code)}
                          className="h-8 w-8 rounded-lg border-rose-200 text-rose-500 hover:bg-rose-50 cursor-pointer"
                          title="Eliminar código"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        <Card className="border-slate-200/60 shadow-sm rounded-3xl bg-white overflow-hidden">
          <CardHeader className="border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 py-6 px-8">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-2">
                <Shield size={13} /> Jerarquía de Roles & Alcance por Sede
              </div>
              <CardTitle className="text-2xl font-black text-slate-800 flex items-center gap-2">
                Control de Acceso y Permisos Granulares
              </CardTitle>
              <CardDescription className="text-sm font-medium mt-1 text-slate-500">
                Configura qué sede visualiza cada administrador de forma independiente a su sede base operativa (Técnico, Docente o Paciente).
              </CardDescription>
            </div>
            <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
              <div className="relative w-full md:w-72">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <Input
                  placeholder="Buscar administrador..."
                  className="pl-12 h-12 bg-slate-50 border-slate-200 rounded-xl w-full font-medium focus-visible:ring-indigo-600"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <Button
                onClick={() =>
                  setAddingAdmin({
                    name: "",
                    dni: "",
                    role: "ADMIN_SECUNDARIO",
                    adminTier: "ADMIN_SEDE",
                    password: "",
                    adminCampusId: campuses[0]?.id || "",
                    permissions: [...DEFAULT_ADMIN_SEDE_PERMS],
                  })
                }
                className="h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold px-6 shadow-md shadow-indigo-600/20 cursor-pointer"
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
                    <TableHead className="font-bold text-slate-600">Vista de Sede (Admin)</TableHead>
                    <TableHead className="font-bold text-slate-600">Nivel de Rol</TableHead>
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
                      const effRole = (admin.adminRole || admin.role) as "SUPER_ADMIN" | "ADMIN_SECUNDARIO"
                      const adminTier = extractAdminTier(admin.permissions, effRole, admin.campusId)
                      const adminCampusId = extractAdminCampusId(admin.permissions, effRole, admin.campusId)
                      const adminCampusName = getCampusNameById(adminCampusId)
                      const cleanPerms = extractModulePermissions(admin.permissions)
                      const adminPerms =
                        cleanPerms.length > 0
                          ? cleanPerms
                          : effRole === "SUPER_ADMIN"
                          ? DEFAULT_SUPER_ADMIN_PERMS
                          : DEFAULT_ADMIN_GLOBAL_PERMS

                      const isOperationalAlso =
                        admin.role === "TECNICO" ||
                        admin.role === "DOCENTE" ||
                        admin.role === "PACIENTE_SIMULADO"

                      return (
                        <TableRow key={admin.id} className="border-slate-100 hover:bg-slate-50/80 transition-colors">
                          <TableCell className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm text-white shrink-0 ${
                                  adminTier === "SUPER_ADMIN"
                                    ? "bg-indigo-600"
                                    : adminTier === "ADMIN_GLOBAL"
                                    ? "bg-[#1967D2]"
                                    : "bg-emerald-600"
                                }`}
                              >
                                {admin.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-slate-800">{admin.name}</p>
                                {isOperationalAlso ? (
                                  <p className="text-[11px] font-semibold text-slate-400">
                                    Rol Operativo: <span className="text-slate-600 font-bold">{admin.role}</span>{" "}
                                    ({admin.campus?.name || "Sin sede fija"})
                                  </p>
                                ) : (
                                  <p className="text-[11px] font-semibold text-indigo-500">
                                    Administrativo Neto
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-bold text-slate-600 font-mono text-sm">
                            {admin.dni}
                          </TableCell>
                          <TableCell>
                            {adminCampusName ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <Building2 size={13} /> Solo {adminCampusName}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                <Globe size={13} /> Todas las Sedes
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {adminTier === "SUPER_ADMIN" ? (
                              <span className="px-3 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase bg-indigo-100 text-indigo-700 border border-indigo-200">
                                Super Admin
                              </span>
                            ) : adminTier === "ADMIN_GLOBAL" ? (
                              <span className="px-3 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase bg-blue-100 text-blue-700 border border-blue-200">
                                Admin General
                              </span>
                            ) : (
                              <span className="px-3 py-1 rounded-lg text-[10px] font-black tracking-widest uppercase bg-emerald-100 text-emerald-700 border border-emerald-200">
                                Admin por Sede
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1 max-w-xs">
                              {adminTier === "SUPER_ADMIN" ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-md border border-indigo-100">
                                  <Lock size={11} /> Acceso Total + Logs ({AVAILABLE_MODULES.length + 1})
                                </span>
                              ) : (
                                adminPerms.map((pid: string) => {
                                  const mod = AVAILABLE_MODULES.find((m) => m.id === pid)
                                  return (
                                    <span
                                      key={pid}
                                      className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md"
                                    >
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
                              disabled={adminTier === "SUPER_ADMIN" && currentUserRole !== "SUPER_ADMIN"}
                              onClick={() =>
                                setEditingAdmin({
                                  ...admin,
                                  role: effRole,
                                  adminTier,
                                  adminCampusId: adminCampusId || "",
                                  oldDni: admin.dni,
                                  password: "",
                                  permissions: adminPerms,
                                })
                              }
                              className="h-9 w-9 text-blue-600 border-blue-200 hover:bg-blue-50 rounded-xl transition-colors shadow-sm cursor-pointer"
                              title="Configurar nivel, sede de visualización y permisos"
                            >
                              <Edit size={16} />
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              disabled={adminTier === "SUPER_ADMIN" && currentUserRole !== "SUPER_ADMIN"}
                              onClick={() => setDeletingAdmin(admin)}
                              className="h-9 w-9 text-rose-600 border-rose-200 hover:bg-rose-50 rounded-xl transition-colors shadow-sm cursor-pointer"
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
      {typeof document !== "undefined" &&
        !!addingAdmin &&
        createPortal(
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
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                    Define su nivel de rol, qué sede(s) visualiza y sus permisos
                  </p>
                </div>
              </div>

              <form onSubmit={handleCreate} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                      Nombre Completo
                    </label>
                    <Input
                      value={addingAdmin?.name || ""}
                      onChange={(e) => setAddingAdmin({ ...addingAdmin, name: e.target.value })}
                      className="h-12 bg-slate-50 border-slate-200 font-semibold focus-visible:ring-indigo-600 rounded-xl"
                      placeholder="Ej. Ing. Carlos Mendoza"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                      DNI (Usuario)
                    </label>
                    <Input
                      value={addingAdmin?.dni || ""}
                      onChange={(e) =>
                        setAddingAdmin({ ...addingAdmin, dni: e.target.value.replace(/\D/g, "") })
                      }
                      className="h-12 bg-slate-50 border-slate-200 font-black tracking-widest focus-visible:ring-indigo-600 rounded-xl"
                      maxLength={8}
                      placeholder="8 dígitos"
                      required
                    />
                  </div>
                </div>

                {/* SELECCIÓN DE LOS 3 NIVELES ADMINISTRATIVOS */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Sliders size={14} className="text-indigo-600" /> Nivel de Rol Administrativo
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      onClick={() => applyTierTemplate(addingAdmin, setAddingAdmin, "ADMIN_SEDE")}
                      className={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                        addingAdmin?.adminTier === "ADMIN_SEDE"
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      <div className="font-black text-xs">1. Admin por Sede</div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          addingAdmin?.adminTier === "ADMIN_SEDE" ? "text-emerald-100" : "text-slate-400"
                        }`}
                      >
                        Ve únicamente la info de su sede asignada
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyTierTemplate(addingAdmin, setAddingAdmin, "ADMIN_GLOBAL")}
                      className={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                        addingAdmin?.adminTier === "ADMIN_GLOBAL"
                          ? "bg-[#1967D2] text-white border-[#1967D2] shadow-sm"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      <div className="font-black text-xs">2. Admin General</div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          addingAdmin?.adminTier === "ADMIN_GLOBAL" ? "text-blue-100" : "text-slate-400"
                        }`}
                      >
                        Ve todas las sedes (sin Logs ni crear Super Admin)
                      </div>
                    </button>

                    {currentUserRole === "SUPER_ADMIN" && (
                      <button
                        type="button"
                        onClick={() => applyTierTemplate(addingAdmin, setAddingAdmin, "SUPER_ADMIN")}
                        className={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                          addingAdmin?.adminTier === "SUPER_ADMIN"
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        <div className="font-black text-xs">3. Super Admin</div>
                        <div
                          className={`text-[11px] mt-0.5 ${
                            addingAdmin?.adminTier === "SUPER_ADMIN" ? "text-indigo-100" : "text-slate-400"
                          }`}
                        >
                          Acceso total sin restricciones + Logs
                        </div>
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                      Contraseña de Acceso
                    </label>
                    <div className="relative">
                      <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <Input
                        type={showCreatePass ? "text" : "password"}
                        value={addingAdmin?.password || ""}
                        onChange={(e) => setAddingAdmin({ ...addingAdmin, password: e.target.value })}
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
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                      Sede que Visualizará como Admin
                    </label>
                    {addingAdmin?.adminTier === "ADMIN_SEDE" ? (
                      <select
                        value={addingAdmin?.adminCampusId || ""}
                        onChange={(e) =>
                          setAddingAdmin({ ...addingAdmin, adminCampusId: e.target.value })
                        }
                        className="w-full h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-600"
                        required
                      >
                        <option value="">Seleccione sede asignada...</option>
                        {campuses.map((c) => (
                          <option key={c.id} value={c.id}>
                            Solo {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="h-12 rounded-xl bg-blue-50/70 border border-blue-200 px-4 flex items-center gap-2 text-xs font-bold text-blue-800">
                        <Globe size={15} className="text-blue-600 shrink-0" />
                        Visualiza todas las sedes (Global)
                      </div>
                    )}
                  </div>
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
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                            isChecked
                              ? "bg-indigo-50/70 border-indigo-300 text-indigo-900"
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <div
                            className={`w-5 h-5 rounded-md mt-0.5 flex items-center justify-center shrink-0 border transition-colors ${
                              isChecked
                                ? "bg-indigo-600 border-indigo-600 text-white"
                                : "border-slate-300 bg-white"
                            }`}
                          >
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
      {typeof document !== "undefined" &&
        !!editingAdmin &&
        createPortal(
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
                  <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                    Su sede de visualización como Admin es independiente de su sede operativa
                  </p>
                </div>
              </div>

              <form onSubmit={handleEdit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                      Nombre Completo
                    </label>
                    <Input
                      value={editingAdmin?.name || ""}
                      onChange={(e) => setEditingAdmin({ ...editingAdmin, name: e.target.value })}
                      className="h-12 bg-slate-50 border-slate-200 font-semibold focus-visible:ring-indigo-600 rounded-xl"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                      DNI (Usuario)
                    </label>
                    <Input
                      value={editingAdmin?.dni || ""}
                      onChange={(e) =>
                        setEditingAdmin({
                          ...editingAdmin,
                          dni: e.target.value.replace(/\D/g, ""),
                        })
                      }
                      className="h-12 bg-slate-50 border-slate-200 font-black tracking-widest focus-visible:ring-indigo-600 rounded-xl"
                      maxLength={8}
                      required
                    />
                  </div>
                </div>

                {/* NIVELES DE ROL EN EDICIÓN */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                    <Sliders size={14} className="text-indigo-600" /> Nivel de Rol Administrativo
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      onClick={() => applyTierTemplate(editingAdmin, setEditingAdmin, "ADMIN_SEDE")}
                      className={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                        editingAdmin?.adminTier === "ADMIN_SEDE"
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      <div className="font-black text-xs">1. Admin por Sede</div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          editingAdmin?.adminTier === "ADMIN_SEDE" ? "text-emerald-100" : "text-slate-400"
                        }`}
                      >
                        Solo ve su sede asignada
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyTierTemplate(editingAdmin, setEditingAdmin, "ADMIN_GLOBAL")}
                      className={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                        editingAdmin?.adminTier === "ADMIN_GLOBAL"
                          ? "bg-[#1967D2] text-white border-[#1967D2] shadow-sm"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      <div className="font-black text-xs">2. Admin General</div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          editingAdmin?.adminTier === "ADMIN_GLOBAL" ? "text-blue-100" : "text-slate-400"
                        }`}
                      >
                        Ve todas las sedes (sin Logs ni crear Super Admin)
                      </div>
                    </button>

                    {currentUserRole === "SUPER_ADMIN" && (
                      <button
                        type="button"
                        onClick={() => applyTierTemplate(editingAdmin, setEditingAdmin, "SUPER_ADMIN")}
                        className={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                          editingAdmin?.adminTier === "SUPER_ADMIN"
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        <div className="font-black text-xs">3. Super Admin</div>
                        <div
                          className={`text-[11px] mt-0.5 ${
                            editingAdmin?.adminTier === "SUPER_ADMIN" ? "text-indigo-100" : "text-slate-400"
                          }`}
                        >
                          Acceso total + Informe de Logs
                        </div>
                      </button>
                    )}
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
                        onChange={(e) =>
                          setEditingAdmin({ ...editingAdmin, password: e.target.value })
                        }
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
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                      Sede que Visualiza como Admin
                    </label>
                    {editingAdmin?.adminTier === "ADMIN_SEDE" ? (
                      <select
                        value={editingAdmin?.adminCampusId || ""}
                        onChange={(e) =>
                          setEditingAdmin({ ...editingAdmin, adminCampusId: e.target.value })
                        }
                        className="w-full h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-600"
                        required
                      >
                        <option value="">Seleccione sede asignada...</option>
                        {campuses.map((c) => (
                          <option key={c.id} value={c.id}>
                            Solo {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="h-12 rounded-xl bg-blue-50/70 border border-blue-200 px-4 flex items-center gap-2 text-xs font-bold text-blue-800">
                        <Globe size={15} className="text-blue-600 shrink-0" />
                        Visualiza todas las sedes (No altera su sede operativa)
                      </div>
                    )}
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
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                            isChecked
                              ? "bg-indigo-50/70 border-indigo-300 text-indigo-900"
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <div
                            className={`w-5 h-5 rounded-md mt-0.5 flex items-center justify-center shrink-0 border transition-colors ${
                              isChecked
                                ? "bg-indigo-600 border-indigo-600 text-white"
                                : "border-slate-300 bg-white"
                            }`}
                          >
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
      {typeof document !== "undefined" &&
        !!deletingAdmin &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in-up">
            <div className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-6 md:p-8 relative text-center">
              <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center border border-rose-100 mx-auto mb-4">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-2xl font-black text-slate-800 mb-2">Revocar Acceso</h3>
              <p className="text-slate-600 font-medium mb-6">
                ¿Estás seguro que deseas revocar el acceso administrativo de{" "}
                <strong>{deletingAdmin?.name}</strong>?
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
