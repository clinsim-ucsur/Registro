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
 */
export function resolveGeoCampuses(campuses: GeoCampus[]): GeoCampus[] {
  const map = new Map<string, GeoCampus>()

  // Registrar primero las 4 sedes predeterminadas
  for (const [name, loc] of Object.entries(DEFAULT_CAMPUS_LOCATIONS)) {
    map.set(name.toLowerCase(), {
      name,
      geoEnforced: true,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radiusMeters: loc.radiusMeters,
    })
  }

  // Sobrescribir con configuraciones específicas de la base de datos si existen
  for (const c of campuses) {
    const key = c.name.toLowerCase()
    const fallback = map.get(key)
    map.set(key, {
      name: c.name,
      geoEnforced: c.geoEnforced ?? fallback?.geoEnforced ?? true,
      latitude: c.latitude ?? fallback?.latitude ?? null,
      longitude: c.longitude ?? fallback?.longitude ?? null,
      radiusMeters: c.radiusMeters ?? fallback?.radiusMeters ?? 500,
    })
  }

  return Array.from(map.values())
}

/**
 * Validación multisede y detección automática por GPS:
 * Evalúa las coordenadas actuales del colaborador contra todas las sedes autorizadas.
 * Permite marcar siempre que esté dentro del rango de CUALQUIERA de las 4 sedes
 * e identifica automáticamente en cuál de ellas se encuentra físicamente.
 */
export function detectAndValidateCampus(
  loc: { lat: number; lng: number; accuracy?: number } | undefined,
  campuses: GeoCampus[]
): GeoDetectionResult {
  const resolved = resolveGeoCampuses(campuses)
  const activeTargets = resolved.filter(isGeoActive)

  if (activeTargets.length === 0) {
    return {
      allowed: true,
      detectedCampusName: campuses[0]?.name || "Campus Villa",
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
    error: `Fuera de rango: No se encuentra dentro del perímetro de ninguna de las 4 sedes autorizadas (${campusNames}). Sede más cercana: ${closestCampus.name} a ${Math.round(minAnyDist)} m (radio permitido: ${closestCampus.radiusMeters} m).`,
  }
}

/**
 * Evalúa una ubicación con la lógica multisede.
 * Retorna null si está permitido (dentro de alguna sede), o un mensaje de error si está fuera de todas.
 */
export function checkGeofence(
  loc: { lat: number; lng: number; accuracy?: number } | undefined,
  campuses: GeoCampus[],
  _selectedCampusNameIgnored?: string
): string | null {
  const result = detectAndValidateCampus(loc, campuses)
  if (result.allowed) return null
  return result.error || "Ubicación fuera del perímetro permitido."
}
