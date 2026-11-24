import { z } from 'zod'
import { prisma } from '../../lib/prisma.js'
import { pointToPolylineMeters } from '../../lib/fiber-geo.js'
import { zoneScope } from '../../lib/visibility.js'

/**
 * Fibres for a splitter's "Input fiber" (spec 2026-11-24-splitter-in-building):
 * those whose line passes within `radius` m of a pin (nearest first), or — with
 * `q` — those whose route name matches, wherever they are. Only fibres the
 * reader may see (zoneScope). `distanceM` is from the pin, when one is given.
 */
const num = (min, max) => z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().min(min).max(max).optional())

export const nearbyQuerySchema = z
  .object({
    lat: num(-90, 90),
    lng: num(-180, 180),
    q: z.string().trim().max(100).optional(),
    radius: num(10, 200),
  })
  .refine((v) => (v.lat == null) === (v.lng == null), 'Give both lat and lng')
  .refine((v) => v.lat != null || (v.q ?? '').length >= 2, 'Give a pin or at least two letters')

// ~2 km around the pin: a fibre is a candidate when one of its points is inside;
// the exact distance to its segments then decides. Runs longer than 2 km with no
// point in between are not real plant here.
const BOX_DEG = 0.02
const NAME_MATCHES = 15
const CANDIDATES = 500

export async function findFibersNear({ lat, lng, q, radius = 100 }, actor, db = prisma) {
  const pin = lat != null ? { latitude: lat, longitude: lng } : null
  const select = {
    id: true, name: true, status: true,
    ...(pin ? { points: { select: { latitude: true, longitude: true }, orderBy: { sequence: 'asc' } } } : {}),
  }
  const distance = (f) => (pin ? Math.round(pointToPolylineMeters(pin, f.points)) : null)
  const out = (f) => ({ id: f.id, name: f.name, status: f.status, distanceM: distance(f) })

  if (q && q.length >= 2) {
    const rows = await db.fiber.findMany({
      where: { AND: [zoneScope(actor), { name: { contains: q, mode: 'insensitive' } }] },
      select, orderBy: { name: 'asc' }, take: NAME_MATCHES,
    })
    const list = rows.map(out)
    return pin ? list.sort((a, b) => a.distanceM - b.distanceM) : list
  }

  const box = {
    latitude: { gte: lat - BOX_DEG, lte: lat + BOX_DEG },
    longitude: { gte: lng - BOX_DEG, lte: lng + BOX_DEG },
  }
  const rows = await db.fiber.findMany({
    where: { AND: [zoneScope(actor), { points: { some: box } }] },
    select, take: CANDIDATES,
  })
  return rows.map(out).filter((f) => f.distanceM <= radius).sort((a, b) => a.distanceM - b.distanceM)
}
