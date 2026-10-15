"use server"

import { computeAnalytics } from "@/lib/analytics"
import { requireAdmin } from "@/lib/session"
import type { AnalyticsData } from "@/lib/analytics-types"

const ALLOWED_RANGES = [7, 30, 90]

export async function getAnalyticsAction(
  days: number,
  campusId: string | null
): Promise<{ success: true; data: AnalyticsData } | { success: false; message: string }> {
  try {
    await requireAdmin()

    const safeDays = ALLOWED_RANGES.includes(days) ? days : 30
    const safeCampus = typeof campusId === "string" && campusId.length > 0 ? campusId : null

    const data = await computeAnalytics({ days: safeDays, campusId: safeCampus })
    return { success: true, data }
  } catch (error) {
    console.error("[getAnalyticsAction]", error)
    return { success: false, message: "No se pudieron cargar las métricas." }
  }
}
