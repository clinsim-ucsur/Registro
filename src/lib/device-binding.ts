import prisma from "@/lib/prisma"

export const DEVICE_BINDINGS_SETTING_KEY = "MOBILE_DEVICE_DNI_BINDINGS_V1"

export interface DeviceFingerprintPayload {
  deviceToken: string
  coreHardwareId: string
  extendedHardwareId?: string
  deviceModel?: string
  screenProfile?: string
  userAgent?: string
}

export interface DeviceBindingEntry {
  dni: string
  userId: string
  userName: string
  role: string
  deviceTokens: string[]
  coreHardwareId: string
  extendedHardwareIds: string[]
  deviceModel?: string
  screenProfile?: string
  lastIp?: string
  boundAt: string
  updatedAt: string
}

let cachedBindingsByDni: Map<string, DeviceBindingEntry> | null = null
let cacheLoadedAt = 0
const CACHE_TTL_MS = 60_000

async function loadBindingsMap(forceReload = false): Promise<Map<string, DeviceBindingEntry>> {
  const now = Date.now()
  if (!forceReload && cachedBindingsByDni && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedBindingsByDni
  }

  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: DEVICE_BINDINGS_SETTING_KEY },
    })
    const map = new Map<string, DeviceBindingEntry>()
    if (setting?.value) {
      const parsed = JSON.parse(setting.value)
      if (parsed && typeof parsed === "object") {
        for (const [dni, rawEntry] of Object.entries(parsed)) {
          const entry = rawEntry as DeviceBindingEntry
          if (entry && entry.dni && entry.coreHardwareId) {
            map.set(dni, {
              ...entry,
              deviceTokens: Array.isArray(entry.deviceTokens) ? entry.deviceTokens : [],
              extendedHardwareIds: Array.isArray(entry.extendedHardwareIds)
                ? entry.extendedHardwareIds
                : [],
            })
          }
        }
      }
    }
    cachedBindingsByDni = map
    cacheLoadedAt = now
    return map
  } catch (err) {
    console.warn("[device-binding] Error cargando vínculos de equipos:", err)
    return cachedBindingsByDni || new Map<string, DeviceBindingEntry>()
  }
}

async function persistBindingsMap(map: Map<string, DeviceBindingEntry>): Promise<void> {
  cachedBindingsByDni = map
  cacheLoadedAt = Date.now()
  const obj: Record<string, DeviceBindingEntry> = {}
  for (const [dni, entry] of map.entries()) {
    obj[dni] = entry
  }

  try {
    await prisma.systemSetting.upsert({
      where: { key: DEVICE_BINDINGS_SETTING_KEY },
      update: {
        value: JSON.stringify(obj),
        description: "Registro de vinculación exclusiva Celular/Equipo <-> DNI (Anti-suplantación)",
      },
      create: {
        key: DEVICE_BINDINGS_SETTING_KEY,
        value: JSON.stringify(obj),
        description: "Registro de vinculación exclusiva Celular/Equipo <-> DNI (Anti-suplantación)",
      },
    })
  } catch (err) {
    console.warn("[device-binding] Error guardando vínculos de equipos:", err)
  }
}

/**
 * Verifica si una huella de dispositivo coincide con un registro vinculado existente,
 * incluso si el enlace se abrió desde OTRO navegador o pestaña incógnito en el mismo equipo.
 */
export function isSamePhysicalDevice(
  entry: DeviceBindingEntry,
  fp: DeviceFingerprintPayload,
  clientIp?: string
): boolean {
  if (!fp) return false

  // 1. Coincidencia exacta por token persistente del navegador
  if (fp.deviceToken && entry.deviceTokens.includes(fp.deviceToken)) {
    return true
  }

  // 2. Coincidencia por huella extendida de hardware (Modelo + GPU + Pantalla + DPR + Cores)
  if (
    fp.extendedHardwareId &&
    entry.extendedHardwareIds.includes(fp.extendedHardwareId)
  ) {
    return true
  }

  // 3. Coincidencia por huella base multi-navegador del equipo (OS + Pantalla física + ColorDepth + Cores + Touch + Timezone)
  if (fp.coreHardwareId && entry.coreHardwareId === fp.coreHardwareId) {
    // Si ambos reportan un modelo físico específico (ej. SM-A546E vs SM-G991B) y son distintos, no es el mismo equipo
    if (
      fp.deviceModel &&
      entry.deviceModel &&
      fp.deviceModel !== "GENERIC" &&
      entry.deviceModel !== "GENERIC" &&
      fp.deviceModel !== entry.deviceModel
    ) {
      return false
    }
    return true
  }

  return false
}

