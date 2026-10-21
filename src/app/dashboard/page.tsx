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
  Calendar as CalendarIcon
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
import { ForceChangePasswordModal } from "@/components/dashboard/force-change-password-modal"
import { getAdminSession } from "@/lib/session"
import { computeAnalytics } from "@/lib/analytics"

export default async function DashboardPage() {
  const session = await getAdminSession()
  if (!session) redirect("/login")
  
  const currentUserRole = session.role
  const permissions = session.permissions || []

  // Helper de permiso: Si es SUPER_ADMIN o tiene el permiso explícito en su cuenta
  const hasAccess = (moduleId: string) => {
    if (currentUserRole === "SUPER_ADMIN") return true
    return permissions.includes(moduleId)
  }

  const [records, users, admins, weeklyAnalytics, initialAnalytics, rules, campuses, catalogCampuses, catalogCourses, technicianSchedules] = await Promise.all([
    prisma.attendanceRecord.findMany({
      orderBy: { timestamp: 'desc' },
      take: 1000,
      include: {
        user: true,
        campus: { select: { id: true, name: true } },
        course: { select: { id: true, name: true } },
      }
    }),
    prisma.user.findMany({
      where: {
        OR: [
          { role: { in: ['DOCENTE', 'TECNICO', 'PACIENTE_SIMULADO'] } },
          { adminRole: { not: null } }
        ]
      },
      include: { campus: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
      take: 300 // MVP limit
    }),
    prisma.user.findMany({
      where: {
        OR: [
          { adminRole: { in: ['SUPER_ADMIN', 'ADMIN_SECUNDARIO'] } },
          { role: { in: ['SUPER_ADMIN', 'ADMIN_SECUNDARIO'] } }
        ]
      },
      include: { campus: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    }),
    computeAnalytics({ days: 7 }),
    computeAnalytics({ days: 30 }),
    prisma.toleranceRule.findMany({
      include: { campus: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.campus.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.campus.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { users: true, records: true, rules: true }
        }
      }
    }),
    prisma.course.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { records: true }
        }
      }
    }),
    prisma.technicianSchedule.findMany({
      orderBy: [{ date: 'desc' }, { expectedEntryTime: 'asc' }],
      include: {
        user: { select: { id: true, name: true, dni: true } },
        campus: { select: { id: true, name: true } },
      },
      take: 300,
    }),
  ])

  // Determinar default tab accesible
  const defaultTab = hasAccess("overview") ? "overview" :
    hasAccess("analytics") ? "analytics" :
    hasAccess("reports") ? "reports" :
    hasAccess("rules") ? "rules" :
    hasAccess("users") ? "users" :
    hasAccess("catalogs") ? "catalogs" :
    hasAccess("admins") ? "admins" : "overview"
  
  return (
    <Tabs defaultValue={defaultTab} orientation="vertical" className="flex flex-row h-screen w-full bg-slate-50 overflow-hidden font-sans">
      
      {/* SIDEBAR IZQUIERDO */}
      <div className="w-72 bg-[#0B1B3D] text-white shadow-2xl flex flex-col shrink-0 z-20">
        
        {/* Cabecera / Logo del Sidebar */}
        <div className="p-8 border-b border-white/10">
          <h2 className="text-2xl font-black tracking-tight">Admin<span className="text-[#1967D2]">Panel</span></h2>
          <p className="text-xs text-slate-400 mt-2 font-medium tracking-wide uppercase">Científica del Sur</p>
          {session.campusName && (
            <div className="mt-3 px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-xs font-bold text-blue-200">
              📍 {session.campusName}
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

            {(hasAccess("rules") || hasAccess("users")) && (
              <TabsTrigger 
                value="schedules" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <CalendarIcon size={20}/> Cronograma Técnicos
              </TabsTrigger>
            )}

            <div className="h-px w-full bg-white/5 my-1"></div>

            {hasAccess("users") && (
              <TabsTrigger 
                value="users" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
              >
                <Users size={20}/> Personal Operativo
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
            
            {hasAccess("admins") && (
              <TabsTrigger 
                value="admins" 
                className="w-full justify-start gap-4 px-5 py-3.5 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-indigo-900/50 hover:bg-white/5 transition-all outline-none mt-1"
              >
                <Shield size={20}/> Control de Acceso
              </TabsTrigger>
            )}
            
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
              Gestión y Monitoreo en Tiempo Real {session.campusName ? `— ${session.campusName}` : ""}
            </p>
          </div>
          
           {/* Perfil del Usuario Logueado */}
          <div className="flex items-center gap-4 bg-slate-50 py-2 px-4 rounded-full border border-slate-200/60 shadow-sm">
             <div className="text-right hidden md:block">
                <p className="text-sm font-bold text-slate-800">{session.name || "Administrador"}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-black">
                  {currentUserRole === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin Secundario'}
                </p>
             </div>
             <div className={`w-10 h-10 text-white font-black flex items-center justify-center rounded-full shadow-sm ${currentUserRole === 'SUPER_ADMIN' ? 'bg-indigo-600 shadow-indigo-500/30' : 'bg-[#1967D2] shadow-blue-500/30'}`}>
                {session.name ? session.name.slice(0, 2).toUpperCase() : (currentUserRole === 'SUPER_ADMIN' ? 'SA' : 'AD')}
             </div>
          </div>
        </header>

        {/* Scroll principal del contenido */}
        <main className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar">
          <div className="max-w-[1400px] mx-auto pb-10">
            
            {hasAccess("overview") && (
              <TabsContent value="overview" className="m-0 p-0 outline-none">
                <DashboardOverview records={records} weekly={weeklyAnalytics.daily} />
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
                <DashboardReports initialRecords={records} campuses={campuses} />
              </TabsContent>
            )}

            {hasAccess("rules") && (
              <TabsContent value="rules" className="m-0 p-0 outline-none">
                <DashboardRules
                  rules={rules}
                  campuses={campuses}
                  technicians={users.filter((u) => u.role === "TECNICO") as any}
                />
              </TabsContent>
            )}

            {(hasAccess("rules") || hasAccess("users")) && (
              <TabsContent value="schedules" className="m-0 p-0 outline-none">
                <DashboardSchedules
                  initialSchedules={technicianSchedules as any}
                  technicians={users.filter((u) => u.role === "TECNICO") as any}
                  campuses={campuses}
                />
              </TabsContent>
            )}

            {hasAccess("users") && (
              <TabsContent value="users" className="m-0 p-0 outline-none">
                <DashboardUsers users={users} campuses={campuses} />
              </TabsContent>
            )}

            {hasAccess("catalogs") && (
              <TabsContent value="catalogs" className="m-0 p-0 outline-none">
                <DashboardCatalogs campuses={catalogCampuses} courses={catalogCourses} />
              </TabsContent>
            )}
            
            {hasAccess("admins") && (
              <TabsContent value="admins" className="m-0 p-0 outline-none">
                <DashboardAdmins admins={admins} campuses={campuses} />
              </TabsContent>
            )}
            
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
