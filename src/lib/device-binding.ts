import prisma from "@/lib/prisma"

export const DEVICE_BINDINGS_SETTING_KEY = "MOBILE_DEVICE_DNI_BINDINGS_V1"
const DNI_KEY_PREFIX = "DEVBIND_DNI:"
const TOK_KEY_PREFIX = "DEVBIND_TOK:"

export interface DeviceFingerprintPayload {
  deviceToken: string
  coreHardwareId: string
  extendedHardwareId?: string
  deviceModel?: string
  screenProfile?: string
  userAgent?: string
  isStandalonePwa?: boolean
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
let cachedDniByToken: Map<string, string> | null = null
let cacheLoadedAt = 0
const CACHE_TTL_MS = 4_000 // 4 segundos para mantener sincronizadas todas las instancias serverless en Vercel

function isDesktopScreenProfile(screenProfile?: string): boolean {
  if (!screenProfile) return false
  return screenProfile.startsWith("WINDOWS|") || screenProfile.startsWith("MAC|")
}

function isMobileScreenProfile(screenProfile?: string): boolean {
  if (!screenProfile) return false
  return screenProfile.startsWith("ANDROID|") || screenProfile.startsWith("IOS|")
}

async function loadBindingsCache(forceReload = false): Promise<{
  byDni: Map<string, DeviceBindingEntry>
  byToken: Map<string, string>
}> {
  const now = Date.now()
  if (
    !forceReload &&
    cachedBindingsByDni &&
    cachedDniByToken &&
    now - cacheLoadedAt < CACHE_TTL_MS
  ) {
    return { byDni: cachedBindingsByDni, byToken: cachedDniByToken }
  }

  const byDni = new Map<string, DeviceBindingEntry>()
  const byToken = new Map<string, string>()

  try {
    const rows = await prisma.systemSetting.findMany({
      where: {
        OR: [
          { key: { startsWith: DNI_KEY_PREFIX } },
          { key: { startsWith: TOK_KEY_PREFIX } },
          { key: DEVICE_BINDINGS_SETTING_KEY },
        ],
      },
    })

    let legacyRowValue: string | null = null

    for (const row of rows) {
      if (row.key === DEVICE_BINDINGS_SETTING_KEY) {
        legacyRowValue = row.value
        continue
      }
      if (row.key.startsWith(DNI_KEY_PREFIX)) {
        try {
          const entry = JSON.parse(row.value) as DeviceBindingEntry
          if (entry && entry.dni) {
            const tokens = Array.isArray(entry.deviceTokens)
              ? entry.deviceTokens.filter(Boolean)
              : []
            const normalized: DeviceBindingEntry = {
              ...entry,
              deviceTokens: tokens,
              extendedHardwareIds: Array.isArray(entry.extendedHardwareIds)
                ? entry.extendedHardwareIds
                : [],
            }
            byDni.set(entry.dni, normalized)
            for (const t of tokens) {
              byToken.set(t, entry.dni)
            }
          }
        } catch {}
      } else if (row.key.startsWith(TOK_KEY_PREFIX)) {
        const token = row.key.slice(TOK_KEY_PREFIX.length)
        const dni = (row.value || "").trim()
        if (token && dni) {
          byToken.set(token, dni)
        }
      }
    }

    // Si existía el registro antiguo monolítico, migrar entradas faltantes a filas atómicas
    if (legacyRowValue) {
      try {
        const parsed = JSON.parse(legacyRowValue)
        if (parsed && typeof parsed === "object") {
          for (const [dni, rawEntry] of Object.entries(parsed)) {
            const entry = rawEntry as DeviceBindingEntry
            if (entry && entry.dni && !byDni.has(dni)) {
              const tokens = Array.isArray(entry.deviceTokens)
                ? entry.deviceTokens.filter(Boolean)
                : []
              if (tokens.length > 0) {
                const normalized: DeviceBindingEntry = {
                  ...entry,
                  deviceTokens: tokens,
                  extendedHardwareIds: Array.isArray(entry.extendedHardwareIds)
                    ? entry.extendedHardwareIds
                    : [],
                }
                byDni.set(dni, normalized)
                for (const t of tokens) {
                  byToken.set(t, dni)
                }
                await saveAtomicBindingEntry(normalized)
              }
            }
          }
        }
        await prisma.systemSetting
          .delete({ where: { key: DEVICE_BINDINGS_SETTING_KEY } })
          .catch(() => {})
      } catch {}
    }

    cachedBindingsByDni = byDni
    cachedDniByToken = byToken
    cacheLoadedAt = Date.now()
    return { byDni, byToken }
  } catch (err) {
    console.warn("[device-binding] Error cargando vínculos de equipos:", err)
    return {
      byDni: cachedBindingsByDni || byDni,
      byToken: cachedDniByToken || byToken,
    }
  }
}

async function saveAtomicBindingEntry(entry: DeviceBindingEntry): Promise<void> {
  const dniKey = `${DNI_KEY_PREFIX}${entry.dni}`
  const valueJson = JSON.stringify(entry)

  const ops: Promise<any>[] = [
    prisma.systemSetting.upsert({
      where: { key: dniKey },
      update: {
        value: valueJson,
        description: `Vínculo exclusivo de celular para ${entry.userName} (${entry.dni})`,
      },
      create: {
        key: dniKey,
        value: valueJson,
        description: `Vínculo exclusivo de celular para ${entry.userName} (${entry.dni})`,
      },
    }),
  ]

  for (const token of entry.deviceTokens) {
    if (!token) continue
    const tokKey = `${TOK_KEY_PREFIX}${token}`
    ops.push(
      prisma.systemSetting.upsert({
        where: { key: tokKey },
        update: {
          value: entry.dni,
          description: `Token de dispositivo vinculado al DNI ${entry.dni}`,
        },
        create: {
          key: tokKey,
          value: entry.dni,
          description: `Token de dispositivo vinculado al DNI ${entry.dni}`,
        },
      })
    )
  }

  await Promise.all(ops)

  if (cachedBindingsByDni) {
    cachedBindingsByDni.set(entry.dni, entry)
  }
  if (cachedDniByToken) {
    for (const token of entry.deviceTokens) {
      cachedDniByToken.set(token, entry.dni)
    }
  }
}

/**
 * Verifica si el dispositivo actual corresponde al mismo equipo vinculado al usuario.
 *
 * IMPORTANTE (Corrección crítica para iPhone y Android de modelos similares):
 * - NUNCA se considera "el mismo equipo" solo porque coincidan `coreHardwareId` o `extendedHardwareId`,
 *   ya que todos los iPhone del mismo tamaño (ej. iPhone 12/13/14 = 390x844@3 | Apple GPU)
 *   y los Android del mismo modelo/pantalla reportan exactamente el mismo `coreHardwareId` y `extendedHardwareId`.
 * - La identidad del equipo se valida estrictamente mediante su `deviceToken` criptográfico único (UUID).
 */
export function isSamePhysicalDevice(
  entry: DeviceBindingEntry,
  fp: DeviceFingerprintPayload
): boolean {
  if (!fp || !fp.deviceToken) return false
  return entry.deviceTokens.includes(fp.deviceToken)
}

/**
 * Busca si este navegador/aplicativo específico ya tiene un DNI vinculado.
 * Solo busca por `deviceToken` único para garantizar CERO cruces entre teléfonos distintos
 * (incluso si son dos iPhone idénticos o dos Android del mismo modelo en la misma red Wi-Fi).
 */
export async function findBindingForDevice(
  fp: DeviceFingerprintPayload,
  _clientIp?: string
): Promise<DeviceBindingEntry | null> {
  const token = fp?.deviceToken?.trim()
  if (!token) return null

  const { byDni, byToken } = await loadBindingsCache()

  const matchedDni = byToken.get(token)
  if (matchedDni) {
    const entry = byDni.get(matchedDni)
    if (entry) return entry
  }

  // Búsqueda directa en BD en caso de que otra instancia serverless acabe de registrar el token
  try {
    const tokRow = await prisma.systemSetting.findUnique({
      where: { key: `${TOK_KEY_PREFIX}${token}` },
    })
    if (tokRow?.value) {
      const dni = tokRow.value.trim()
      const dniRow = await prisma.systemSetting.findUnique({
        where: { key: `${DNI_KEY_PREFIX}${dni}` },
      })
      if (dniRow?.value) {
        const entry = JSON.parse(dniRow.value) as DeviceBindingEntry
        byDni.set(dni, entry)
        byToken.set(token, dni)
        return entry
      }
    }
  } catch {}

  for (const entry of byDni.values()) {
    if (entry.deviceTokens.includes(token)) {
      byToken.set(token, entry.dni)
      return entry
    }
  }

  return null
}

export async function findBindingByDni(dni: string): Promise<DeviceBindingEntry | null> {
  const cleanDni = (dni || "").trim()
  if (!cleanDni) return null
  const { byDni } = await loadBindingsCache()
  const cached = byDni.get(cleanDni)
  if (cached) return cached

  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: `${DNI_KEY_PREFIX}${cleanDni}` },
    })
    if (row?.value) {
      const entry = JSON.parse(row.value) as DeviceBindingEntry
      byDni.set(cleanDni, entry)
      return entry
    }
  } catch {}
  return null
}

