"use client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Settings, Save } from "lucide-react"

export function DashboardRules({ initialRules }: { initialRules: any[] }) {
  return (
    <div className="animate-fade-in-up">
      <Card className="border-slate-200/60 shadow-sm rounded-2xl bg-white max-w-xl mx-auto">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-slate-100 text-slate-600 rounded-lg"><Settings size={20}/></div>
            <CardTitle className="text-2xl font-extrabold text-slate-800">Motor de Tolerancias</CardTitle>
          </div>
          <CardDescription className="text-base">Configura las reglas dinámicas para evaluar automáticamente si un registro es puntual, tardanza o falta basándote en la hora del servidor.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700 uppercase tracking-wide">Hora de Entrada Esperada</label>
            <p className="text-xs text-slate-500 mb-2">Momento oficial de inicio de actividades (Ej: 08:00 AM)</p>
            <Input defaultValue="08:00" type="time" className="h-14 text-lg font-bold rounded-xl bg-slate-50" />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700 uppercase tracking-wide">Minutos de Tolerancia (Tardanza)</label>
            <p className="text-xs text-slate-500 mb-2">Si marcan después de la hora oficial pero antes de este límite, se considera "Tardanza".</p>
            <div className="relative">
              <Input type="number" defaultValue="15" className="h-14 text-lg font-bold rounded-xl bg-slate-50 pl-4 pr-16" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">min</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700 uppercase tracking-wide">Límite Máximo (Falta Injustificada)</label>
            <p className="text-xs text-slate-500 mb-2">Si marcan después de este límite, el sistema lo registrará como "Falta" automáticamente.</p>
            <div className="relative">
              <Input type="number" defaultValue="30" className="h-14 text-lg font-bold rounded-xl bg-slate-50 pl-4 pr-16" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">min</span>
            </div>
          </div>

        </CardContent>
        <CardFooter className="bg-slate-50 rounded-b-2xl py-4 border-t border-slate-100 flex justify-end">
          <Button className="bg-[#1967D2] hover:bg-blue-800 h-12 px-8 rounded-xl font-bold shadow-md shadow-blue-500/20 text-md">
            <Save className="mr-2" size={20} /> Guardar Reglas Globales
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
