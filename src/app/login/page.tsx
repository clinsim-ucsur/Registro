"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { loginAction } from "@/actions/auth"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Lock, User, ArrowLeft, Eye, EyeOff } from "lucide-react"
import Link from "next/link"

export default function LoginPage() {
  const router = useRouter()
  const [dni, setDni] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    try {
      const res = await loginAction(dni, password)
      if (res && res.success) {
        toast.success("¡Bienvenido al Panel Administrativo!")
        window.location.href = "/dashboard"
      } else {
        toast.error(res?.message || "Error desconocido al iniciar sesión")
        setLoading(false)
      }
    } catch (error) {
      toast.error("Ocurrió un error grave de conexión.")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      
      {/* Fondo decorativo */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 opacity-20 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500 rounded-full blur-[100px]"></div>
      </div>

      <Link href="/" className="absolute top-8 left-8 text-white/50 hover:text-white flex items-center gap-2 z-10 transition-colors">
        <ArrowLeft size={20} /> Volver al Registro
      </Link>

      <div className="bg-white p-8 md:p-12 rounded-[2rem] shadow-2xl max-w-md w-full border border-slate-100 z-10 animate-fade-in-up">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-black text-[#0B1B3D]">Admin<span className="text-[#1967D2]">Panel</span></h2>
          <p className="text-slate-500 text-sm mt-2 font-medium">Ingresa tus credenciales seguras</p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-6">
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <Input 
              placeholder="DNI o Usuario" 
              className="pl-12 h-14 bg-slate-50 border-slate-200 text-slate-800 font-bold focus-visible:ring-[#1967D2]"
              value={dni}
              onChange={e => setDni(e.target.value)}
              required
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <Input 
              type={showPassword ? "text" : "password"}
              placeholder="Contraseña" 
              className="pl-12 pr-12 h-14 bg-slate-50 border-slate-200 text-slate-800 font-bold focus-visible:ring-[#1967D2]"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <button 
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none transition-colors"
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          
          <Button 
            type="submit"
            disabled={loading} 
            className="w-full h-14 text-lg font-bold bg-[#1967D2] hover:bg-blue-800 rounded-xl shadow-lg shadow-blue-500/30 transition-all hover:-translate-y-1"
          >
            {loading ? "Verificando identidad..." : "Iniciar Sesión"}
          </Button>
        </form>
        
        <div className="mt-8 pt-6 border-t border-slate-100">
           <p className="text-center text-xs font-bold text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-100">
             Para pruebas MVP, usa:<br/> Usuario: <strong>admin</strong> | Clave: <strong>admin123</strong>
           </p>
        </div>
      </div>
    </div>
  )
}
