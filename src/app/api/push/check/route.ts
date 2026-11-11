import { NextResponse } from "next/server"
import {
  checkAndDispatchDuePushNotifications,
  ensureServerPushSchedulerStarted,
} from "@/lib/push-notifications"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    ensureServerPushSchedulerStarted()
    const result = await checkAndDispatchDuePushNotifications(false)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[/api/push/check] Error:", err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function POST() {
  return GET()
}

