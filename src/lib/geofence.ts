// Utilidades de geocerca. Las coordenadas y el radio se guardan por sede en la BD
// y se editan desde el módulo "Sedes & Cursos".

// Valores iniciales sugeridos para Campus Villa (verificar y ajustar desde el panel)
export const VILLA_DEFAULTS = { latitude: -12.1894, longitude: -76.9738, radiusMeters: 500 }

// Precisión máxima aceptada del GPS (m); lecturas muy imprecisas se rechazan
export const MAX_ACCURACY_METERS = 1000

export type GeoCampus = {
  name: string
  geoEnforced: boolean
  latitude: number | null
  longitude: number | null
  radiusMeters: number
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
 * Evalúa una ubicación contra las sedes con geocerca activa.
 * - Con sede elegida: debe estar dentro de esa sede.
 * - Sin sede: debe estar dentro de alguna sede con geocerca activa.
 * Devuelve null si está permitido o un mensaje de error.
 */
export function checkGeofence(
  loc: { lat: number; lng: number; accuracy?: number } | undefined,
  campuses: GeoCampus[],
  selectedCampusName?: string
): string | null {
  const selected = selectedCampusName
    ? campuses.find((c) => c.name.toLowerCase() === selectedCampusName.trim().toLowerCase())
    : undefined
  const targets = selected ? (isGeoActive(selected) ? [selected] : []) : campuses.filter(isGeoActive)
  if (targets.length === 0) return null // sin restricción

  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return "No se pudo verificar su ubicación. Active el GPS y permita el acceso."
  }
  if ((loc.accuracy ?? 0) > MAX_ACCURACY_METERS) {
    return "La precisión del GPS es insuficiente. Acérquese a una ventana o active la ubicación precisa."
  }

  let best = { name: "", dist: Infinity, radius: 0 }
  for (const c of targets) {
    const d = distanceMeters(loc.lat, loc.lng, c.latitude!, c.longitude!)
    if (d <= c.radiusMeters) return null
    if (d < best.dist) best = { name: c.name, dist: d, radius: c.radiusMeters }
  }
  return `Fuera de rango: debe estar en ${best.name} para marcar (a ${Math.round(best.dist)} m, máximo ${best.radius} m).`
}
