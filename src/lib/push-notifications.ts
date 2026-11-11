import * as webpushModule from "web-push"
import { Role } from "@prisma/client"

const webpush: typeof webpushModule =
  (webpushModule as any).default || webpushModule
import prisma from "@/lib/prisma"
import {
  fetchDailyProgramSessions,
  matchDailyProgramFromSessions,
  resolveUserModulesState,
  buildMobileRotationAlertPayload,
  getCurrentLimaMinutes,
  type TodayAttendanceRecordLite,
} from "@/lib/daily-program-api"

const VAPID_SETTING_KEY = "VAPID_KEYS_V1"
const PUSH_SUBS_SETTING_KEY = "MOBILE_PUSH_SUBSCRIPTIONS_V1"

export interface StoredPushSubscriptionItem {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
  dni: string
  userId: string
  userName: string
  role: Role
  campusName: string
  updatedAt: string
  lastDateStr?: string
  notifiedKeys?: string[]
}

let cachedVapidKeys: { publicKey: string; privateKey: string } | null = null
let vapidConfigured = false
let cachedSubscriptions: StoredPushSubscriptionItem[] | null = null
let lastPushCheckMs = 0
let inflightPushCheck: Promise<{ checked: number; sent: number }> | null = null

function getLimaDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

export async function getOrCreateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (cachedVapidKeys) {
    if (!vapidConfigured) {
      webpush.setVapidDetails(
        "mailto:simulacion@cientifica.edu.pe",
        cachedVapidKeys.publicKey,
        cachedVapidKeys.privateKey
      )
      vapidConfigured = true
    }
    return cachedVapidKeys
  }

  try {
    const existing = await prisma.systemSetting.findUnique({
      where: { key: VAPID_SETTING_KEY },
    })
    if (existing?.value) {
      const parsed = JSON.parse(existing.value)
      if (parsed?.publicKey && parsed?.privateKey) {
        cachedVapidKeys = {
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
        }
        webpush.setVapidDetails(
          "mailto:simulacion@cientifica.edu.pe",
          cachedVapidKeys.publicKey,
          cachedVapidKeys.privateKey
        )
        vapidConfigured = true
        return cachedVapidKeys
      }
    }
  } catch (err) {
    console.warn("[PushNotifications] Error leyendo VAPID keys:", err)
  }

  const generated = webpush.generateVAPIDKeys()
  cachedVapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
  }

  try {
    await prisma.systemSetting.upsert({
      where: { key: VAPID_SETTING_KEY },
      update: { value: JSON.stringify(cachedVapidKeys) },
      create: { key: VAPID_SETTING_KEY, value: JSON.stringify(cachedVapidKeys) },
    })
  } catch (err) {
    console.warn("[PushNotifications] No se pudo persistir VAPID keys en BD:", err)
  }

  webpush.setVapidDetails(
    "mailto:simulacion@cientifica.edu.pe",
    cachedVapidKeys.publicKey,
    cachedVapidKeys.privateKey
  )
  vapidConfigured = true
  return cachedVapidKeys
}

async function loadSubscriptions(): Promise<StoredPushSubscriptionItem[]> {
  if (cachedSubscriptions) return cachedSubscriptions
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: PUSH_SUBS_SETTING_KEY },
    })
    if (setting?.value) {
      const parsed = JSON.parse(setting.value)
      if (Array.isArray(parsed)) {
        cachedSubscriptions = parsed
        return cachedSubscriptions
      }
    }
  } catch (err) {
    console.warn("[PushNotifications] Error cargando suscripciones:", err)
  }
  cachedSubscriptions = []
  return cachedSubscriptions
}

async function persistSubscriptions(subs: StoredPushSubscriptionItem[]): Promise<void> {
  // Conservar las 300 suscripciones más recientes
  const trimmed = subs.slice(-300)
  cachedSubscriptions = trimmed
  try {
    await prisma.systemSetting.upsert({
      where: { key: PUSH_SUBS_SETTING_KEY },
      update: { value: JSON.stringify(trimmed) },
      create: { key: PUSH_SUBS_SETTING_KEY, value: JSON.stringify(trimmed) },
    })
  } catch (err) {
    console.warn("[PushNotifications] Error guardando suscripciones:", err)
  }
}

