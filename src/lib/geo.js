const EARTH_RADIUS_METERS = 6371000
const METERS_PER_DEGREE_LAT = 111320

const toRadians = (degrees) => (degrees * Math.PI) / 180

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a))
}

export function boundingBox(latitude, longitude, radiusMeters) {
  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT
  // Clamp cos(lat) away from 0 so the longitude delta can't explode to a
  // whole-planet span near the poles (which would match every row).
  const cosLat = Math.max(Math.cos(toRadians(latitude)), 0.01)
  const lonDelta = Math.min(radiusMeters / (METERS_PER_DEGREE_LAT * cosLat), 180)
  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLon: longitude - lonDelta,
    maxLon: longitude + lonDelta,
  }
}
