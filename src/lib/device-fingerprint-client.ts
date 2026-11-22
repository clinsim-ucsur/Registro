"use client"

import type { DeviceFingerprintPayload } from "@/lib/device-binding"

export const DEVICE_TOKEN_STORAGE_KEY = "clinsim_device_unique_token_v1"
export const BOUND_DNI_STORAGE_KEY = "clinsim_bound_device_dni_v1"

/**
 * Hash determinístico FNV-1a de 64 bits (en formato hex) rápido y sin dependencias externas.
 */
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

export function clearLocalDeviceBindingCache(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(BOUND_DNI_STORAGE_KEY)
    localStorage.removeItem("clinsim_saved_personal_dni")
    document.cookie = `${BOUND_DNI_STORAGE_KEY}=; path=/; max-age=0`
  } catch {}
}

export function saveLocalBoundDni(dni: string): void {
  if (typeof window === "undefined" || !/^\d{8}$/.test(dni)) return
  try {
    localStorage.setItem(BOUND_DNI_STORAGE_KEY, dni)
    localStorage.setItem("clinsim_saved_personal_dni", dni)
    setPersistentCookie(BOUND_DNI_STORAGE_KEY, dni)
  } catch {}
}

export function getLocalBoundDni(): string | null {
  if (typeof window === "undefined") return null
  try {
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

function getOrCreateDeviceToken(): string {
  if (typeof window === "undefined") return "server"
  try {
    let token =
      localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY) ||
      getCookieValue(DEVICE_TOKEN_STORAGE_KEY)
    if (!token) {
      const randomPart =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
      token = `dev_${randomPart}`
    }
    localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token)
    setPersistentCookie(DEVICE_TOKEN_STORAGE_KEY, token)
    return token
  } catch {
    return `dev_fallback_${navigator.userAgent.length}`
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
  // En Android, si el navegador expone el modelo antes de "Build/" o dentro de "(Linux; Android X; MODEL)"
  const androidMatch = ua.match(/Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/|\))/i)
  if (androidMatch && androidMatch[1]) {
    const candidate = androidMatch[1].trim()
    // En Chrome con User-Agent Reduction el modelo reducido es "K"
    if (candidate && candidate !== "K" && candidate.length > 2) {
      return candidate.toUpperCase()
    }
  }
  if (/iPhone/i.test(ua)) return "IPHONE"
  if (/iPad/i.test(ua)) return "IPAD"
  return "GENERIC"
}

function getWebGLHardwareConstants(): {
  limitsKey: string
  normalizedGpuChip: string
} {
  if (typeof document === "undefined") {
    return { limitsKey: "no-webgl", normalizedGpuChip: "unknown" }
  }
  try {
    const canvas = document.createElement("canvas")
    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null)
    if (!gl) {
      return { limitsKey: "no-gl", normalizedGpuChip: "unknown" }
    }

    // Constantes físicas del chip gráfico invariantes entre distintos navegadores del mismo equipo
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0
    const maxCube = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE) || 0
    const maxRender = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 0
    const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || 0
    const maxVUniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) || 0
    const maxVarying = gl.getParameter(gl.MAX_VARYING_VECTORS) || 0
    const maxFUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 0
    const maxTexUnits = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) || 0
    const limitsKey = `${maxTex}.${maxCube}.${maxRender}.${maxAttribs}.${maxVUniforms}.${maxVarying}.${maxFUniforms}.${maxTexUnits}`

    let rawRenderer = ""
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info")
    if (debugInfo) {
      rawRenderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "")
    }
    if (!rawRenderer) {
      rawRenderer = String(gl.getParameter(gl.RENDERER) || "")
    }

    const lower = rawRenderer.toLowerCase()
    let normalizedGpuChip = lower
      .replace(/angle\s*\(/g, "")
      .replace(/direct3d11.*$/g, "")
      .replace(/opengl\s*es.*$/g, "")
      .replace(/\(0x[0-9a-f]+\)/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")

    return {
      limitsKey,
      normalizedGpuChip: normalizedGpuChip || "generic_gpu",
    }
  } catch {
    return { limitsKey: "err-gl", normalizedGpuChip: "unknown" }
  }
}

let cachedFingerprintPromise: Promise<DeviceFingerprintPayload> | null = null

/**
 * Genera la huella física del equipo que es idéntica aunque el usuario abra el link
 * en otro navegador (Chrome, Safari, Samsung Internet, Edge, Firefox, Opera o Modo Incógnito)
 * dentro del mismo celular o equipo.
 */
export async function getClientDeviceFingerprint(): Promise<DeviceFingerprintPayload> {
  if (cachedFingerprintPromise) return cachedFingerprintPromise

  cachedFingerprintPromise = (async () => {
    const deviceToken = getOrCreateDeviceToken()
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : ""
    const platform = typeof navigator !== "undefined" ? navigator.platform || "" : ""
    const osFamily = detectOsFamily(ua, platform)

    const sw = typeof window !== "undefined" ? window.screen?.width || 0 : 0
    const sh = typeof window !== "undefined" ? window.screen?.height || 0 : 0
    const minDim = Math.min(sw, sh)
    const maxDim = Math.max(sw, sh)
    const colorDepth = typeof window !== "undefined" ? window.screen?.colorDepth || 24 : 24
    const dpr =
      typeof window !== "undefined"
        ? Number((window.devicePixelRatio || 1).toFixed(2))
        : 1

    const cores =
      typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 0 : 0
    // Normalizar touchPoints a booleano/rango para que sea invariante entre todos los navegadores del mismo equipo
    const rawTouch =
      typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0
    const hasTouch = rawTouch > 0 ? "TOUCH" : "NO_TOUCH"

    const tz =
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima"
        : "America/Lima"

    const { limitsKey, normalizedGpuChip } = getWebGLHardwareConstants()

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

    // coreHardwareId: 100% idéntico entre TODOS los navegadores (Chrome, Edge, Firefox, Safari, Samsung Internet, Incógnito) en el mismo equipo
    const coreRaw = [
      osFamily,
      `${minDim}x${maxDim}`,
      colorDepth,
      cores,
      hasTouch,
      tz,
    ].join("|")
    const coreHardwareId = `chw_${hashString(coreRaw)}`

    // extendedHardwareId: Incluye chip GPU, DPR y límites WebGL (idéntico en navegadores Chromium/WebKit del mismo equipo)
    const extRaw = [
      coreRaw,
      dpr,
      limitsKey,
      normalizedGpuChip,
    ].join("|")
    const extendedHardwareId = `ehw_${hashString(extRaw)}`

    return {
      deviceToken,
      coreHardwareId,
      extendedHardwareId,
      deviceModel,
      screenProfile,
      userAgent: ua.slice(0, 180),
    }
  })()

  return cachedFingerprintPromise
}
