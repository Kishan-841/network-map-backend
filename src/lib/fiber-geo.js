import { haversineMeters as haversinePositional } from './geo.js'

/** Great-circle distance between two { latitude, longitude } points, in metres. */
export const haversineMeters = (a, b) => haversinePositional(a.latitude, a.longitude, b.latitude, b.longitude)

/** Length of an ordered { latitude, longitude } path, in metres. */
export function pathMeters(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i])
  return total
}

const M_PER_DEG_LAT = 111_320

/**
 * Shortest distance in metres from `p` to a line through `points` (in order) —
 * to the nearest point on any segment, not just the nearest vertex, so a long
 * straight run passing close by counts. Flat-earth projection around `p`:
 * exact enough at the 100 m scale "fibres near a splitter" needs.
 */
export function pointToPolylineMeters(p, points) {
  if (!points?.length) return Infinity
  const kx = M_PER_DEG_LAT * Math.cos((p.latitude * Math.PI) / 180)
  const xy = (q) => [(q.longitude - p.longitude) * kx, (q.latitude - p.latitude) * M_PER_DEG_LAT]
  let best = Infinity
  let [ax, ay] = xy(points[0])
  if (points.length === 1) return Math.hypot(ax, ay)
  for (let i = 1; i < points.length; i += 1) {
    const [bx, by] = xy(points[i])
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
    ;[ax, ay] = [bx, by]
  }
  return best
}
