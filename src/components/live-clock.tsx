"use client"
import { useState, useEffect } from "react"
import { Clock } from "lucide-react"

export default function LiveClock() {
  const [time, setTime] = useState<Date | null>(null)

  useEffect(() => {
    setTime(new Date())
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  if (!time) return <div className="h-[140px] bg-white animate-pulse rounded-3xl"></div>

  return (
    <div className="bg-white rounded-3xl p-6 text-slate-800 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.4)] flex flex-col items-center justify-center transform transition-all duration-500 hover:scale-[1.02] group relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[#1967D2] to-blue-400"></div>
      
      <Clock size={28} className="text-[#1967D2] mb-2 group-hover:animate-spin-slow drop-shadow-sm" />
      <div className="text-4xl md:text-5xl font-bold tracking-tighter tabular-nums text-[#1967D2] drop-shadow-sm">
        {time.toLocaleTimeString('es-PE', { hour12: false })}
      </div>
      <div className="text-slate-500 mt-2 text-base md:text-lg capitalize font-medium tracking-wide">
        {time.toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
    </div>
  )
}
