import { describe, it, expect } from 'vitest'
import { listFiber, shapeFiber } from '../src/modules/fibers/fiber.service.js'

/**
 * The fiber LIST is slimmed (13 Oct): it is every fiber with every point,
 * refetched after each save, and most of it was never read by a list consumer.
 * These pin what it still carries — the map, fiber table and editor rely on it.
 */
const raw = {
  id: 'f1',
  name: 'Line 1',
  coreCount: 12,
  operatorId: 'op1',
  zoneId: 'z1',
  cableTag: 'T1',
  notes: 'n',
  images: [],
  createdAt: new Date('2026-10-01'),
  zone: { id: 'z1', name: 'Zone 1' },
  operator: { id: 'op1', name: 'Op' },
  olt: { id: 'o1', name: 'OLT', pop: { id: 'p1', name: 'POP 1' } },
  createdBy: { id: 'u1', name: 'Someone' },
  fedBy: [{ portNo: 1, splitter: { id: 's9' } }],
  points: [
    { id: 'pt1', fiberId: 'f1', sequence: 0, type: 'POP', latitude: 18.5, longitude: 73.8, popId: 'p1', closureId: null, buildingId: null, splitterId: null, pop: { name: 'POP 1' }, closure: null, building: null, splitter: null },
    { id: 'pt2', fiberId: 'f1', sequence: 1, type: 'WAYPOINT', latitude: 18.51, longitude: 73.81, popId: null, closureId: null, buildingId: null, splitterId: null, pop: null, closure: null, building: null, splitter: null },
    {
      id: 'pt3', fiberId: 'f1', sequence: 2, type: 'CLOSURE', latitude: 18.52, longitude: 73.82, popId: null, closureId: 'c1', buildingId: null, splitterId: null,
      pop: null, building: null, splitter: null,
      closure: { code: 'JC-1', kind: 'JOINT', notes: 'by the pole', splitters: [{ id: 's1', ratio: 'R1_4', location: 'IN', fiberType: 'SUB' }] },
    },
  ],
  segments: [
    { id: 'sg1', fiberId: 'f1', sequence: 0, fromPointId: 'pt1', toPointId: 'pt2', mapMeters: 100, fiberLaidMeters: 110, isCut: false, cutAt: null, cutNote: null },
    { id: 'sg2', fiberId: 'f1', sequence: 1, fromPointId: 'pt2', toPointId: 'pt3', mapMeters: 50, fiberLaidMeters: null, isCut: true, cutAt: null, cutNote: null },
  ],
}

describe('the fiber list item', () => {
  const item = listFiber(shapeFiber(raw))

  it('drops what no list reads: totals, feed info, OLT, creator', () => {
    for (const key of ['totals', 'fedBy', 'olt', 'createdBy']) expect(item).not.toHaveProperty(key)
  })

  it('keeps what the map, table and editor read', () => {
    expect(item).toMatchObject({ id: 'f1', name: 'Line 1', coreCount: 12, operatorId: 'op1', zoneId: 'z1', cableTag: 'T1', notes: 'n', zone: { name: 'Zone 1' }, operator: { name: 'Op' } })
  })

  it('points keep ids, geometry, references and labels — and leave empty ones out', () => {
    const [pop, waypoint, closure] = item.points
    expect(pop).toEqual({ id: 'pt1', sequence: 0, type: 'POP', latitude: 18.5, longitude: 73.8, popId: 'p1', label: 'POP 1' })
    expect(waypoint).toEqual({ id: 'pt2', sequence: 1, type: 'WAYPOINT', latitude: 18.51, longitude: 73.81 })
    expect(closure).toMatchObject({ closureId: 'c1', label: 'JC-1', splitter: '1:4', splitterId: 's1', splitterRatio: 'R1_4', kind: 'JOINT', closure: { notes: 'by the pole' } })
    expect(closure).not.toHaveProperty('fiberId')
  })

  it('segments keep only how they join and whether they are cut', () => {
    expect(item.segments).toEqual([
      { id: 'sg1', sequence: 0, fromPointId: 'pt1', toPointId: 'pt2', isCut: false },
      { id: 'sg2', sequence: 1, fromPointId: 'pt2', toPointId: 'pt3', isCut: true },
    ])
  })
})
