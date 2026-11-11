"use server"

import { Role } from "@prisma/client"
import {
  getOrCreateVapidKeys,
  saveMobilePushSubscription,
  sendTestPushToDni,
  checkAndDispatchDuePushNotifications,
  ensureServerPushSchedulerStarted,
} from "@/lib/push-notifications"

export async function getVapidPublicKeyAction(): Promise<{
  success: boolean
  publicKey?: string
}> {
  try {
    ensureServerPushSchedulerStarted()
    const keys = await getOrCreateVapidKeys()
    return { success: true, publicKey: keys.publicKey }
  } catch (err) {
    console.error("[getVapidPublicKeyAction] Error:", err)
    return { success: false }
  }
}

export async function registerMobilePushSubscriptionAction(params: {
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
  try {
    const res = await saveMobilePushSubscription(params)
    void checkAndDispatchDuePushNotifications(true)
    return res
  } catch (err) {
    console.error("[registerMobilePushSubscriptionAction] Error:", err)
    return { success: false }
  }
}

export async function triggerTestPushNotificationAction(dni: string): Promise<{
  success: boolean
  sentCount: number
  message: string
}> {
  try {
    return await sendTestPushToDni(dni)
  } catch (err) {
    console.error("[triggerTestPushNotificationAction] Error:", err)
    return {
      success: false,
      sentCount: 0,
      message: "Error al enviar la notificación Push de prueba.",
    }
  }
}

