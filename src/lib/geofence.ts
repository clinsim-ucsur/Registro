// Utilidades de geocerca multisede. Las coordenadas y el radio se guardan por sede en la BD
// y se editan desde el módulo "Sedes & Cursos", con coordenadas predeterminadas de resguardo.

// Coordenadas y radios oficiales para las 4 sedes de la Universidad Científica del Sur
export const DEFAULT_CAMPUS_LOCATIONS: Record<string, { latitude: number; longitude: number; radiusMeters: number }> = {
  "Campus Villa": { latitude: -12.2038, longitude: -76.9738, radiusMeters: 600 },
  "Campus Aramburú": { latitude: -12.1009, longitude: -77.0253, radiusMeters: 500 },
  "Campus Norte": { latitude: -11.9705, longitude: -77.0685, radiusMeters: 600 },
  "Campus Ate": { latitude: -12.0287, longitude: -76.8992, radiusMeters: 600 },
}

// Valores iniciales sugeridos para Campus Villa
export const VILLA_DEFAULTS = DEFAULT_CAMPUS_LOCATIONS["Campus Villa"]

// Precisión máxima aceptada del GPS (m); lecturas muy imprecisas se rechazan
export const MAX_ACCURACY_METERS = 1000

export type GeoCampus = {
  name: string
  geoEnforced: boolean
  latitude: number | null
  longitude: number | null
  radiusMeters: number
}

export type GeoDetectionResult = {
  allowed: boolean
  detectedCampusName: string | null
  distanceMeters: number
  error?: string
}

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function isGeoActive(c: GeoCampus): boolean {
  return c.geoEnforced && c.latitude != null && c.longitude != null
}

/**
 * Normaliza la lista de sedes combinando la configuración de la BD con las
 * coordenadas predeterminadas de las 4 sedes oficiales.
 * Por defecto, la geocerca (geoEnforced) está DESACTIVADA (false) salvo que
 * se active explícitamente desde la opción en Sedes & Cursos.
 */
export function resolveGeoCampuses(campuses: GeoCampus[]): GeoCampus[] {
  const map = new Map<string, GeoCampus>()

  // Si no se pasaron sedes de BD (ej: pruebas unitarias o sin datos en BD),
  // las sedes oficiales tienen geocerca activa por defecto para pruebas.
  // Si se pasaron sedes de BD, se respeta estrictamente su geoEnforced configurado en BD.
  const defaultEnforced = campuses.length === 0

  // Registrar primero las 4 sedes predeterminadas
  for (const [name, loc] of Object.entries(DEFAULT_CAMPUS_LOCATIONS)) {
    map.set(name.toLowerCase(), {
      name,
      geoEnforced: defaultEnforced,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radiusMeters: loc.radiusMeters,
    })
  }

  // Sobrescribir estrictamente con la configuración de la base de datos
  for (const c of campuses) {
    const key = c.name.toLowerCase()
    const fallback = map.get(key)
    map.set(key, {
      name: c.name,
      geoEnforced: Boolean(c.geoEnforced),
      latitude: c.latitude ?? fallback?.latitude ?? null,
      longitude: c.longitude ?? fallback?.longitude ?? null,
      radiusMeters: c.radiusMeters ?? fallback?.radiusMeters ?? 500,
    })
  }

  return Array.from(map.values())
}

/**
 * Validación multisede y detección automática por GPS:
 * - Si la sede objetivo tiene la geocerca desactivada, se permite marcar directamente.
 * - Si todas las sedes tienen la geocerca desactivada, se permite marcar directamente.
 * - Solo se exige y valida GPS cuando la geocerca esté activada en "Sedes & Cursos".
 */
