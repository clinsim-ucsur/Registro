// Geocerca de la Universidad Científica del Sur - Sede Villa.
// Configurable por variables de entorno (NEXT_PUBLIC_*) para ajustar sin tocar código.
const num = (v: string | undefined, fallback: number) => {
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

export const GEOFENCE = {
  enabled: process.env.NEXT_PUBLIC_GEOFENCE_ENABLED !== "false",
  name: "Universidad Científica del Sur - Sede Villa",
  latitude: num(process.env.NEXT_PUBLIC_GEOFENCE_LAT, -12.1894),
  longitude: num(process.env.NEXT_PUBLIC_GEOFENCE_LNG, -76.9738),
  radiusMeters: num(process.env.NEXT_PUBLIC_GEOFENCE_RADIUS, 500),
  // Precisión máxima aceptada del GPS (m); lecturas muy imprecisas se rechazan
  maxAccuracyMeters: 1000,
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

export function distanceToCampus(lat: number, lng: number): number {
  return distanceMeters(lat, lng, GEOFENCE.latitude, GEOFENCE.longitude)
}

export function isInsideGeofence(lat: number, lng: number, accuracy = 0): boolean {
  if (accuracy > GEOFENCE.maxAccuracyMeters) return false
  return distanceToCampus(lat, lng) <= GEOFENCE.radiusMeters
}
