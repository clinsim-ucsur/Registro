import prisma from "@/lib/prisma"
import { 
  LayoutDashboard, 
  UploadCloud, 
  FileText, 
  LogOut, 
  Users, 
  Shield, 
  BarChart3, 
  Clock,
  Layers,
  Calendar as CalendarIcon,
  CalendarClock,
  ScrollText,
  Globe,
  BookOpen
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { redirect } from "next/navigation"

import { DashboardOverview } from "@/components/dashboard/overview"
import { DashboardUpload } from "@/components/dashboard/upload"
import { DashboardReports } from "@/components/dashboard/reports"
import { DashboardUsers } from "@/components/dashboard/users"
import { DashboardAdmins } from "@/components/dashboard/admins"
import { DashboardAnalytics } from "@/components/dashboard/analytics"
import { DashboardRules } from "@/components/dashboard/rules"
import { DashboardCatalogs } from "@/components/dashboard/catalogs"
import { DashboardSchedules } from "@/components/dashboard/schedules"
import { DashboardDailyProgram } from "@/components/dashboard/daily-program"
import { DashboardAuditLogs } from "@/components/dashboard/audit-logs"
import { DashboardManuals } from "@/components/dashboard/manuals"
import { ForceChangePasswordModal } from "@/components/dashboard/force-change-password-modal"
import { getAdminSession } from "@/lib/session"
import { computeAnalytics } from "@/lib/analytics"
import { formatDayLabel } from "@/lib/timezone"
import { getOvertimeSettingsAction } from "@/actions/overtime"
import { getAuditLogs } from "@/lib/audit-log"
import { getKioskOneTimeCodesList } from "@/lib/kiosk-codes"

export default async function DashboardPage() {
  const session = await getAdminSession()
  if (!session) redirect("/login")
  
  const currentUserRole = session.role
  const adminTier = session.adminTier
  const scopedRole = session.scopedRole // "PACIENTE_SIMULADO" para Coordinador de Pacientes Simulados, null para el resto
  const scopedCampusId = session.campusId // null para Todas las Sedes; ID de sede si está restringido a 1 sede
  const permissions = session.permissions || []

  // Helper de permiso: Si es SUPER_ADMIN o tiene el permiso explícito en su cuenta
  const hasAccess = (moduleId: string) => {
    if (moduleId === "logs") {
      return currentUserRole === "SUPER_ADMIN"
    }
    if (currentUserRole === "SUPER_ADMIN") return true
    return permissions.includes(moduleId)
  }

  const [
    records,
    rawUsers,
    rawAdmins,
    initialAnalytics,
    rules,
    allCampusesWithCounts,
    catalogCourses,
    technicianSchedules,
    overtimeSettings,
    auditLogs,
    kioskCodes,
  ] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        ...(scopedCampusId ? { campusId: scopedCampusId } : {}),
        ...(scopedRole ? { user: { role: scopedRole } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: 1000,
      include: {
        // Solo los campos necesarios (nunca enviar contraseñas al navegador y reducir el peso de la página)
        user: { select: { id: true, name: true, dni: true, role: true, defaultShift: true } },
        campus: { select: { id: true, name: true } },
        course: { select: { id: true, name: true } },
      }
    }),
    // Personal Operativo: Si es Coordinador de Pacientes Simulados, solo obtiene PACIENTE_SIMULADO.
    // Los administrativos netos (role = SUPER_ADMIN / ADMIN_SECUNDARIO) NUNCA aparecen aquí.
    prisma.user.findMany({
      where: {
        role: scopedRole ? scopedRole : { in: ['DOCENTE', 'TECNICO', 'PACIENTE_SIMULADO'] },
        ...(scopedCampusId ? { campusId: scopedCampusId } : {}),
      },
      include: { campus: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    hasAccess("admins") || hasAccess("kiosk")
      ? prisma.user.findMany({
          where: {
            OR: [
              { adminRole: { in: ['SUPER_ADMIN', 'ADMIN_SECUNDARIO'] } },
              { role: { in: ['SUPER_ADMIN', 'ADMIN_SECUNDARIO'] } }
            ]
          },
          include: { campus: { select: { id: true, name: true } } },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    computeAnalytics({ days: 30, campusId: scopedCampusId, roleFilter: scopedRole }),
    hasAccess("rules")
      ? prisma.toleranceRule.findMany({
          where: scopedCampusId ? { OR: [{ campusId: scopedCampusId }, { campusId: null }] } : undefined,
          include: { campus: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
    prisma.campus.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { users: true, records: true, rules: true }
        }
      }
    }),
    hasAccess("catalogs")
      ? prisma.course.findMany({
          orderBy: { name: 'asc' },
          include: {
            _count: {
              select: { records: true }
            }
          }
        })
      : Promise.resolve([]),
    (hasAccess("rules") || hasAccess("users")) && !scopedRole
      ? prisma.technicianSchedule.findMany({
          where: scopedCampusId ? { campusId: scopedCampusId } : undefined,
          orderBy: [{ date: 'desc' }, { expectedEntryTime: 'asc' }],
          include: {
            user: { select: { id: true, name: true, dni: true } },
            campus: { select: { id: true, name: true } },
          },
          take: 300,
        })
      : Promise.resolve([]),
    hasAccess("reports") ? getOvertimeSettingsAction() : Promise.resolve(undefined),
    currentUserRole === "SUPER_ADMIN" ? getAuditLogs() : Promise.resolve([]),
    hasAccess("kiosk") ? getKioskOneTimeCodesList() : Promise.resolve([]),
  ])

  // Nunca enviar contraseñas (ni hashes) a los componentes cliente
  const users = rawUsers.map(({ password: _pw, ...u }) => u)
  const admins = rawAdmins.map(({ password: _pw, ...a }) => a)

  const allCampuses = allCampusesWithCounts.map((c) => ({ id: c.id, name: c.name }))
  const catalogCampuses = scopedCampusId
    ? allCampusesWithCounts.filter((c) => c.id === scopedCampusId)
    : allCampusesWithCounts

  const weeklySeries = initialAnalytics.daily.slice(-7).map((d) => ({
    ...d,
    label: formatDayLabel(d.day),
  }))

  // Sedes visibles según el alcance del administrador logueado
  const visibleCampuses = scopedCampusId
    ? allCampuses.filter((c) => c.id === scopedCampusId)
    : allCampuses

  // Determinar default tab accesible
  const defaultTab = hasAccess("overview") ? "overview" :
    hasAccess("analytics") ? "analytics" :
    hasAccess("reports") ? "reports" :
    hasAccess("rules") ? "rules" :
    hasAccess("users") ? "users" :
    hasAccess("catalogs") ? "catalogs" :
    hasAccess("admins") ? "admins" : "overview"

  const tierLabel =
    adminTier === "SUPER_ADMIN"
      ? "Super Admin"
      : adminTier === "COORDINADOR_PACIENTES"
      ? "Coord. Pacientes Simulados"
      : adminTier === "ADMIN_SEDE"
      ? `Admin por Sede`
      : "Admin General"
  
  return (
    <Tabs defaultValue={defaultTab} orientation="vertical" className="flex flex-row h-screen w-full bg-slate-50 overflow-hidden font-sans">
      
      {/* SIDEBAR IZQUIERDO */}
      <div className="w-72 bg-[#0B1B3D] text-white shadow-2xl flex flex-col shrink-0 z-20">
        
        {/* Cabecera / Logo del Sidebar */}
        <div className="p-8 border-b border-white/10">
          <h2 className="text-2xl font-black tracking-tight">Admin<span className="text-[#1967D2]">Panel</span></h2>
          <p className="text-xs text-slate-400 mt-2 font-medium tracking-wide uppercase">Científica del Sur</p>
          {session.campusName ? (
            <div className="mt-3 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-xs font-bold text-emerald-200">
              📍 Vista: {session.campusName}
            </div>
          ) : (
            <div className="mt-3 px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-xs font-bold text-blue-200 flex items-center gap-1.5">
              <Globe size={13} /> Vista: Todas las Sedes
            </div>
          )}
          {scopedRole === "PACIENTE_SIMULADO" && (
            <div className="mt-2 px-3 py-1.5 rounded-xl bg-purple-500/20 border border-purple-400/30 text-xs font-bold text-purple-200">
              👩‍⚕️ Solo Pacientes Simulados
            </div>
          )}
        </div>

        {/* Menú de Navegación (Tabs) */}
        <div className="flex-1 p-4 overflow-y-auto no-scrollbar">
          <TabsList className="flex flex-col items-stretch justify-start h-auto bg-transparent p-0 w-full gap-2.5">
            
            {hasAccess("overview") && (
              <TabsTrigger 
                value="overview" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <LayoutDashboard size={20}/> Resumen
              </TabsTrigger>
            )}

            {hasAccess("analytics") && (
              <TabsTrigger 
                value="analytics" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <BarChart3 size={20}/> Métricas
              </TabsTrigger>
            )}
            
            <TabsTrigger 
              id="trigger-upload"
              value="upload" 
              className="hidden"
            >
              <UploadCloud size={20}/> Carga Masiva
            </TabsTrigger>
            
            {hasAccess("reports") && (
              <TabsTrigger 
                value="reports" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <FileText size={20}/> Exportación
              </TabsTrigger>
            )}

            {hasAccess("rules") && (
              <TabsTrigger 
                value="rules" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <Clock size={20}/> Horarios y Tolerancias
              </TabsTrigger>
            )}

            {(hasAccess("rules") || hasAccess("users")) && !scopedRole && (
              <TabsTrigger 
                value="schedules" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <CalendarIcon size={20}/> Cronograma Técnicos
              </TabsTrigger>
            )}

            {(hasAccess("users") || hasAccess("overview") || hasAccess("rules")) && (
              <TabsTrigger 
                id="trigger-daily-program"
                value="daily-program" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-emerald-200/95 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <CalendarClock size={20}/> Horarios del Día (Excel)
              </TabsTrigger>
            )}

            <div className="h-px w-full bg-white/5 my-1"></div>

            {hasAccess("users") && (
              <TabsTrigger 
                value="users" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <Users size={20}/> {scopedRole === "PACIENTE_SIMULADO" ? "Pacientes Simulados" : "Personal Operativo"}
              </TabsTrigger>
            )}

            {hasAccess("catalogs") && (
              <TabsTrigger 
                value="catalogs" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <Layers size={20}/> Sedes & Cursos
              </TabsTrigger>
            )}
            
            {(hasAccess("admins") || hasAccess("kiosk")) && (
              <TabsTrigger 
                value="admins" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-indigo-900/50 hover:bg-white/5 transition-all outline-none mt-1"
              >
                <Shield size={20}/> Control de Acceso
              </TabsTrigger>
            )}

            {currentUserRole === "SUPER_ADMIN" && (
              <TabsTrigger 
                value="logs" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-amber-200/90 data-[state=active]:bg-amber-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-amber-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <ScrollText size={20}/> Informe de Logs
              </TabsTrigger>
            )}

            <TabsTrigger 
              value="manuals" 
              className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
            >
              <BookOpen size={20}/> Manuales PDF
            </TabsTrigger>
            
          </TabsList>
        </div>
        
        {/* Footer Sidebar (Botón Salir) */}
        <div className="p-6 border-t border-white/10">
          <form action="/api/logout" method="POST">
            <button type="submit" className="flex w-full items-center justify-center gap-3 px-4 py-3.5 text-sm font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 rounded-2xl transition-colors">
              <LogOut size={20}/> Cerrar Sesión
            </button>
          </form>
        </div>
      </div>

      {/* ÁREA DE CONTENIDO (DERECHA) */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-50/80">
        
        {/* Barra superior (Topbar) */}
        <header className="h-24 bg-white/80 backdrop-blur-md border-b border-slate-200 px-10 flex items-center justify-between shrink-0 z-10">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Centro de Control</h1>
            <p className="text-sm font-medium text-slate-500">
              Gestión y Monitoreo en Tiempo Real — {session.campusName ? `Sede: ${session.campusName}` : "Todas las Sedes"}
              {scopedRole === "PACIENTE_SIMULADO" ? " • Pacientes Simulados" : ""}
            </p>
          </div>
          
           {/* Perfil del Usuario Logueado */}
          <div className="flex items-center gap-4 bg-slate-50 py-2 px-4 rounded-full border border-slate-200/60 shadow-sm">
             <div className="text-right hidden md:block">
                <p className="text-sm font-bold text-slate-800">{session.name || "Administrador"}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-black">
                  {tierLabel} {session.campusName ? `(${session.campusName})` : ""}
                </p>
             </div>
             <div className={`w-10 h-10 text-white font-black flex items-center justify-center rounded-full shadow-sm ${currentUserRole === 'SUPER_ADMIN' ? 'bg-indigo-600 shadow-indigo-500/30' : adminTier === 'COORDINADOR_PACIENTES' ? 'bg-purple-600 shadow-purple-500/30' : 'bg-[#1967D2] shadow-blue-500/30'}`}>
                {session.name ? session.name.slice(0, 2).toUpperCase() : (currentUserRole === 'SUPER_ADMIN' ? 'SA' : 'AD')}
             </div>
          </div>
        </header>

        {/* Scroll principal del contenido */}
        <main className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar">
          <div className="max-w-[1400px] mx-auto pb-10">
            
            {hasAccess("overview") && (
              <TabsContent value="overview" className="m-0 p-0 outline-none">
                <DashboardOverview records={records} weekly={weeklySeries} />
              </TabsContent>
            )}

            {hasAccess("analytics") && (
              <TabsContent value="analytics" className="m-0 p-0 outline-none">
                <DashboardAnalytics initialData={initialAnalytics} />
              </TabsContent>
            )}

            <TabsContent value="upload" className="m-0 p-0 outline-none">
              <DashboardUpload />
            </TabsContent>

            {hasAccess("reports") && (
              <TabsContent value="reports" className="m-0 p-0 outline-none">
                <DashboardReports
                  initialRecords={records}
                  campuses={visibleCampuses}
                  initialOvertimeSettings={overtimeSettings}
                  lockedOperationalRole={scopedRole}
                />
              </TabsContent>
            )}

            {hasAccess("rules") && (
              <TabsContent value="rules" className="m-0 p-0 outline-none">
                <DashboardRules
                  rules={rules}
                  campuses={visibleCampuses}
                  technicians={users.filter((u) => u.role === "TECNICO") as any}
                />
              </TabsContent>
            )}

            {(hasAccess("rules") || hasAccess("users")) && !scopedRole && (
              <TabsContent value="schedules" className="m-0 p-0 outline-none">
                <DashboardSchedules
                  initialSchedules={technicianSchedules as any}
                  technicians={users.filter((u) => u.role === "TECNICO") as any}
                  campuses={visibleCampuses}
                />
              </TabsContent>
            )}

            {(hasAccess("users") || hasAccess("overview") || hasAccess("rules")) && (
              <TabsContent value="daily-program" className="m-0 p-0 outline-none">
                <DashboardDailyProgram
                  scopedCampusName={session.campusName}
                  lockedOperationalRole={scopedRole}
                />
              </TabsContent>
            )}

            {hasAccess("users") && (
              <TabsContent value="users" className="m-0 p-0 outline-none">
                <DashboardUsers
                  users={users}
                  campuses={visibleCampuses}
                  currentUserRole={currentUserRole}
                  lockedOperationalRole={scopedRole}
                />
              </TabsContent>
            )}

            {hasAccess("catalogs") && (
              <TabsContent value="catalogs" className="m-0 p-0 outline-none">
                <DashboardCatalogs campuses={catalogCampuses} courses={catalogCourses} />
              </TabsContent>
            )}
            
            {(hasAccess("admins") || hasAccess("kiosk")) && (
              <TabsContent value="admins" className="m-0 p-0 outline-none">
                <DashboardAdmins
                  admins={admins}
                  campuses={visibleCampuses.length > 0 && scopedCampusId ? visibleCampuses : allCampuses}
                  currentUserRole={currentUserRole}
                  canManageKiosk={hasAccess("kiosk")}
                  initialKioskCodes={kioskCodes}
                />
              </TabsContent>
            )}

            {currentUserRole === "SUPER_ADMIN" && (
              <TabsContent value="logs" className="m-0 p-0 outline-none">
                <DashboardAuditLogs initialLogs={auditLogs} />
              </TabsContent>
            )}

            <TabsContent value="manuals" className="m-0 p-0 outline-none">
              <DashboardManuals adminTier={adminTier} />
            </TabsContent>
            
          </div>
        </main>
        
      </div>

      <ForceChangePasswordModal 
        mustChange={Boolean(session.mustChangePassword)} 
        adminName={session.name || "Administrador"} 
      />
    </Tabs>
  )
}