/**
 * Busca si el equipo físico actual ya tiene un DNI vinculado (en el mismo navegador o en otro navegador del mismo equipo).
 */
export async function findBindingForDevice(
  fp: DeviceFingerprintPayload,
  clientIp?: string
): Promise<DeviceBindingEntry | null> {
  if (!fp || (!fp.deviceToken && !fp.coreHardwareId)) return null

  const map = await loadBindingsMap()
  const entries = Array.from(map.values())

  // Prioridad 1: Coincidencia exacta por deviceToken
  if (fp.deviceToken) {
    const tokenMatch = entries.find((e) => e.deviceTokens.includes(fp.deviceToken))
    if (tokenMatch) return tokenMatch
  }

  // Prioridad 2: Coincidencia por extendedHardwareId (cuando abre otro navegador basado en el mismo motor o con el mismo modelo/GPU)
  if (fp.extendedHardwareId) {
    const extMatches = entries.filter((e) =>
      e.extendedHardwareIds.includes(fp.extendedHardwareId!)
    )
    if (extMatches.length === 1) {
      await attachBrowserTokenToEntry(map, extMatches[0], fp, clientIp)
      return extMatches[0]
    }
    if (extMatches.length > 1 && clientIp) {
      const ipMatch = extMatches.find((e) => e.lastIp === clientIp)
      if (ipMatch) {
        await attachBrowserTokenToEntry(map, ipMatch, fp, clientIp)
        return ipMatch
      }
    }
  }

  // Prioridad 3: Coincidencia por coreHardwareId (invariante entre todos los navegadores del mismo equipo: Chrome, Safari, Edge, Firefox, Samsung Internet, Incógnito)
  if (fp.coreHardwareId) {
    const coreMatches = entries.filter((e) => isSamePhysicalDevice(e, fp, clientIp))
    if (coreMatches.length === 1) {
      await attachBrowserTokenToEntry(map, coreMatches[0], fp, clientIp)
      return coreMatches[0]
    }
    if (coreMatches.length > 1) {
      // Si hay más de un equipo del mismo modelo exacto, desempatar por IP de red actual o por el más reciente
      if (clientIp) {
        const ipMatch = coreMatches.find((e) => e.lastIp === clientIp)
        if (ipMatch) {
          await attachBrowserTokenToEntry(map, ipMatch, fp, clientIp)
          return ipMatch
        }
      }
      const sorted = [...coreMatches].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      )
      await attachBrowserTokenToEntry(map, sorted[0], fp, clientIp)
      return sorted[0]
    }
  }

  return null
}

async function attachBrowserTokenToEntry(
  map: Map<string, DeviceBindingEntry>,
  entry: DeviceBindingEntry,
  fp: DeviceFingerprintPayload,
  clientIp?: string
): Promise<void> {
  let changed = false
  if (fp.deviceToken && !entry.deviceTokens.includes(fp.deviceToken)) {
    entry.deviceTokens = [...entry.deviceTokens.slice(-9), fp.deviceToken]
    changed = true
  }
  if (
    fp.extendedHardwareId &&
    !entry.extendedHardwareIds.includes(fp.extendedHardwareId)
  ) {
    entry.extendedHardwareIds = [
      ...entry.extendedHardwareIds.slice(-9),
      fp.extendedHardwareId,
    ]
    changed = true
  }
  if (fp.deviceModel && fp.deviceModel !== "GENERIC" && !entry.deviceModel) {
    entry.deviceModel = fp.deviceModel
    changed = true
  }
  if (clientIp && entry.lastIp !== clientIp) {
    entry.lastIp = clientIp
    changed = true
  }
  if (changed) {
    entry.updatedAt = new Date().toISOString()
    map.set(entry.dni, entry)
    await persistBindingsMap(map)
  }
}

export async function findBindingByDni(dni: string): Promise<DeviceBindingEntry | null> {
  const cleanDni = (dni || "").trim()
  if (!cleanDni) return null
  const map = await loadBindingsMap()
  return map.get(cleanDni) || null
}

/**
 * Verifica que:
 * 1) El celular/equipo actual NO esté vinculado al DNI de otra persona.
 * 2) El DNI ingresado NO esté vinculado al celular/equipo de otra persona.
 * Si todo es válido, registra/actualiza el vínculo exclusivo Celular <-> DNI.
 */
