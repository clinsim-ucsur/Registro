// Utilidad para notificaciones nativas Web Push (W3C) y alarmas en segundo plano
// Funciona con la app minimizada, cerrada o con la pantalla del teléfono bloqueada.

import { Role } from "@prisma/client"
import {
  getVapidPublicKeyAction,
  registerMobilePushSubscriptionAction,
  triggerTestPushNotificationAction,
} from "@/actions/push"
import type { ResolvedModuleStatus } from "@/lib/daily-program-api"

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/**
 * Registra el Service Worker en navegadores móviles compatibles.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null
  }
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" })
    return reg
  } catch (err) {
    console.warn("[ServiceWorker] Error al registrar:", err)
    return null
  }
}

/**
 * Solicita permisos de notificación del sistema y registra el Service Worker.
 */
export async function requestSystemNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied"
  }

  void registerServiceWorker()

  if (Notification.permission === "granted") {
    return "granted"
  }

  try {
    const permission = await Notification.requestPermission()
    return permission
  } catch (err) {
    console.warn("[Notification] Error al solicitar permiso:", err)
    return "denied"
  }
}

/**
 * Suscribe el teléfono al servicio oficial Web Push (VAPID) para que el servidor
 * despache notificaciones directamente al sistema operativo móvil aunque el navegador esté cerrado.
 */
export async function subscribeDeviceToWebPush(params: {
  dni: string
  userId: string
  userName: string
  role: Role
  campusName: string
}): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return false
  }

  if (Notification.permission !== "granted") {
    return false
  }

  try {
    let reg: ServiceWorkerRegistration | null | undefined =
      await navigator.serviceWorker.getRegistration()
    if (!reg) {
      reg = await registerServiceWorker()
    }
    if (!reg) return false

    await navigator.serviceWorker.ready

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const vapidRes = await getVapidPublicKeyAction()
      if (!vapidRes.success || !vapidRes.publicKey) {
        return false
      }
      const appServerKey = urlBase64ToUint8Array(vapidRes.publicKey)
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey as unknown as BufferSource,
      })
    }

    const subJson = sub.toJSON()
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      return false
    }

    const saveRes = await registerMobilePushSubscriptionAction({
      dni: params.dni,
      userId: params.userId,
      userName: params.userName,
      role: params.role,
      campusName: params.campusName,
      subscription: {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
        },
      },
    })

    return saveRes.success
  } catch (err) {
    console.warn("[WebPush] No se pudo completar la suscripción Push:", err)
    return false
  }
}

/**
 * Sincroniza los horarios de término de módulo del día con el Service Worker
 * para que disponga de alarmas programadas exactas además del Web Push del servidor.
 */
