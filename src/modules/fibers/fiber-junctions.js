import { haversineMeters } from '../../lib/fiber-geo.js'

/**
 * Phase-1 routes were migrated one old segment per fiber, so six lines meeting
 * at one pole became six endpoints sitting on top of each other. This finds
 * those piles so an admin can merge each into one shared closure or POP.
 *
 * `candidates`: [{ pointId, fiberId, fiberName, latitude, longitude }] — every
 * fiber's first and last point that is still a WAYPOINT. n is hundreds at most,
 * so the O(n²) pairwise sweep is cheaper than any spatial index would be.
 *
 * Returns [{ centre: { latitude, longitude }, points: [{ pointId, fiberId, fiberName }] }]
 * for each group of ≥ 2 points spanning ≥ 2 distinct fibers, biggest first.
 */
export function findJunctions(candidates, radiusMeters) {
  const parent = candidates.map((_, i) => i)
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  // Proximity is not transitive, but "belongs to the same junction" is: a chain
  // of near-neighbours is one pole even when its two ends are further apart.
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (haversineMeters(candidates[i], candidates[j]) <= radiusMeters) union(i, j)
    }
  }

  const groups = new Map()
  candidates.forEach((c, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(c)
  })

  return [...groups.values()]
    // Two endpoints of one fiber that happen to sit close together are a
    // doubled-back route, not a junction — nothing to merge.
    .filter((members) => members.length >= 2 && new Set(members.map((m) => m.fiberId)).size >= 2)
    .map((members) => ({
      centre: {
        latitude: members.reduce((n, m) => n + m.latitude, 0) / members.length,
        longitude: members.reduce((n, m) => n + m.longitude, 0) / members.length,
      },
      points: members.map(({ pointId, fiberId, fiberName }) => ({ pointId, fiberId, fiberName })),
    }))
    .sort((a, b) => b.points.length - a.points.length)
}
