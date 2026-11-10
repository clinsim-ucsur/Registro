// Utilidad para notificaciones en segundo plano y con la app cerrada / pantalla bloqueada

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

  // Registrar SW en segundo plano
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

export interface ShowSystemAlertOptions {
  title: string
  message: string
  tag: string
  url?: string
}

/**
 * Dispara una notificación a nivel de Sistema Operativo usando el Service Worker.
 * A diferencia de new Notification(), el Service Worker permite que la notificación:
 * - Se proyecte sobre otras apps abiertas (heads-up / banner flotante).
 * - Suene y vibre en la pantalla de bloqueo o con el teléfono cerrado.
 * - Despierte la aplicación al tocarla.
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
    // Intentar a través de Service Worker Registration (la vía estándar para segundo plano / pantalla bloqueada)
    if ("serviceWorker" in navigator) {
      let reg: ServiceWorkerRegistration | null | undefined = await navigator.serviceWorker.getRegistration()
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
          vibrate: [350, 150, 350, 150, 500],
          data: { url },
        } as NotificationOptions)
        return true
      }
    }

    // Respaldo en caso de que Service Worker no esté disponible inmediatamente
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
