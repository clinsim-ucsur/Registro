"use client"

import type { DeviceFingerprintPayload } from "@/lib/device-binding"

export const DEVICE_TOKEN_STORAGE_KEY = "clinsim_device_unique_token_v1"
// v2 purga automáticamente cualquier DNI contaminado en localStorage por la colisión de hardware v1 en iPhone/Android
export const BOUND_DNI_STORAGE_KEY = "clinsim_bound_device_dni_v2"
const LEGACY_BOUND_DNI_KEY_V1 = "clinsim_bound_device_dni_v1"
const LEGACY_SAVED_DNI_KEY = "clinsim_saved_personal_dni"
const IDENTITY_CACHE_NAME = "clinsim_device_identity_cache_v1"
const IDENTITY_CACHE_URL = "/__clinsim_device_identity_v1"

function hashString(input: string): string {
  let h1 = 0xdeadbeef ^ input.length
  let h2 = 0x41c6ce57 ^ input.length
  for (let i = 0, ch; i < input.length; i++) {
    ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")
}

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"))
  return match ? decodeURIComponent(match[2]) : null
}

function setPersistentCookie(name: string, value: string): void {
  if (typeof document === "undefined") return
  try {
    const maxAge = 60 * 60 * 24 * 365 // 1 año
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`
  } catch {}
}

/**
 * Limpia cualquier caché heredada de la versión v1 para que los teléfonos afectados hoy
 * se autolimpien de inmediato al abrir el enlace.
 */
export function purgeLegacyContaminatedDniCache(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(LEGACY_BOUND_DNI_KEY_V1)
    localStorage.removeItem(LEGACY_SAVED_DNI_KEY)
    document.cookie = `${LEGACY_BOUND_DNI_KEY_V1}=; path=/; max-age=0`
  } catch {}
}

export function clearLocalDeviceBindingCache(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(BOUND_DNI_STORAGE_KEY)
    localStorage.removeItem(LEGACY_BOUND_DNI_KEY_V1)
    localStorage.removeItem(LEGACY_SAVED_DNI_KEY)
    document.cookie = `${BOUND_DNI_STORAGE_KEY}=; path=/; max-age=0`
    document.cookie = `${LEGACY_BOUND_DNI_KEY_V1}=; path=/; max-age=0`
  } catch {}
}

export function saveLocalBoundDni(dni: string): void {
  if (typeof window === "undefined" || !/^\d{8}$/.test(dni)) return
  try {
    purgeLegacyContaminatedDniCache()
    localStorage.setItem(BOUND_DNI_STORAGE_KEY, dni)
    setPersistentCookie(BOUND_DNI_STORAGE_KEY, dni)
  } catch {}
}

export function getLocalBoundDni(): string | null {
  if (typeof window === "undefined") return null
  try {
    purgeLegacyContaminatedDniCache()
    const fromLs = localStorage.getItem(BOUND_DNI_STORAGE_KEY)
    if (fromLs && /^\d{8}$/.test(fromLs)) return fromLs
    const fromCookie = getCookieValue(BOUND_DNI_STORAGE_KEY)
    if (fromCookie && /^\d{8}$/.test(fromCookie)) {
      localStorage.setItem(BOUND_DNI_STORAGE_KEY, fromCookie)
      return fromCookie
    }
  } catch {}
  return null
}

async function readTokenFromCacheStorage(): Promise<string | null> {
  if (typeof window === "undefined" || !("caches" in window)) return null
  try {
    const cache = await caches.open(IDENTITY_CACHE_NAME)
    const resp = await cache.match(IDENTITY_CACHE_URL)
    if (!resp) return null
    const data = await resp.json()
    if (data?.deviceToken && typeof data.deviceToken === "string") {
      return data.deviceToken
    }
  } catch {}
  return null
}

async function writeTokenToCacheStorage(deviceToken: string): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return
  try {
    const cache = await caches.open(IDENTITY_CACHE_NAME)
    await cache.put(
      IDENTITY_CACHE_URL,
      new Response(JSON.stringify({ deviceToken }), {
        headers: { "Content-Type": "application/json" },
      })
    )
  } catch {}
}

async function getOrCreateDeviceToken(): Promise<string> {
  if (typeof window === "undefined") return "server"
  try {
    let token =
      localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY) ||
      getCookieValue(DEVICE_TOKEN_STORAGE_KEY)

    if (!token) {
      token = await readTokenFromCacheStorage()
    }

    if (!token) {
      const randomPart =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`
      token = `dev_${randomPart}`
    }

    localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token)
    setPersistentCookie(DEVICE_TOKEN_STORAGE_KEY, token)
    void writeTokenToCacheStorage(token)
    return token
  } catch {
    return `dev_fallback_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}

function detectOsFamily(ua: string, platform: string): string {
  if (/iphone|ipad|ipod/i.test(ua)) return "IOS"
  if (/android/i.test(ua)) return "ANDROID"
  if (/win/i.test(ua) || /win/i.test(platform)) return "WINDOWS"
  if (/mac/i.test(ua) || /mac/i.test(platform)) return "MAC"
  if (/linux/i.test(ua) || /linux/i.test(platform)) return "LINUX"
  return "OTHER"
}

function extractHardwareModelFromUA(ua: string): string {
  const androidMatch = ua.match(/Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/|\))/i)
  if (androidMatch && androidMatch[1]) {
    const candidate = androidMatch[1].trim()
    if (candidate && candidate !== "K" && candidate.length > 2) {
      return candidate.toUpperCase()
    }
  }
  if (/iPhone/i.test(ua)) return "IPHONE"
  if (/iPad/i.test(ua)) return "IPAD"
  return "GENERIC"
}

function detectStandalonePwa(): boolean {
  if (typeof window === "undefined") return false
  try {
    const isStandaloneMedia = window.matchMedia?.("(display-mode: standalone)")?.matches
    const isIosStandalone = Boolean((window.navigator as any)?.standalone)
    return Boolean(isStandaloneMedia || isIosStandalone)
  } catch {
    return false
  }
}

let cachedFingerprintPromise: Promise<DeviceFingerprintPayload> | null = null

export async function getClientDeviceFingerprint(): Promise<DeviceFingerprintPayload> {
  if (cachedFingerprintPromise) return cachedFingerprintPromise

  cachedFingerprintPromise = (async () => {
    const deviceToken = await getOrCreateDeviceToken()
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : ""
    const platform = typeof navigator !== "undefined" ? navigator.platform || "" : ""
    const osFamily = detectOsFamily(ua, platform)

    const sw = typeof window !== "undefined" ? window.screen?.width || 0 : 0
    const sh = typeof window !== "undefined" ? window.screen?.height || 0 : 0
    const minDim = Math.min(sw, sh)
    const maxDim = Math.max(sw, sh)
    const dpr =
      typeof window !== "undefined"
        ? Number((window.devicePixelRatio || 1).toFixed(2))
        : 1

    let deviceModel = extractHardwareModelFromUA(ua)
    try {
      const uaData = (navigator as any)?.userAgentData
      if (uaData && typeof uaData.getHighEntropyValues === "function") {
        const highEntropy = await Promise.race([
          uaData.getHighEntropyValues(["model", "platformVersion"]),
          new Promise<null>((r) => setTimeout(() => r(null), 150)),
        ])
        if (highEntropy?.model && String(highEntropy.model).trim().length > 1) {
          deviceModel = String(highEntropy.model).trim().toUpperCase()
        }
      }
    } catch {}

    const screenProfile = `${osFamily}|${minDim}x${maxDim}@${dpr}`
    const isStandalonePwa = detectStandalonePwa()

    // Cada dispositivo incluye su deviceToken único en su huella para que dos iPhones o dos Androids iguales nunca colisionen
    const coreHardwareId = `chw_${hashString(`${deviceToken}|${screenProfile}`)}`
    const extendedHardwareId = `ehw_${hashString(`${deviceToken}|${screenProfile}|${deviceModel}`)}`

    return {
      deviceToken,
      coreHardwareId,
      extendedHardwareId,
      deviceModel,
      screenProfile,
      userAgent: ua.slice(0, 180),
      isStandalonePwa,
    }
  })()

  return cachedFingerprintPromise
}
