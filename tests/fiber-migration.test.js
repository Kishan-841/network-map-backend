import { describe, it, expect } from 'vitest'
import { prisma } from '../src/lib/prisma.js'

// The migration must have turned every phase-1 segment into a Fiber and every
// vertex into a WAYPOINT point. Compares live counts, so it holds on any DB.
describe('phase-1 → phase-2 fiber migration', () => {
  it('has one Fiber per legacy segment and one point per vertex', async () => {
    const routes = await prisma.fiberRoute.findMany()
    const expectedFibers = routes.reduce((n, r) => n + r.segments.length, 0)
    const expectedPoints = routes.reduce(
      (n, r) => n + r.segments.reduce((m, s) => m + s.points.length, 0), 0)
    const migrated = await prisma.fiber.findMany({
      where: { id: { in: routes.flatMap((r) => r.segments.map((_, i) => `${r.id}-${i + 1}`)) } },
      include: { points: true },
    })
    expect(migrated).toHaveLength(expectedFibers)
    expect(migrated.reduce((n, f) => n + f.points.length, 0)).toBe(expectedPoints)
    for (const f of migrated) {
      expect(f.points.every((p) => p.type === 'WAYPOINT')).toBe(true)
      expect([2, 4, 6, 12, 24, 48]).toContain(f.coreCount)
    }
  })
})