export async function saveMobilePushSubscription(params: {
  dni: string
  userId: string
  userName: string
  role: Role
  campusName: string
  subscription: {
    endpoint: string
    keys: {
      p256dh: string
      auth: string
    }
  }
}): Promise<{ success: boolean }> {
  if (!params.subscription?.endpoint || !params.subscription?.keys?.p256dh || !params.subscription?.keys?.auth) {
    return { success: false }
  }

  const subs = await loadSubscriptions()
  const todayStr = getLimaDateString()
  const idx = subs.findIndex((s) => s.endpoint === params.subscription.endpoint)

  const existing = idx !== -1 ? subs[idx] : null
  const updatedItem: StoredPushSubscriptionItem = {
    endpoint: params.subscription.endpoint,
    keys: {
      p256dh: params.subscription.keys.p256dh,
      auth: params.subscription.keys.auth,
    },
    dni: params.dni.trim(),
    userId: params.userId,
    userName: params.userName,
    role: params.role,
    campusName: params.campusName || "Campus Villa",
    updatedAt: new Date().toISOString(),
    lastDateStr: todayStr,
    notifiedKeys:
      existing && existing.lastDateStr === todayStr && Array.isArray(existing.notifiedKeys)
        ? existing.notifiedKeys
        : [],
  }

  if (idx !== -1) {
    subs[idx] = updatedItem
  } else {
    subs.push(updatedItem)
  }

  await persistSubscriptions(subs)
  ensureServerPushSchedulerStarted()
  return { success: true }
}

export async function sendWebPushPayload(
  sub: StoredPushSubscriptionItem,
  payload: {
    title: string
    body: string
    tag: string
    url?: string
  }
): Promise<{ sent: boolean; expired?: boolean }> {
  try {
    await getOrCreateVapidKeys()
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: sub.keys,
      },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        url: payload.url || "/",
        timestamp: Date.now(),
      }),
      {
        TTL: 3600,
        urgency: "high",
      }
    )
    return { sent: true }
  } catch (err: any) {
    const statusCode = err?.statusCode
    if (statusCode === 404 || statusCode === 410) {
      return { sent: false, expired: true }
    }
    console.warn("[PushNotifications] Error enviando Web Push:", err?.message || err)
    return { sent: false }
  }
}

/**
 * Envía una notificación Web Push real de prueba al celular vinculado con ese DNI.
 */
export async function sendTestPushToDni(dni: string): Promise<{
  success: boolean
  sentCount: number
  message: string
}> {
  const cleanDni = dni.trim()
  const subs = await loadSubscriptions()
  const targetSubs = subs.filter((s) => s.dni === cleanDni)

  if (targetSubs.length === 0) {
    return {
      success: false,
      sentCount: 0,
      message: "Aún no hay una suscripción Push activa en este teléfono. Toque 'Activar avisos' primero.",
    }
  }

  let sentCount = 0
  const validSubs: StoredPushSubscriptionItem[] = []

  for (const sub of subs) {
    if (sub.dni !== cleanDni) {
      validSubs.push(sub)
      continue
    }
    const res = await sendWebPushPayload(sub, {
      title: "🔔 Aviso de Rotación Activado — Clínica de Simulación",
      body: `Hola ${sub.userName}, su teléfono recibirá este aviso sobre cualquier app o con la pantalla bloqueada cuando termine su hora de clase.`,
      tag: `clinsim-test-push-${Date.now()}`,
      url: "/",
    })
    if (res.sent) {
      sentCount++
      validSubs.push(sub)
    } else if (!res.expired) {
      validSubs.push(sub)
    }
  }

  if (validSubs.length !== subs.length) {
    await persistSubscriptions(validSubs)
  }

  return {
    success: sentCount > 0,
    sentCount,
    message:
      sentCount > 0
        ? "Notificación Push enviada al sistema operativo de su teléfono."
        : "No se pudo entregar la notificación Push al dispositivo.",
  }
}

/**
 * Verifica todos los teléfonos suscritos de Docentes y Pacientes Simulados y envía
 * notificaciones Web Push encriptadas cuando llega la hora de término/rotación de su módulo,
 * incluso si el navegador o la aplicación están completamente cerrados.
 */
