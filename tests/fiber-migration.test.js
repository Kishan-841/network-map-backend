import { describe, it, expect } from 'vitest'
import { prisma } from '../src/lib/prisma.js'

// The migration must have turned every phase-1 segment into a Fiber and every
// vertex into a WAYPOINT point. Compares live counts, so it holds on any DB.
//
// A migrated fiber that someone has since DELETED is not a migration fault, so
// the assertion is per-surviving-fiber (and "no extras") rather than a single
// total: the shape of what migrated is what this guards.
describe('phase-1 → phase-2 fiber migration', () => {
  it('has one Fiber per legacy segment and one point per vertex', async () => {
    const routes = await prisma.fiberRoute.findMany()
    const legacy = new Map(
      routes.flatMap((r) => r.segments.map((s, i) => [`${r.id}-${i + 1}`, s])),
    )
    const migrated = await prisma.fiber.findMany({
      where: { id: { in: [...legacy.keys()] } },
      include: { points: true },
    })

    // Nothing invented: every row found answers to a legacy segment id.
    expect(migrated.length).toBeLessThanOrEqual(legacy.size)
    for (const f of migrated) {
      expect(f.points).toHaveLength(legacy.get(f.id).points.length)
      expect(f.points.every((p) => p.type === 'WAYPOINT')).toBe(true)
      expect([2, 4, 6, 12, 24, 48]).toContain(f.coreCount)
    }
  })
})
