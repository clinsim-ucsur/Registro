import AttendanceForm from "@/components/attendance-form"
import LiveClock from "@/components/live-clock"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

export default async function Home() {
  const [campuses, courses] = await Promise.all([
    prisma.campus.findMany({ select: { id: true, name: true, geoEnforced: true, latitude: true, longitude: true, radiusMeters: true }, orderBy: { name: 'asc' } }),
    prisma.course.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])

  return (
    <main className="min-h-[100dvh] relative flex flex-col items-center justify-between overflow-x-hidden overflow-y-auto bg-[#1967D2] px-3 py-4 sm:px-5 sm:py-6 md:p-8 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      
      {/* 1. TEXTURA DE FONDO: Cuadrícula tecnológica muy sutil */}
      <div className="fixed inset-0 z-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)', backgroundSize: '36px 36px' }}></div>
      
      {/* Sombras radiales oscuras para profundidad 3D */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-[#0f4d9f]/60 to-[#0a3570] pointer-events-none z-0"></div>
      
      {/* Reloj flotante solo en pantallas de escritorio grandes (xl+) */}
      <div className="hidden xl:block fixed top-8 right-8 z-20">
        <LiveClock />
      </div>

      <div className="w-full max-w-[760px] mx-auto flex flex-col items-center z-10 relative my-auto">
        
        {/* Encabezado y Logo adaptativo a celulares y escritorio */}
        <div className="flex flex-col items-center mb-3.5 sm:mb-5 md:mb-7 w-full animate-fade-in-up">
          <div className="w-full max-w-[155px] sm:max-w-[200px] md:max-w-[260px] mb-2.5 sm:mb-4 md:mb-5 bg-white px-4 py-2.5 sm:p-4 md:p-5 rounded-2xl md:rounded-[2rem] shadow-[0_16px_32px_-12px_rgba(0,0,0,0.4)] transition-transform hover:scale-105 duration-500 flex justify-center items-center">
            <img src="https://i.imgur.com/E44OxzM.png" alt="Logo" className="w-full h-auto max-h-[38px] sm:max-h-[52px] md:max-h-[70px] object-contain drop-shadow-sm" />
          </div>
          <div className="text-center space-y-0.5 sm:space-y-1">
            <h1 className="text-2xl sm:text-3xl md:text-5xl font-extrabold text-white tracking-tight drop-shadow-lg leading-tight">
              Portal de Asistencia
            </h1>
            {/* 2. SUBTÍTULO ELEGANTE */}
            <p className="text-blue-200/80 font-bold tracking-[0.16em] sm:tracking-[0.2em] uppercase text-[10px] sm:text-xs md:text-sm pt-0.5 sm:pt-1 drop-shadow-md">
              Clínica de Simulación 
            </p>
          </div>

          {/* Reloj compacto integrado para celulares y tablets (< xl) sin superponerse */}
          <div className="xl:hidden mt-2.5 sm:mt-3">
            <LiveClock compact />
          </div>
        </div>

        {/* Contenedor Principal: Formulario Centrado */}
        <div className="w-full animate-fade-in-up" style={{animationDelay: '0.1s'}}>
          <AttendanceForm campuses={campuses} courses={courses} />
        </div>
      </div>

      {/* 3. FOOTER MINIMALISTA: Flujo natural sin superponerse en pantallas pequeñas */}
      <div className="w-full flex justify-center z-10 pointer-events-none mt-4 sm:mt-6 pt-1 animate-fade-in-up" style={{animationDelay: '0.3s'}}>
        <div className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-1.5 sm:py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm">
          <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"></div>
          <p className="text-white/65 text-[10px] sm:text-xs md:text-sm font-medium tracking-wide text-center">
            Sistema en Línea &bull; Universidad Científica del Sur &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>
      
    </main>
  )
}
