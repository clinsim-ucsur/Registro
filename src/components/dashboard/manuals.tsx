"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { BookOpen, FileDown, ExternalLink, ShieldCheck, Smartphone, Globe, Building2, Users } from "lucide-react"
import type { AdminTier } from "@/lib/admin-scope"

interface ManualEntry {
  id: string
  title: string
  subtitle: string
  badge: string
  badgeColor: string
  fileUrl: string
  fileName: string
  icon: any
  tiers: (AdminTier | "ALL")[]
  highlights: string[]
}

const MANUALS_CATALOG: ManualEntry[] = [
  {
    id: "end-user",
    title: "1. Manual del Usuario Final (Marcación de Asistencia)",
    subtitle: "Para compartir con Docentes, Técnicos de Simulación y Pacientes Simulados",
    badge: "Usuarios Finales (Público)",
    badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
    fileUrl: "/manuales/1_Manual_Usuario_Final_Marcacion_Asistencia.pdf",
    fileName: "1_Manual_Usuario_Final_Marcacion_Asistencia.pdf",
    icon: Smartphone,
    tiers: ["ALL"],
    highlights: [
      "Instalación de la App en la pantalla de inicio del celular (Android / iPhone).",
      "Activación del GPS dentro del campus y marcación en 1 segundo solo con DNI.",
      "Visualización del nombre limpio del Ambiente / Consultorio asignado y horarios.",
      "NO incluye información sobre cómo vincular Estaciones Oficiales (reservado a Admins).",
    ],
  },
  {
    id: "super-admin",
    title: "2. Manual Exclusivo del Super Administrador (Acceso Total)",
    subtitle: "Guía confidencial de administración global, Estaciones Oficiales, Jerarquía y Auditoría de Logs",
    badge: "Nivel 4: Super Admin (Confidencial)",
    badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    fileUrl: "/manuales/2_Manual_Super_Admin_Acceso_Total.pdf",
    fileName: "2_Manual_Super_Admin_Acceso_Total.pdf",
    icon: ShieldCheck,
    tiers: ["SUPER_ADMIN"],
    highlights: [
      "Ubicación del botón discreto de candado para vincular una PC como 'Estación Oficial'.",
      "Generación y uso de Códigos de Un Solo Uso (6 dígitos) con sede preconfigurada.",
      "Separación de Sede Operativa vs Vista Admin y gestión de los 4 niveles de roles.",
      "Uso del Informe de Logs (Auditoría de accesos, cambios y seguridad).",
    ],
  },
  {
    id: "admin-global",
    title: "3. Manual del Administrador General (Multisede)",
    subtitle: "Guía de supervisión de las 4 sedes, exportación RRHH, Horas Extras y Cronograma de Técnicos",
    badge: "Nivel 3: Admin General",
    badgeColor: "bg-sky-50 text-sky-700 border-sky-200",
    fileUrl: "/manuales/3_Manual_Admin_General_Multisede.pdf",
    fileName: "3_Manual_Admin_General_Multisede.pdf",
    icon: Globe,
    tiers: ["SUPER_ADMIN", "ADMIN_GLOBAL"],
    highlights: [
      "Supervisión simultánea de Campus Villa, Campus Norte, Campus Ate y Campus Aramburú.",
      "Exportación de Libro Excel de 6 hojas, CSV y PDF con cálculo de Horas Extras (>= 1h).",
      "Carga y edición interactiva del Cronograma Mensual de Técnicos (Excel, OCR y estado EV).",
      "Vinculación de Estación Oficial si cuenta con el permiso habilitado.",
    ],
  },
  {
    id: "admin-sede",
    title: "4. Manual del Administrador por Sede",
    subtitle: "Guía operativa para responsables asignados exclusivamente a una sede universitaria",
    badge: "Nivel 1: Admin por Sede",
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
    fileUrl: "/manuales/4_Manual_Admin_Por_Sede.pdf",
    fileName: "4_Manual_Admin_Por_Sede.pdf",
    icon: Building2,
    tiers: ["SUPER_ADMIN", "ADMIN_SEDE"],
    highlights: [
      "Funcionamiento del filtro automático por sede asignada en métricas y reportes.",
      "Supervisión diaria de entradas, salidas, puntualidad y tardanzas de su campus.",
      "Gestión del directorio de personal operativo de su sede.",
      "Autorización de la PC de recepción de su sede mediante Código de 1 Uso.",
    ],
  },
  {
    id: "coord-pacientes",
    title: "5. Manual del Coordinador de Pacientes Simulados",
    subtitle: "Guía especializada para el monitoreo, directorio y reportes exclusivos de Pacientes Simulados",
    badge: "Nivel 2: Coord. Pacientes Simulados",
    badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
    fileUrl: "/manuales/5_Manual_Coordinador_Pacientes_Simulados.pdf",
    fileName: "5_Manual_Coordinador_Pacientes_Simulados.pdf",
    icon: Users,
    tiers: ["SUPER_ADMIN", "COORDINADOR_PACIENTES"],
    highlights: [
      "Entorno enfocado 100% en Pacientes Simulados (sin mezclar Técnicos ni Docentes).",
      "Monitoreo en vivo de llegada y ambiente/consultorio asignado.",
      "Alta individual y carga masiva de Pacientes Simulados mediante plantilla Excel.",
      "Exportación de reportes de asistencia y puntualidad exclusivos de Pacientes Simulados.",
    ],
  },
]

