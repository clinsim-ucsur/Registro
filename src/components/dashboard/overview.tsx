import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Users, LogIn, LogOut, Stethoscope, Briefcase, UserSquare2, FileWarning } from "lucide-react"
import { DashboardChart } from "@/components/dashboard-chart"

export function DashboardOverview({ records }: { records: any[] }) {
  const totalHoy = records.length
  const entradas = records.filter(r => r.type === 'ENTRADA').length
  const salidas = records.filter(r => r.type === 'SALIDA').length
  
  const docentes = records.filter(r => r.role === 'DOCENTE').length
  const tecnicos = records.filter(r => r.role === 'TECNICO').length
  const pacientes = records.filter(r => r.role === 'PACIENTE_SIMULADO').length

  const chartData = [
    { date: "Lun 10", total: 45 },
    { date: "Mar 11", total: 52 },
    { date: "Mié 12", total: 38 },
    { date: "Jue 13", total: 60 },
    { date: "Vie 14", total: 48 },
    { date: "Sáb 15", total: 12 },
    { date: "Hoy", total: totalHoy },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 animate-fade-in-up">
        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">Flujo Total Hoy</CardTitle>
            <Users className="text-[#1967D2]" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-800">{totalHoy}</div>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">Entradas</CardTitle>
            <LogIn className="text-emerald-500" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-800">{entradas}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">Salidas</CardTitle>
            <LogOut className="text-amber-500" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-800">{salidas}</div>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-slate-50/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-black tracking-widest text-slate-400 uppercase">Licencias Activas</CardTitle>
            <FileWarning className="text-slate-400" size={20} />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-slate-300">0</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in-up" style={{animationDelay: '0.1s'}}>
        <Card className="lg:col-span-2 shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white flex flex-col">
          <CardHeader className="pb-0">
            <CardTitle className="text-lg font-extrabold text-slate-800">Flujo Semanal</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 pb-4 pt-2">
            <DashboardChart data={chartData} />
          </CardContent>
        </Card>

        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white flex flex-col">
          <CardHeader className="pb-4 border-b border-slate-100">
            <CardTitle className="text-lg font-extrabold text-slate-800">Asistencia por Rol</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl"><Briefcase size={20}/></div>
                <span className="font-bold text-slate-600">Docentes</span>
              </div>
              <span className="text-2xl font-black text-slate-800">{docentes}</span>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl"><Stethoscope size={20}/></div>
                <span className="font-bold text-slate-600">Pacientes Sim.</span>
              </div>
              <span className="text-2xl font-black text-slate-800">{pacientes}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-purple-50 text-purple-600 rounded-xl"><UserSquare2 size={20}/></div>
                <span className="font-bold text-slate-600">Técnicos</span>
              </div>
              <span className="text-2xl font-black text-slate-800">{tecnicos}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 animate-fade-in-up" style={{animationDelay: '0.2s'}}>
        <Card className="shadow-sm shadow-slate-200/50 border-slate-200/60 rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-white py-5 px-6">
            <CardTitle className="text-lg font-extrabold text-slate-800">Listado General de Atención</CardTitle>
            <CardDescription className="text-sm font-medium">Historial completo de los últimos registros procesados.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/50">
                <TableRow className="border-slate-100 hover:bg-transparent">
                  <TableHead className="px-6 font-bold text-slate-500">Nombre</TableHead>
                  <TableHead className="font-bold text-slate-500">Rol</TableHead>
                  <TableHead className="font-bold text-slate-500">Tipo</TableHead>
                  <TableHead className="px-6 text-right font-bold text-slate-500">Hora de Registro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-slate-500 font-medium">
                      Aún no hay registros en la base de datos.
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((record) => (
                    <TableRow key={record.id} className="border-slate-100 transition-colors hover:bg-slate-50/80">
                      <TableCell className="px-6 py-3">
                        <p className="font-bold text-slate-800">{record.user.name}</p>
                        <p className="text-xs text-slate-400 font-medium">DNI: {record.user.dni}</p>
                      </TableCell>
                      <TableCell className="text-slate-500 text-xs font-bold">{record.role}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded-[5px] text-[10px] font-black tracking-widest ${record.type === 'ENTRADA' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-700'}`}>
                          {record.type}
                        </span>
                      </TableCell>
                      <TableCell className="px-6 text-right text-slate-600 text-sm font-bold">
                        {record.timestamp.toLocaleTimeString('es-PE', { hour12: true, hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
