"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { KeyRound, ShieldCheck, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { changeInitialPasswordAction, logoutAction } from "@/actions/auth"

interface ForceChangePasswordModalProps {
  mustChange: boolean
  adminName: string
}

export function ForceChangePasswordModal({ mustChange, adminName }: ForceChangePasswordModalProps) {
  const [mounted, setMounted] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")

  useEffect(() => {
    setMounted(true)
    if (mustChange) {
      setIsOpen(true)
    }
  }, [mustChange])

  if (!mounted || !isOpen || typeof document === "undefined") return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")

    if (newPassword.trim().length < 6) {
      setErrorMsg("La contraseña debe tener al menos 6 caracteres.")
      return
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg("Las contraseñas no coinciden. Por favor verifícalas.")
      return
    }

    setIsPending(true)
    try {
      const res = await changeInitialPasswordAction(newPassword)
      if (res.success) {
        toast.success(res.message)
        setIsOpen(false)
      } else {
        setErrorMsg(res.message || "Error al actualizar la contraseña.")
      }
    } catch (err: any) {
      setErrorMsg("Error de conexión al guardar la contraseña.")
    } finally {
      setIsPending(false)
    }
  }

  const handleCancelAndLogout = async () => {
    await logoutAction()
    window.location.href = "/login"
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in-up">
      <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 md:p-10 relative border border-slate-100">
        
        {/* Encabezado */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold shrink-0 border border-amber-200">
            <KeyRound size={28} />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider mb-1">
              Primer Inicio de Sesión
            </div>
            <h2 className="text-2xl font-black text-[#0B1B3D]">
              Actualiza tu Contraseña
            </h2>
          </div>
        </div>

        <p className="text-sm text-slate-600 mb-6 leading-relaxed">
          Hola <strong>{adminName}</strong>. Has ingresado con una contraseña temporal de primer uso. Por políticas de seguridad institucional, debes configurar una <strong>contraseña personal definitiva</strong> para poder acceder y administrar el sistema.
        </p>

        {errorMsg && (
          <div className="mb-5 p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2.5 font-bold animate-shake">
            <AlertCircle size={18} className="shrink-0 text-rose-500" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
              Nueva Contraseña Personal
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="pr-12 h-14 bg-slate-50 border-slate-200 text-slate-800 font-bold focus-visible:ring-indigo-600 rounded-xl"
                required
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
              Confirmar Nueva Contraseña
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
                className="pr-12 h-14 bg-slate-50 border-slate-200 text-slate-800 font-bold focus-visible:ring-indigo-600 rounded-xl"
                required
              />
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelAndLogout}
              className="h-12 rounded-xl font-bold border-slate-200 text-slate-500 hover:bg-slate-50"
              disabled={isPending}
            >
              Cerrar Sesión
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="flex-1 h-12 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Guardando...
                </>
              ) : (
                <>
                  <ShieldCheck size={18} />
                  Confirmar y Entrar
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