export function DashboardManuals({ adminTier }: { adminTier: AdminTier }) {
  const visibleManuals = MANUALS_CATALOG.filter(
    (m) => m.tiers.includes("ALL") || m.tiers.includes(adminTier)
  )

  return (
    <div className="space-y-6 animate-fade-in-up">
      <Card className="border-slate-200/60 shadow-sm rounded-3xl bg-white overflow-hidden">
        <CardHeader className="border-b border-slate-100 py-6 px-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[#1967D2] text-xs font-bold uppercase tracking-wider mb-2 w-fit">
            <BookOpen size={14} /> Documentación Oficial en PDF
          </div>
          <CardTitle className="text-2xl font-black text-slate-800">
            Centro de Manuales de Usuario y Guías por Nivel de Rol
          </CardTitle>
          <CardDescription className="text-sm font-medium text-slate-500 mt-1">
            Descarga o visualiza los manuales oficiales en PDF adaptados a tu nivel de permisos, así como la guía pública para compartir con el personal operativo.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 md:p-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {visibleManuals.map((manual) => {
              const Icon = manual.icon
              return (
                <div
                  key={manual.id}
                  className="flex flex-col justify-between p-6 rounded-2xl border border-slate-200/80 bg-slate-50/50 hover:bg-white hover:shadow-md transition-all gap-5"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-[#0B1B3D] text-white flex items-center justify-center shrink-0 shadow-xs">
                        <Icon size={20} />
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${manual.badgeColor}`}
                      >
                        {manual.badge}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-base font-black text-slate-800">{manual.title}</h3>
                      <p className="text-xs font-medium text-slate-500 mt-0.5">{manual.subtitle}</p>
                    </div>

                    <ul className="space-y-1.5 pt-1">
                      {manual.highlights.map((item, idx) => (
                        <li key={idx} className="text-xs text-slate-600 flex items-start gap-2">
                          <span className="text-[#1967D2] font-black mt-0.5">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2.5 pt-3 border-t border-slate-200/60">
                    <a
                      href={manual.fileUrl}
                      download={manual.fileName}
                      className="flex-1 inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-[#1967D2] hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      <FileDown size={16} /> Descargar PDF
                    </a>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => window.open(manual.fileUrl, "_blank", "noopener,noreferrer")}
                      className="h-11 px-4 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-bold cursor-pointer"
                    >
                      <ExternalLink size={15} className="mr-1.5" /> Ver en Navegador
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