export async function verifyAndBindDeviceForUser(params: {
  dni: string
  userId: string
  userName: string
  role: string
  fingerprint: DeviceFingerprintPayload
  clientIp?: string
}): Promise<{
  allowed: boolean
  code?: "DEVICE_BOUND_TO_OTHER_DNI" | "DNI_BOUND_TO_OTHER_DEVICE"
  boundDni?: string
  boundUserName?: string
  message?: string
  entry?: DeviceBindingEntry
}> {
  const cleanDni = params.dni.trim()
  const fp = params.fingerprint

  if (!fp || (!fp.deviceToken && !fp.coreHardwareId)) {
    return { allowed: true }
  }

  const map = await loadBindingsMap()

  // 1. Verificar si este equipo físico ya está vinculado a OTRO DNI
  const existingForDevice = await findBindingForDevice(fp, params.clientIp)
  if (existingForDevice && existingForDevice.dni !== cleanDni) {
    return {
      allowed: false,
      code: "DEVICE_BOUND_TO_OTHER_DNI",
      boundDni: existingForDevice.dni,
      boundUserName: existingForDevice.userName,
      message: `🔒 Este equipo ya está registrado a nombre de ${existingForDevice.userName} (DNI: ${existingForDevice.dni}). No se permite colocar otro DNI ni marcar por otro compañero desde este dispositivo.`,
    }
  }

  // 2. Verificar si el DNI ingresado ya está vinculado a OTRO equipo distinto
  const existingForDni = map.get(cleanDni)
  if (existingForDni) {
    const sameDevice = isSamePhysicalDevice(existingForDni, fp, params.clientIp)
    if (!sameDevice) {
      return {
        allowed: false,
        code: "DNI_BOUND_TO_OTHER_DEVICE",
        boundDni: existingForDni.dni,
        boundUserName: existingForDni.userName,
        message: `🔒 El DNI ${cleanDni} (${params.userName}) ya se encuentra vinculado a su propio teléfono personal. No se permite compartir el DNI para marcar desde otro equipo.`,
      }
    }

    // Es el mismo equipo (ej. abrió el link desde otro navegador del mismo celular)
    await attachBrowserTokenToEntry(map, existingForDni, fp, params.clientIp)
    return {
      allowed: true,
      boundDni: existingForDni.dni,
      boundUserName: existingForDni.userName,
      entry: existingForDni,
    }
  }

  // 3. Crear nuevo vínculo exclusivo Celular/Equipo <-> DNI
  const nowIso = new Date().toISOString()
  const newEntry: DeviceBindingEntry = {
    dni: cleanDni,
    userId: params.userId,
    userName: params.userName,
    role: params.role,
    deviceTokens: fp.deviceToken ? [fp.deviceToken] : [],
    coreHardwareId: fp.coreHardwareId,
    extendedHardwareIds: fp.extendedHardwareId ? [fp.extendedHardwareId] : [],
    deviceModel: fp.deviceModel,
    screenProfile: fp.screenProfile,
    lastIp: params.clientIp,
    boundAt: nowIso,
    updatedAt: nowIso,
  }

  map.set(cleanDni, newEntry)
  await persistBindingsMap(map)

  return {
    allowed: true,
    boundDni: newEntry.dni,
    boundUserName: newEntry.userName,
    entry: newEntry,
  }
}

/**
 * Desvincula el celular de un usuario por su DNI (para uso del Administrador cuando un colaborador cambia de teléfono).
 */
export async function unbindDeviceForDni(dni: string): Promise<boolean> {
  const cleanDni = (dni || "").trim()
  if (!cleanDni) return false
  const map = await loadBindingsMap(true)
  const existed = map.delete(cleanDni)
  if (existed) {
    await persistBindingsMap(map)
  }
  return existed
}

/**
 * Libera cualquier vínculo personal asociado a una PC que acaba de ser autorizada como Estación Oficial (Kiosco).
 */
export async function unbindDeviceByFingerprint(
  fp?: DeviceFingerprintPayload | null
): Promise<void> {
  if (!fp) return
  const map = await loadBindingsMap(true)
  let changed = false
  for (const [dni, entry] of map.entries()) {
    if (isSamePhysicalDevice(entry, fp)) {
      map.delete(dni)
      changed = true
    }
  }
  if (changed) {
    await persistBindingsMap(map)
  }
}

export async function getAllDeviceBindings(): Promise<Record<string, DeviceBindingEntry>> {
  const map = await loadBindingsMap()
  const result: Record<string, DeviceBindingEntry> = {}
  for (const [dni, entry] of map.entries()) {
    result[dni] = entry
  }
  return result
}
