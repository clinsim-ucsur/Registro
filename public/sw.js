// Service Worker del Portal de Asistencia - Clínica de Simulación UCSUR
// Permite notificaciones nativas Push (W3C Web Push) y alarmas programadas en segundo plano
// cuando la aplicación está minimizada, completamente cerrada o con el teléfono bloqueado.

const CACHE_NAME = "clinsim-sw-v2"
const firedTags = new Map() // tag -> timestampMs
let scheduledTimers = []

function canFireTag(tag) {
  if (!tag) return true
  const prev = firedTags.get(tag)
  const now = Date.now()
  // Evitar duplicados si llegan al mismo tiempo por Push del servidor y por alarma local
  if (prev && now - prev < 180000) {
    return false
  }
  firedTags.set(tag, now)
  return true
}

function displayNativeAlert(title, options = {}) {
  const tag = options.tag || "clinsim-rotation-alert"
  if (!canFireTag(tag)) {
    return Promise.resolve()
  }

  return self.registration.showNotification(title, {
    body: options.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    vibrate: [400, 150, 400, 150, 600],
    requireInteraction: true, // Permanece en pantalla de bloqueo / sobre otras apps hasta que el usuario lo vea
    silent: false,
    tag,
    renotify: true,
    data: {
      url: options.url || "/",
      timestamp: Date.now(),
    },
  })
}

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

// 1. RECEPCIÓN DE NOTIFICACIONES WEB PUSH REALES DESDE EL SERVIDOR (FUNCIONA CON APP CERRADA / PANTALLA BLOQUEADA)
self.addEventListener("push", (event) => {
  let payload = {
    title: "⏰ Aviso de Rotación — Clínica de Simulación",
    body: "Ha finalizado el horario de su módulo actual. Revise su siguiente ambiente.",
    tag: "clinsim-push-alert",
    url: "/",
  }

  if (event.data) {
    try {
      const parsed = event.data.json()
      payload = { ...payload, ...parsed }
    } catch {
      payload.body = event.data.text() || payload.body
    }
  }

  event.waitUntil(
    displayNativeAlert(payload.title, {
      body: payload.body,
      tag: payload.tag,
      url: payload.url || "/",
    })
  )
})

// 2. ESCUCHA DE MENSAJES DESDE LA APLICACIÓN (NOTIFICACIÓN INMEDIATA, PRUEBA CON APP CERRADA Y ALARMAS DE MÓDULOS)
self.addEventListener("message", (event) => {
  if (!event.data) return

  if (event.data.type === "TRIGGER_NOTIFICATION") {
    const { title, options } = event.data
    event.waitUntil(displayNativeAlert(title, options || {}))
    return
  }

  if (event.data.type === "SCHEDULE_DELAYED_NOTIFICATION") {
    const { title, options, delayMs } = event.data
    const waitMs = Math.max(500, Number(delayMs) || 5000)
    event.waitUntil(
      new Promise((resolve) => {
        setTimeout(() => {
          displayNativeAlert(title, options || {}).finally(resolve)
        }, waitMs)
      })
    )
    return
  }

  if (event.data.type === "SCHEDULE_MODULE_ALARMS") {
    // Limpiar temporizadores anteriores y registrar los nuevos horarios del día del usuario
    for (const t of scheduledTimers) {
      clearTimeout(t)
    }
    scheduledTimers = []

    const alarms = Array.isArray(event.data.alarms) ? event.data.alarms : []
    for (const alarm of alarms) {
      const delayMs = Number(alarm.delayMs)
      if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 16 * 60 * 60 * 1000) {
        continue
      }
      const timerId = setTimeout(() => {
        void displayNativeAlert(alarm.title, {
          body: alarm.body,
          tag: alarm.tag,
          url: alarm.url || "/",
        })
      }, delayMs)
      scheduledTimers.push(timerId)
    }
  }
})

// 3. AL TOCAR LA NOTIFICACIÓN (DESDE PANTALLA BLOQUEADA O SOBRE CUALQUIER OTRA APP)
self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || "/"

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
    })
  )
})