export async function syncModuleAlarmsWithServiceWorker(params: {
  userId: string
  role: Role
  modules: ResolvedModuleStatus[]
  currentLimaMinutes: number
}): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return
  }

  try {
    const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker())
    const worker = reg?.active || navigator.serviceWorker.controller
    if (!worker) return

    const cleanAmb = (raw?: string | null) =>
      raw ? raw.replace(/^[^:]+:\s*/, "").trim() : "Por asignar"

    const nowSec = new Date().getSeconds()
    const isDocente = params.role === Role.DOCENTE

    const alarms = params.modules
      .map((mod, idx) => {
        if (mod.status === "COMPLETADO") return null
        const nxt = params.modules[idx + 1] || null
        const diffMins = mod.endMinutes - params.currentLimaMinutes
        if (diffMins < 0) return null

        const delayMs = Math.max(1000, diffMins * 60 * 1000 - nowSec * 1000)
        const curAmb = cleanAmb(mod.ambiente)
        const nxtAmb = nxt ? cleanAmb(nxt.ambiente) : null
        const sameRoom = nxtAmb && curAmb.toLowerCase() === nxtAmb.toLowerCase()

        const title = isDocente
          ? nxt
            ? `⏰ Fin de hora (${mod.horaFin}) — Cambio de sección de alumnos`
            : `⏰ Fin de hora (${mod.horaFin}) — Sección concluida`
          : nxt
            ? `⏰ Fin de bloque (${mod.horaFin}) — Cambio de ambiente y tema`
            : `⏰ Fin de programación (${mod.horaFin}) — Marcar Salida`

        const body = isDocente
          ? nxt
            ? sameRoom
              ? `Terminó la hora con esta sección en ${curAmb} (${mod.horaFin}). Marque SALIDA y registre ENTRADA para la siguiente sección (${nxt.horaInicio} a ${nxt.horaFin}).`
              : `Terminó la hora en ${curAmb} (${mod.horaFin}). Marque SALIDA y cambie a ${nxtAmb} (${nxt.horaInicio} a ${nxt.horaFin} — ${nxt.courseName}).`
            : `Terminó la hora con su sección en ${curAmb} (${mod.horaFin}). Por favor, marque su SALIDA.`
          : nxt
            ? `Concluyó su sesión en ${curAmb} (${mod.horaFin}). Marque su SALIDA y diríjase a ${nxtAmb} (${nxt.horaInicio} a ${nxt.horaFin} — ${nxt.courseName}).`
            : `Concluyó su programación en ${curAmb} (${mod.horaFin}). Por favor, marque su SALIDA.`

        return {
          delayMs,
          title,
          body,
          tag: `clinsim-sw-alarm-${params.userId}-${mod.moduleNumber}`,
          url: "/",
        }
      })
      .filter(Boolean)

    worker.postMessage({
      type: "SCHEDULE_MODULE_ALARMS",
      alarms,
    })
  } catch (err) {
    console.warn("[ServiceWorker] Error sincronizando alarmas de módulos:", err)
  }
}

/**
 * Envía una notificación de prueba con retardo de 5 segundos para que el usuario pueda
 * minimizar/cerrar la app o bloquear su teléfono y comprobar cómo llega la alerta.
 */
export async function scheduleClosedAppTestNotification(params: {
  dni: string
  userName: string
  delayMs?: number
}): Promise<boolean> {
  const waitMs = params.delayMs ?? 5000
  const tag = `clinsim-closed-test-${Math.floor(Date.now() / 10000)}`

  try {
    // 1. Programar en el Service Worker local
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker())
      const worker = reg?.active || navigator.serviceWorker.controller
      if (worker) {
        worker.postMessage({
          type: "SCHEDULE_DELAYED_NOTIFICATION",
          delayMs: waitMs,
          title: "⏰ Aviso de Rotación — Clínica de Simulación",
          options: {
            body: `Hola ${params.userName}, así aparecerán sus avisos de rotación sobre otras apps o con el teléfono bloqueado.`,
            tag,
            url: "/",
          },
        })
      }
    }

    // 2. Despachar también por Web Push desde el servidor tras el retardo
    setTimeout(() => {
      void triggerTestPushNotificationAction(params.dni)
    }, waitMs)

    return true
  } catch (err) {
    console.warn("[scheduleClosedAppTestNotification] Error:", err)
    return false
  }
}

export interface ShowSystemAlertOptions {
  title: string
  message: string
  tag: string
  url?: string
}

/**
 * Dispara una notificación a nivel de Sistema Operativo usando el Service Worker.
 */
export async function showSystemNotification({
  title,
  message,
  tag,
  url = "/",
}: ShowSystemAlertOptions): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false
  }

  if (Notification.permission !== "granted") {
    return false
  }

  try {
    if ("serviceWorker" in navigator) {
      let reg: ServiceWorkerRegistration | null | undefined =
        await navigator.serviceWorker.getRegistration()
      if (!reg) {
        reg = await registerServiceWorker()
      }

      if (reg && "showNotification" in reg) {
        await reg.showNotification(title, {
          body: message,
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          tag,
          renotify: true,
          requireInteraction: true,
          vibrate: [400, 150, 400, 150, 600],
          data: { url },
        } as NotificationOptions)
        return true
      }
    }

    new Notification(title, {
      body: message,
      icon: "/favicon.ico",
      tag,
      requireInteraction: true,
    })
    return true
  } catch (err) {
    console.warn("[showSystemNotification] Error al emitir notificación:", err)
    return false
  }
}
