import AttendanceForm from "@/components/attendance-form"
import LiveClock from "@/components/live-clock"

export default function Home() {
  return (
    <main className="min-h-screen relative flex flex-col items-center justify-center overflow-hidden bg-[#1967D2] p-6">
      
      {/* 1. TEXTURA DE FONDO: Cuadrícula tecnológica muy sutil */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)', backgroundSize: '40px 40px' }}></div>
      
      {/* Sombras radiales oscuras para profundidad 3D */}
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-[#0f4d9f]/60 to-[#0a3570] pointer-events-none z-0"></div>
      
      {/* Reloj posicionado en la esquina superior derecha */}
      <div className="absolute top-6 right-6 md:top-10 md:right-10 z-20">
        <LiveClock />
      </div>

      <div className="w-full max-w-[800px] mx-auto flex flex-col items-center z-10 relative mt-16 md:mt-10">
        
        {/* Encabezado y Logo */}
        <div className="flex flex-col items-center mb-8 w-full animate-fade-in-up">
          <div className="w-full max-w-[280px] mb-6 bg-white p-6 rounded-[2rem] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.4)] transition-transform hover:scale-105 duration-500 flex justify-center items-center">
            <img src="https://i.imgur.com/E44OxzM.png" alt="Logo" className="w-full h-auto max-h-[75px] object-contain drop-shadow-sm" />
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight drop-shadow-lg">
              Portal de Asistencia
            </h1>
            {/* 2. SUBTÍTULO ELEGANTE: Le da contexto sin saturar */}
            <p className="text-blue-200/70 font-bold tracking-[0.2em] uppercase text-xs md:text-sm pt-2 drop-shadow-md">
              Clínica de Simulación 
            </p>
          </div>
        </div>

        {/* Contenedor Principal: Formulario Centrado */}
        <div className="w-full animate-fade-in-up" style={{animationDelay: '0.1s'}}>
          <AttendanceForm />
        </div>
      </div>

      {/* 3. FOOTER MINIMALISTA: "Ancla" visualmente la pantalla en la base */}
      <div className="absolute bottom-6 w-full flex justify-center z-10 pointer-events-none animate-fade-in-up" style={{animationDelay: '0.3s'}}>
        <div className="flex items-center gap-3 px-6 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
          <p className="text-white/60 text-xs md:text-sm font-medium tracking-wide">
            Sistema en Línea &bull; Universidad Científica del Sur &copy; {new Date().getFullYear()}
          </p>
        </div>
      </div>
      
    </main>
  )
}
