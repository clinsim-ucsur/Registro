import prisma from "@/lib/prisma"
import { LayoutDashboard, UploadCloud, FileText, LogOut, Users, Shield } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cookies } from "next/headers"

import { DashboardOverview } from "@/components/dashboard/overview"
import { DashboardUpload } from "@/components/dashboard/upload"
import { DashboardReports } from "@/components/dashboard/reports"
import { DashboardUsers } from "@/components/dashboard/users"
import { DashboardAdmins } from "@/components/dashboard/admins"

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get("auth_token")?.value
  let currentUserRole = "SUPER_ADMIN"
  
  if (token && token !== "superadmin_session") {
     const currentUser = await prisma.user.findUnique({ where: { id: token } })
     if (currentUser) currentUserRole = currentUser.role
  }

  const records = await prisma.attendanceRecord.findMany({
    orderBy: { timestamp: 'desc' },
    take: 100, // En producción usaríamos paginación
    include: { user: true }
  })
  
  const users = await prisma.user.findMany({
    where: { role: { in: ['DOCENTE', 'TECNICO', 'PACIENTE_SIMULADO'] } },
    orderBy: { name: 'asc' },
    take: 200 // MVP limit
  })
  
  const admins = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN_SECUNDARIO'] } },
    orderBy: { name: 'asc' },
  })
  
  return (
    <Tabs defaultValue="overview" orientation="vertical" className="flex flex-row h-screen w-full bg-slate-50 overflow-hidden font-sans">
      
      {/* SIDEBAR IZQUIERDO */}
      <div className="w-72 bg-[#0B1B3D] text-white shadow-2xl flex flex-col shrink-0 z-20">
        
        {/* Cabecera / Logo del Sidebar */}
        <div className="p-8 border-b border-white/10">
          <h2 className="text-2xl font-black tracking-tight">Admin<span className="text-[#1967D2]">Panel</span></h2>
          <p className="text-xs text-slate-400 mt-2 font-medium tracking-wide uppercase">Científica del Sur</p>
        </div>

        {/* Menú de Navegación (Tabs) */}
        <div className="flex-1 p-4 overflow-y-auto">
          <TabsList className="flex flex-col items-stretch justify-start h-auto bg-transparent p-0 w-full gap-3">
            
            <TabsTrigger 
              value="overview" 
              className="w-full justify-start gap-4 px-5 py-4 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
            >
              <LayoutDashboard size={22}/> Resumen
            </TabsTrigger>
            
            <TabsTrigger 
              id="trigger-upload"
              value="upload" 
              className="hidden"
            >
              <UploadCloud size={22}/> Carga Masiva
            </TabsTrigger>
            
            <TabsTrigger 
              value="reports" 
              className="w-full justify-start gap-4 px-5 py-4 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
            >
              <FileText size={22}/> Exportación
            </TabsTrigger>

            <div className="h-px w-full bg-white/5 my-2"></div>

            <TabsTrigger 
              value="users" 
              className="w-full justify-start gap-4 px-5 py-4 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-[#1967D2] data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-900/50 hover:bg-white/5 transition-all outline-none"
            >
              <Users size={22}/> Personal Operativo
            </TabsTrigger>
            
            {currentUserRole === 'SUPER_ADMIN' && (
              <TabsTrigger 
                value="admins" 
                className="w-full justify-start gap-4 px-5 py-4 text-sm md:text-base font-bold rounded-2xl text-slate-300 data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-indigo-900/50 hover:bg-white/5 transition-all outline-none mt-2"
              >
                <Shield size={22}/> Administradores
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
            <p className="text-sm font-medium text-slate-500">Gestión y Monitoreo en Tiempo Real</p>
          </div>
          
           {/* Perfil del Usuario Logueado (Mockup visual) */}
          <div className="flex items-center gap-4 bg-slate-50 py-2.5 px-4 rounded-full border border-slate-100">
             <div className="text-right hidden md:block">
                <p className="text-sm font-bold text-slate-700">{currentUserRole === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Sistemas</p>
             </div>
             <div className={`w-10 h-10 text-white font-black flex items-center justify-center rounded-full shadow-sm ${currentUserRole === 'SUPER_ADMIN' ? 'bg-indigo-600 shadow-indigo-500/30' : 'bg-[#1967D2] shadow-blue-500/30'}`}>
                {currentUserRole === 'SUPER_ADMIN' ? 'SA' : 'AD'}
             </div>
          </div>
        </header>

        {/* Scroll principal del contenido */}
        <main className="flex-1 overflow-y-auto p-6 md:p-10">
          <div className="max-w-[1400px] mx-auto pb-10">
            
            <TabsContent value="overview" className="m-0 p-0 outline-none">
              <DashboardOverview records={records} />
            </TabsContent>

            <TabsContent value="upload" className="m-0 p-0 outline-none">
              <DashboardUpload />
            </TabsContent>

            <TabsContent value="reports" className="m-0 p-0 outline-none">
              <DashboardReports records={records} />
            </TabsContent>

            <TabsContent value="users" className="m-0 p-0 outline-none">
              <DashboardUsers users={users} />
            </TabsContent>
            
            {currentUserRole === 'SUPER_ADMIN' && (
              <TabsContent value="admins" className="m-0 p-0 outline-none">
                <DashboardAdmins admins={admins} />
              </TabsContent>
            )}
            
          </div>
        </main>
        
      </div>
    </Tabs>
  )
}