export async function checkAndDispatchDuePushNotifications(force = false): Promise<{
  checked: number
  sent: number
}> {
  const nowMs = Date.now()
  if (!force && nowMs - lastPushCheckMs < 20_000) {
    return { checked: 0, sent: 0 }
  }
  if (inflightPushCheck) return inflightPushCheck

  lastPushCheckMs = nowMs
  inflightPushCheck = (async () => {
    try {
      const subs = await loadSubscriptions()
      if (subs.length === 0) {
        return { checked: 0, sent: 0 }
      }

      const moduleSubs = subs.filter(
        (s) => s.role === Role.DOCENTE || s.role === Role.PACIENTE_SIMULADO
      )
      if (moduleSubs.length === 0) {
        return { checked: 0, sent: 0 }
      }

      const now = new Date()
      const todayStr = getLimaDateString(now)
      const currentLimaMins = getCurrentLimaMinutes(now)

      const limaOffset = -5 * 60 * 60 * 1000
      const limaToday = new Date(now.getTime() + limaOffset)
      limaToday.setUTCHours(0, 0, 0, 0)
      const startOfDayUTC = new Date(limaToday.getTime() - limaOffset)
      const endOfDayUTC = new Date(startOfDayUTC.getTime() + 24 * 60 * 60 * 1000)

      const uniqueUserIds = Array.from(new Set(moduleSubs.map((s) => s.userId)))

      const [sessions, todayRecords] = await Promise.all([
        fetchDailyProgramSessions(2800, false),
        prisma.attendanceRecord.findMany({
          where: {
            userId: { in: uniqueUserIds },
            timestamp: { gte: startOfDayUTC, lt: endOfDayUTC },
          },
          orderBy: { timestamp: "asc" },
          select: {
            userId: true,
            type: true,
            timestamp: true,
            course: { select: { name: true } },
          },
        }),
      ])

      const recordsByUserId = new Map<string, TodayAttendanceRecordLite[]>()
      for (const r of todayRecords) {
        const list = recordsByUserId.get(r.userId) || []
        list.push({
          type: r.type,
          timestamp: r.timestamp.toISOString(),
          courseName: r.course?.name || null,
        })
        recordsByUserId.set(r.userId, list)
      }

      let sentCount = 0
      let dirty = false
      const survivingSubs: StoredPushSubscriptionItem[] = []

      for (const sub of subs) {
        if (sub.role !== Role.DOCENTE && sub.role !== Role.PACIENTE_SIMULADO) {
          survivingSubs.push(sub)
          continue
        }

        if (sub.lastDateStr !== todayStr) {
          sub.lastDateStr = todayStr
          sub.notifiedKeys = []
          dirty = true
        }

        const prog = matchDailyProgramFromSessions(
          sessions,
          sub.userName,
          sub.role,
          sub.campusName
        )

        if (!prog.found || prog.sessions.length === 0) {
          survivingSubs.push(sub)
          continue
        }

        const userRecs = recordsByUserId.get(sub.userId) || []
        const resolution = resolveUserModulesState(
          prog.sessions,
          userRecs,
          currentLimaMins,
          sub.role
        )
        const alertPayload = buildMobileRotationAlertPayload(resolution, false, sub.role)

        if (alertPayload.shouldAlert && alertPayload.currentModule) {
          const alertKey = `${todayStr}_${alertPayload.reason}_${alertPayload.currentModule.moduleNumber}_${alertPayload.nextModule?.moduleNumber ?? 0}`
          const notified = Array.isArray(sub.notifiedKeys) ? sub.notifiedKeys : []

          if (!notified.includes(alertKey)) {
            const pushRes = await sendWebPushPayload(sub, {
              title: alertPayload.title,
              body: alertPayload.message,
              tag: `clinsim-rot-${alertKey}`,
              url: "/",
            })

            if (pushRes.expired) {
              dirty = true
              continue
            }

            if (pushRes.sent) {
              sentCount++
              sub.notifiedKeys = [...notified, alertKey]
              dirty = true
            }
          }
        }

        survivingSubs.push(sub)
      }

      if (dirty || survivingSubs.length !== subs.length) {
        await persistSubscriptions(survivingSubs)
      }

      return { checked: moduleSubs.length, sent: sentCount }
    } catch (err) {
      console.warn("[PushNotifications] Error en checkAndDispatchDuePushNotifications:", err)
      return { checked: 0, sent: 0 }
    } finally {
      inflightPushCheck = null
    }
  })()

  return inflightPushCheck
}

const globalForPush = globalThis as unknown as {
  __clinsimPushInterval?: ReturnType<typeof setInterval>
}

export function ensureServerPushSchedulerStarted(): void {
  if (globalForPush.__clinsimPushInterval) return
  const timer = setInterval(() => {
    void checkAndDispatchDuePushNotifications(false)
  }, 25_000)
  if (typeof timer.unref === "function") {
    timer.unref()
  }
  globalForPush.__clinsimPushInterval = timer
}