/**
 * Verifica que:
 * 1) Este dispositivo (`deviceToken`) NO esté vinculado al DNI de otra persona.
 * 2) El DNI ingresado NO esté vinculado al teléfono (`deviceToken`) de otra persona.
 * Si todo es válido, registra el vínculo exclusivo `deviceToken <-> DNI`.
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

  if (!fp || !fp.deviceToken) {
    return { allowed: true }
  }

  // 1. Verificar si este dispositivo (`deviceToken`) ya está vinculado a OTRO DNI
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

  // 2. Verificar si el DNI ingresado ya está vinculado a otro dispositivo
  const existingForDni = await findBindingByDni(cleanDni)
  if (existingForDni) {
    if (isSamePhysicalDevice(existingForDni, fp)) {
      // Es exactamente el mismo dispositivo (`deviceToken`)
      return {
        allowed: true,
        boundDni: existingForDni.dni,
        boundUserName: existingForDni.userName,
        entry: existingForDni,
      }
    }

    // Caso A: Si el vínculo previo se hizo accidentalmente desde una PC Windows/Mac de escritorio
    // y ahora el colaborador ingresa desde su teléfono celular real (Android/iPhone),
    // transferir automáticamente el vínculo a su celular real.
    if (
      isDesktopScreenProfile(existingForDni.screenProfile) &&
      isMobileScreenProfile(fp.screenProfile)
    ) {
      await unbindDeviceForDni(cleanDni)
    } else if (
      // Caso B: En iPhone (iOS), cuando el colaborador abre primero el link en Safari (1 token)
      // y luego instala la app en su pantalla de inicio ("Agregar a inicio", display-mode: standalone),
      // iOS crea un contenedor separado para el ícono instalado. Si aún solo tenía 1 token (el de Safari)
      // y ahora ingresa su propio DNI desde el aplicativo instalado (`isStandalonePwa: true`) con la misma pantalla,
      // autorizar la vinculación de su aplicativo instalado.
      fp.isStandalonePwa === true &&
      existingForDni.deviceTokens.length === 1 &&
      existingForDni.screenProfile &&
      fp.screenProfile === existingForDni.screenProfile
    ) {
      const updatedEntry: DeviceBindingEntry = {
        ...existingForDni,
        deviceTokens: [...existingForDni.deviceTokens, fp.deviceToken],
        updatedAt: new Date().toISOString(),
      }
      await saveAtomicBindingEntry(updatedEntry)
      return {
        allowed: true,
        boundDni: updatedEntry.dni,
        boundUserName: updatedEntry.userName,
        entry: updatedEntry,
      }
    } else {
      return {
        allowed: false,
        code: "DNI_BOUND_TO_OTHER_DEVICE",
        boundDni: existingForDni.dni,
        boundUserName: existingForDni.userName,
        message: `🔒 El DNI ${cleanDni} (${params.userName}) ya se encuentra vinculado a su teléfono personal registrado. No se permite compartir el DNI ni marcar desde otro dispositivo.`,
      }
    }
  }

  // 3. Si la petición viene de una PC Windows/Mac (no celular Android/iOS), permitir validar sin bloquear el celular del trabajador
  if (isDesktopScreenProfile(fp.screenProfile)) {
    return {
      allowed: true,
      boundDni: cleanDni,
      boundUserName: params.userName,
    }
  }

  // 4. Crear nuevo vínculo exclusivo Celular (`deviceToken`) <-> DNI
  const nowIso = new Date().toISOString()
  const newEntry: DeviceBindingEntry = {
    dni: cleanDni,
    userId: params.userId,
    userName: params.userName,
    role: params.role,
    deviceTokens: [fp.deviceToken],
    coreHardwareId: fp.coreHardwareId || "chw_v2",
    extendedHardwareIds: fp.extendedHardwareId ? [fp.extendedHardwareId] : [],
    deviceModel: fp.deviceModel,
    screenProfile: fp.screenProfile,
    lastIp: params.clientIp,
    boundAt: nowIso,
    updatedAt: nowIso,
  }

  await saveAtomicBindingEntry(newEntry)

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

  const existing = await findBindingByDni(cleanDni)
  const keysToDelete: string[] = [`${DNI_KEY_PREFIX}${cleanDni}`]
  if (existing && Array.isArray(existing.deviceTokens)) {
    for (const tok of existing.deviceTokens) {
      keysToDelete.push(`${TOK_KEY_PREFIX}${tok}`)
      cachedDniByToken?.delete(tok)
    }
  }
  cachedBindingsByDni?.delete(cleanDni)

  try {
    const res = await prisma.systemSetting.deleteMany({
      where: { key: { in: keysToDelete } },
    })
    return res.count > 0
  } catch (err) {
    console.warn("[unbindDeviceForDni] Error:", err)
    return false
  }
}

/**
 * Libera cualquier vínculo personal asociado a una PC que acaba de ser autorizada como Estación Oficial (Kiosco).
 */
export async function unbindDeviceByFingerprint(
  fp?: DeviceFingerprintPayload | null
): Promise<void> {
  if (!fp || !fp.deviceToken) return
  const existing = await findBindingForDevice(fp)
  if (existing) {
    await unbindDeviceForDni(existing.dni)
  }
}

export async function getAllDeviceBindings(): Promise<Record<string, DeviceBindingEntry>> {
  const { byDni } = await loadBindingsCache(true)
  const result: Record<string, DeviceBindingEntry> = {}
  for (const [dni, entry] of byDni.entries()) {
    result[dni] = entry
  }
  return result
}
