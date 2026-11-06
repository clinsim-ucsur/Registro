import prisma from "@/lib/prisma"
import { recordAuditLog } from "@/lib/audit-log"

export type KioskOneTimeCode = {
  code: string
  campusName: string
  createdAt: string
  createdBy: string
  createdByDni: string
  used: boolean
  usedAt: string | null
}

const KIOSK_CODES_KEY = "KIOSK_ONE_TIME_CODES"

async function readCodesStore(): Promise<KioskOneTimeCode[]> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: KIOSK_CODES_KEY },
    })
    if (!setting?.value) return []
    const parsed = JSON.parse(setting.value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeCodesStore(codes: KioskOneTimeCode[]): Promise<void> {
  const trimmed = codes.slice(0, 200)
  await prisma.systemSetting.upsert({
    where: { key: KIOSK_CODES_KEY },
    update: {
      value: JSON.stringify(trimmed),
      description: "Códigos de un solo uso para vincular Estaciones Fijas por sede",
    },
    create: {
      key: KIOSK_CODES_KEY,
      value: JSON.stringify(trimmed),
      description: "Códigos de un solo uso para vincular Estaciones Fijas por sede",
    },
  })
}

/**
 * Genera un código único de 6 dígitos de un solo uso preconfigurado con la Sede elegida.
 */
export async function createKioskOneTimeCode(params: {
  campusName: string
  actorName: string
  actorDni: string
  actorRole: string
}): Promise<KioskOneTimeCode> {
  const current = await readCodesStore()
  const existingSet = new Set(current.map((c) => c.code))

  let code = ""
  for (let i = 0; i < 20; i++) {
    const candidate = Math.floor(100000 + Math.random() * 900000).toString()
    if (!existingSet.has(candidate)) {
      code = candidate
      break
    }
  }
  if (!code) {
    code = Date.now().toString().slice(-6)
  }

  const newEntry: KioskOneTimeCode = {
    code,
    campusName: params.campusName,
    createdAt: new Date().toISOString(),
    createdBy: params.actorName,
    createdByDni: params.actorDni,
    used: false,
    usedAt: null,
  }

  await writeCodesStore([newEntry, ...current])

  await recordAuditLog({
    actorName: params.actorName,
    actorDni: params.actorDni,
    actorRole: params.actorRole,
    category: "KIOSK",
    action: "Generación de Código de 1 Solo Uso",
    target: params.campusName,
    details: `Se generó el código de vinculación de 1 uso [${code}] preconfigurado para ${params.campusName}.`,
  })

  return newEntry
}

/**
 * Valida y consume (quema) un código de un solo uso.
 * Una vez usado, queda invalidado permanentemente y retorna la sede con la que fue creado.
 */
export async function consumeKioskOneTimeCode(rawCode: string): Promise<{
  success: boolean
  campusName?: string
  message: string
}> {
  const cleanCode = (rawCode || "").replace(/\s|-/g, "").trim()
  if (!cleanCode) {
    return { success: false, message: "Ingrese el código de verificación." }
  }

  const current = await readCodesStore()
  const idx = current.findIndex((c) => c.code === cleanCode)

  if (idx === -1) {
    await recordAuditLog({
      actorName: "Equipo en Portal",
      actorDni: "—",
      actorRole: "TERMINAL",
      category: "KIOSK",
      action: "Intento Fallido con Código Inválido",
      target: cleanCode,
      details: `Se ingresó un código de vinculación inexistente (${cleanCode}).`,
    })
    return {
      success: false,
      message: "Código de verificación inválido o no registrado.",
    }
  }

  const entry = current[idx]

  if (entry.used) {
    await recordAuditLog({
      actorName: "Equipo en Portal",
      actorDni: "—",
      actorRole: "TERMINAL",
      category: "KIOSK",
      action: "Intento con Código Ya Utilizado",
      target: `${entry.campusName} (${cleanCode})`,
      details: `Se intentó reutilizar el código [${cleanCode}] que ya había sido consumido el ${entry.usedAt}.`,
    })
    return {
      success: false,
      message: "Este código ya fue utilizado anteriormente. Cada código es válido para un único uso.",
    }
  }

  // Marcar como usado inmediatamente (1 solo uso estricto)
  current[idx] = {
    ...entry,
    used: true,
    usedAt: new Date().toISOString(),
  }

  await writeCodesStore(current)

  await recordAuditLog({
    actorName: `Autorizado por código de ${entry.createdBy}`,
    actorDni: entry.createdByDni,
    actorRole: "ESTACION_FIJA",
    category: "KIOSK",
    action: "Vinculación de Estación Fija por Código de 1 Uso",
    target: entry.campusName,
    details: `El código [${cleanCode}] fue canjeado exitosamente. Equipo configurado como Estación Oficial en ${entry.campusName} y código invalidado para futuros usos.`,
  })

  return {
    success: true,
    campusName: entry.campusName,
    message: `🖥️ Código verificado. Equipo vinculado automáticamente como Estación Oficial en ${entry.campusName}.`,
  }
}

export async function getKioskOneTimeCodesList(): Promise<KioskOneTimeCode[]> {
  return readCodesStore()
}

export async function deleteKioskOneTimeCode(
  code: string,
  actor: { name: string; dni: string; role: string }
): Promise<{ success: boolean }> {
  const current = await readCodesStore()
  const target = current.find((c) => c.code === code)
  const filtered = current.filter((c) => c.code !== code)
  await writeCodesStore(filtered)

  if (target) {
    await recordAuditLog({
      actorName: actor.name,
      actorDni: actor.dni,
      actorRole: actor.role,
      category: "KIOSK",
      action: "Eliminación de Código de Estación Fija",
      target: `${target.campusName} (${code})`,
      details: `Se eliminó manualmente el código [${code}] de ${target.campusName}.`,
    })
  }
  return { success: true }
}

