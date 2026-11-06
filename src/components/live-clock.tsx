"use client"
import { useState, useEffect } from "react"
import { Clock } from "lucide-react"

export default function LiveClock({ compact = false }: { compact?: boolean }) {
  const [time, setTime] = useState<Date | null>(null)

  useEffect(() => {
    setTime(new Date())
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  if (!time) {
    return compact ? (
      <div className="h-9 w-48 bg-white/15 animate-pulse rounded-full" />
    ) : (
      <div className="h-[130px] w-[240px] bg-white/90 animate-pulse rounded-3xl" />
    )
  }

  if (compact) {
    return (
      <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-white/15 border border-white/25 backdrop-blur-md text-white shadow-sm">
        <Clock size={14} className="text-blue-200 shrink-0" />
        <span className="text-sm sm:text-base font-extrabold tabular-nums tracking-tight">
          {time.toLocaleTimeString("es-PE", { hour12: false })}
        </span>
        <span className="text-white/40">&bull;</span>
        <span className="text-[11px] sm:text-xs text-blue-100 capitalize font-medium truncate max-w-[175px] sm:max-w-none">
          {time.toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" })}
        </span>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-3xl p-5 xl:p-6 text-slate-800 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.4)] flex flex-col items-center justify-center transform transition-all duration-500 hover:scale-[1.02] group relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#1967D2] to-blue-400"></div>
      
      <Clock size={24} className="text-[#1967D2] mb-1.5 group-hover:animate-spin-slow drop-shadow-sm" />
      <div className="text-3xl xl:text-4xl font-bold tracking-tighter tabular-nums text-[#1967D2] drop-shadow-sm">
        {time.toLocaleTimeString('es-PE', { hour12: false })}
      </div>
      <div className="text-slate-500 mt-1.5 text-sm xl:text-base capitalize font-medium tracking-wide text-center">
        {time.toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
    </div>
  )
}
