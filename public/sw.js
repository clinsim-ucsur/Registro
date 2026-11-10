// Service Worker del Portal de Asistencia - Clínica de Simulación UCSUR
// Permite ejecución en segundo plano y notificaciones nativas push/locales
// cuando la app está cerrada, en segundo plano o el teléfono está bloqueado.

const CACHE_NAME = "clinsim-sw-v1"

self.addEventListener("install", (event) => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

// Escuchar solicitudes de mostrar notificación con máxima prioridad en el sistema operativo
self.addEventListener("message", (event) => {
  if (!event.data) return

  if (event.data.type === "TRIGGER_NOTIFICATION") {
    const { title, options } = event.data
    event.waitUntil(
      self.registration.showNotification(title, {
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        vibrate: [350, 150, 350, 150, 500],
        requireInteraction: true, // Se mantiene visible en pantalla hasta que el usuario interactúe
        silent: false,
        tag: options?.tag || "clinsim-rotation-alert",
        renotify: true, // Vuelve a sonar y vibrar aunque haya otra notificación previa
        data: {
          url: options?.url || "/",
          timestamp: Date.now(),
        },
        ...options,
      })
    )
  }
})

// Al tocar la notificación (incluso desde la pantalla de bloqueo o sobre otra app)
self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || "/"

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Si la pestaña ya existe, enfocarla
      for (const client of clientList) {
        if ("focus" in client) {
          return client.focus()
        }
      }
      // Si está cerrada, abrir la ventana en primer plano
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})

