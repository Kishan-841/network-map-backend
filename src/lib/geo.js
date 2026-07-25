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
  const lonDelta = radiusMeters / (METERS_PER_DEGREE_LAT * Math.cos(toRadians(latitude)))
  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLon: longitude - lonDelta,
    maxLon: longitude + lonDelta,
  }
}
