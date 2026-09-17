import { haversineMeters as haversinePositional } from './geo.js'

/** Great-circle distance between two { latitude, longitude } points, in metres. */
export const haversineMeters = (a, b) => haversinePositional(a.latitude, a.longitude, b.latitude, b.longitude)

/** Length of an ordered { latitude, longitude } path, in metres. */
export function pathMeters(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i])
  return total
}