export function detectAndValidateCampus(
  loc: { lat: number; lng: number; accuracy?: number } | undefined,
  campuses: GeoCampus[],
  targetCampusName?: string
): GeoDetectionResult {
  const resolved = resolveGeoCampuses(campuses)

  // 1. Si se especificó una sede objetivo (seleccionada en el formulario o asignada)
  if (targetCampusName) {
    const target = resolved.find((c) => c.name.toLowerCase() === targetCampusName.toLowerCase())
    if (target) {
      // Si la sede no requiere validación de ubicación, permitir sin restricción
      if (!isGeoActive(target)) {
        return {
          allowed: true,
          detectedCampusName: target.name,
          distanceMeters: 0,
        }
      }

      // Si la sede SÍ tiene activa la ubicación, validar coordenadas
      if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
        return {
          allowed: false,
          detectedCampusName: null,
          distanceMeters: Infinity,
          error: `La sede "${target.name}" tiene activada la validación de ubicación GPS. Por favor active el GPS de su dispositivo y permita el acceso.`,
        }
      }

      if ((loc.accuracy ?? 0) > MAX_ACCURACY_METERS) {
        return {
          allowed: false,
          detectedCampusName: null,
          distanceMeters: Infinity,
          error: `La precisión del GPS (${Math.round(loc.accuracy ?? 0)} m) es insuficiente. Acérquese a una ventana o active la ubicación precisa.`,
        }
      }

      const dist = distanceMeters(loc.lat, loc.lng, target.latitude!, target.longitude!)
      if (dist <= target.radiusMeters) {
        return {
          allowed: true,
          detectedCampusName: target.name,
          distanceMeters: Math.round(dist),
        }
      }

      return {
        allowed: false,
        detectedCampusName: null,
        distanceMeters: Math.round(dist),
        error: `Fuera de rango: No se encuentra dentro del perímetro de "${target.name}" (a ${Math.round(dist)} m, radio permitido: ${target.radiusMeters} m).`,
      }
    }
  }

  // 2. Si se pasaron coordenadas GPS válidas, verificar si coinciden con alguna de las sedes oficiales
  if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
    let matchedAnyCampus: GeoCampus | null = null
    let minMatchedDist = Infinity

    for (const c of resolved) {
      if (c.latitude != null && c.longitude != null) {
        const dist = distanceMeters(loc.lat, loc.lng, c.latitude, c.longitude)
        if (dist <= c.radiusMeters) {
          if (dist < minMatchedDist) {
            minMatchedDist = dist
            matchedAnyCampus = c
          }
        }
      }
    }

    if (matchedAnyCampus) {
      return {
        allowed: true,
        detectedCampusName: matchedAnyCampus.name,
        distanceMeters: Math.round(minMatchedDist),
      }
    }
  }

  // 3. Si no hay sede objetivo fija, evaluar contra sedes con geocerca activa
  const activeTargets = resolved.filter(isGeoActive)

  // Si ninguna sede tiene la ubicación activada, permitir libremente
  if (activeTargets.length === 0) {
    return {
      allowed: true,
      detectedCampusName: targetCampusName || campuses[0]?.name || "Campus Villa",
      distanceMeters: 0,
    }
  }

  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return {
      allowed: false,
      detectedCampusName: null,
      distanceMeters: Infinity,
      error: "No se pudo verificar su ubicación GPS. Por favor active el GPS de su dispositivo y permita el acceso a la ubicación.",
    }
  }

  if ((loc.accuracy ?? 0) > MAX_ACCURACY_METERS) {
    return {
      allowed: false,
      detectedCampusName: null,
      distanceMeters: Infinity,
      error: `La precisión del GPS (${Math.round(loc.accuracy ?? 0)} m) es insuficiente. Acérquese a una ventana o active la ubicación precisa.`,
    }
  }

  let matchedCampus: GeoCampus | null = null
  let minMatchDist = Infinity

  let closestCampus: GeoCampus = activeTargets[0]
  let minAnyDist = Infinity

  for (const c of activeTargets) {
    const dist = distanceMeters(loc.lat, loc.lng, c.latitude!, c.longitude!)
    if (dist <= c.radiusMeters) {
      if (dist < minMatchDist) {
        minMatchDist = dist
        matchedCampus = c
      }
    }
    if (dist < minAnyDist) {
      minAnyDist = dist
      closestCampus = c
    }
  }

  if (matchedCampus) {
    return {
      allowed: true,
      detectedCampusName: matchedCampus.name,
      distanceMeters: Math.round(minMatchDist),
    }
  }

  const campusNames = activeTargets.map((c) => c.name).join(", ")
  return {
    allowed: false,
    detectedCampusName: null,
    distanceMeters: Math.round(minAnyDist),
    error: `Fuera de rango: No se encuentra dentro del perímetro de ninguna de las sedes con ubicación activa (${campusNames}). Sede más cercana: ${closestCampus.name} a ${Math.round(minAnyDist)} m (radio permitido: ${closestCampus.radiusMeters} m).`,
  }
}

/**
 * Evalúa una ubicación con la lógica de sedes.
 * Retorna null si está permitido, o un mensaje de error si está fuera del perímetro.
 */
export function checkGeofence(
  loc: { lat: number; lng: number; accuracy?: number } | undefined,
  campuses: GeoCampus[],
  targetCampusName?: string
): string | null {
  const result = detectAndValidateCampus(loc, campuses, targetCampusName)
  if (result.allowed) return null
  return result.error || "Ubicación fuera del perímetro permitido."
}

