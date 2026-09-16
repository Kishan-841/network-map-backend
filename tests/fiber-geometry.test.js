import { describe, it, expect } from 'vitest'
import { deriveSegments, carryForward, entityKey } from '../src/modules/fibers/fiber-geometry.js'

const P = (type, lat, extra = {}) => ({ type, latitude: lat, longitude: 73.8, ...extra })
const points = [
  P('POP', 18.500, { popId: 'pop1' }), P('WAYPOINT', 18.501), P('WAYPOINT', 18.502),
  P('CLOSURE', 18.503, { closureId: 'c1' }), P('WAYPOINT', 18.504), P('BUILDING', 18.505, { buildingId: 'b1' }),
]

describe('deriveSegments', () => {
  it('collapses waypoints into segments between typed points', () => {
    const segs = deriveSegments(points)
    expect(segs.map((s) => [s.fromIndex, s.toIndex])).toEqual([[0, 3], [3, 5]])
    expect(segs[0].fromKey).toBe('POP:pop1'); expect(segs[0].toKey).toBe('CLOSURE:c1')
    expect(segs[0].mapMeters).toBeGreaterThan(330); expect(segs[0].mapMeters).toBeLessThan(336)
  })
  it('returns no segments when fewer than two typed points', () => {
    expect(deriveSegments(points.filter((p) => p.type !== 'POP' && p.type !== 'CLOSURE'))).toEqual([])
  })
})
describe('carryForward', () => {
  it('keeps laid metres and cut flags for segments whose endpoints survive', () => {
    const old = [{ fromKey: 'POP:pop1', toKey: 'CLOSURE:c1', fiberLaidMeters: 400, isCut: true, cutAt: new Date(0), cutNote: 'jcb' }]
    const next = carryForward(old, deriveSegments(points))
    expect(next[0]).toMatchObject({ fiberLaidMeters: 400, isCut: true, cutNote: 'jcb' })
    expect(next[1].fiberLaidMeters).toBeUndefined()
  })
})