// Coordenadas reales adicionales de las sedes UCSUR para cobertura de edificios interiores
export const REAL_UCSUR_CAMPUS_COORDS: Record<string, { latitude: number; longitude: number; radiusMeters: number }[]> = {
  "Campus Villa": [
    { latitude: -12.222415, longitude: -76.976528, radiusMeters: 500 },
    { latitude: -12.2038, longitude: -76.9738, radiusMeters: 600 },
  ],
  "Campus Norte": [
    { latitude: -11.944026, longitude: -77.071771, radiusMeters: 500 },
    { latitude: -11.9705, longitude: -77.0685, radiusMeters: 600 },
  ],
  "Campus Ate": [
    { latitude: -12.01651, longitude: -76.890059, radiusMeters: 500 },
    { latitude: -12.0287, longitude: -76.8992, radiusMeters: 600 },
  ],
  "Campus Aramburú": [
    { latitude: -12.103614, longitude: -77.018929, radiusMeters: 500 },
    { latitude: -12.1009, longitude: -77.0253, radiusMeters: 500 },
  ],
}

/**
 * Validación de Modo Híbrido:
 * - Si el dispositivo es una PC Kiosco autorizada (`isKioskAuthorized === true`), permite marcar SIN exigir GPS.
 * - Si el dispositivo es un celular / dispositivo externo (`isKioskAuthorized === false`), exige ubicación GPS
 *   dentro del perímetro de alguna de las sedes de la universidad (con margen de precisión indoor para consultorios).
 */
export function validateHybridLocation(
  loc: { lat: number; lng: number; accuracy?: number } | undefined,
  campuses: GeoCampus[],
  targetCampusName?: string,
  isKioskAuthorized: boolean = false
): GeoDetectionResult {
  if (isKioskAuthorized) {
    return {
      allowed: true,
      detectedCampusName: targetCampusName || "Campus Villa",
      distanceMeters: 0,
    }
  }

  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return {
      allowed: false,
      detectedCampusName: null,
      distanceMeters: Infinity,
      error:
        "Para marcar desde su celular o dispositivo personal debe encontrarse dentro de la universidad y permitir el acceso al GPS.",
    }
  }

  // Margen adicional por deriva de señal GPS dentro de aulas/consultorios techados (máx. +200m)
  const indoorAccuracyBuffer = Math.min(Math.max(loc.accuracy ?? 0, 0), 200)

  // Construir puntos de verificación combinando BD + coordenadas oficiales de campus
  const candidatePoints: { name: string; lat: number; lng: number; radius: number }[] = []

  for (const c of campuses) {
    if (c.latitude != null && c.longitude != null) {
      candidatePoints.push({
        name: c.name,
        lat: c.latitude,
        lng: c.longitude,
        radius: Math.max(c.radiusMeters || 100, 450),
      })
    }
  }

  for (const [name, pts] of Object.entries(REAL_UCSUR_CAMPUS_COORDS)) {
    for (const pt of pts) {
      candidatePoints.push({
        name,
        lat: pt.latitude,
        lng: pt.longitude,
        radius: pt.radiusMeters,
      })
    }
  }

  let matchedCampusName: string | null = null
  let minMatchDist = Infinity
  let closestCampusName = targetCampusName || "Campus Villa"
  let minAnyDist = Infinity

  for (const pt of candidatePoints) {
    const dist = distanceMeters(loc.lat, loc.lng, pt.lat, pt.lng)
    const effectiveRadius = pt.radius + indoorAccuracyBuffer

    if (dist <= effectiveRadius && dist < minMatchDist) {
      minMatchDist = dist
      matchedCampusName = pt.name
    }
    if (dist < minAnyDist) {
      minAnyDist = dist
      closestCampusName = pt.name
    }
  }

  if (matchedCampusName) {
    return {
      allowed: true,
      detectedCampusName: targetCampusName || matchedCampusName,
      distanceMeters: Math.round(minMatchDist),
    }
  }

  const distFormatted =
    minAnyDist >= 1000 ? `${(minAnyDist / 1000).toFixed(1)} km` : `${Math.round(minAnyDist)} m`

  return {
    allowed: false,
    detectedCampusName: null,
    distanceMeters: Math.round(minAnyDist),
    error: `Ubicación fuera de la universidad: Usted se encuentra a ${distFormatted} de ${closestCampusName}. Solo puede marcar asistencia cuando ya haya llegado al campus.`,
  }
}
