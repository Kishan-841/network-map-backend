import { describe, it, expect, vi } from 'vitest'
import { createFiberService } from '../src/modules/fibers/fiber.service.js'
import { createFiberSchema, updateFiberSchema, CORE_COUNTS } from '../src/modules/fibers/fiber.schemas.js'
import { fiberRepository as realFiberRepo } from '../src/modules/fibers/fiber.repository.js'
import { closureRepository as realClosureRepo } from '../src/modules/closures/closure.repository.js'
import { popRepository as realPopRepo } from '../src/modules/pops/pop.repository.js'

// Only URLs that came out of our own uploads API are accepted as images.
const fakeStorage = () => ({
  keyFromUrl: (url) => (url.includes('/uploads/') ? url.split('/uploads/')[1] : null),
})

/** What `findById` hands back: a POP→CLOSURE fiber with one 400 m laid segment. */
const existingFiber = (over = {}) => ({
  id: 'f1',
  name: 'FIB-001',
  coreCount: 12,
  status: 'PLANNED',
  oltId: null,
  ponPort: null,
  images: null,
  fedBy: null,
  points: [
    { id: 'p1', sequence: 0, type: 'POP', popId: 'pop1', latitude: 1, longitude: 1, pop: { name: 'POP A' } },
    {
      id: 'p2',
      sequence: 1,
      type: 'CLOSURE',
      closureId: 'c1',
      latitude: 1.01,
      longitude: 1.01,
      closure: { code: 'CL-0001', splitters: [] },
    },
  ],
  segments: [
    { id: 'seg1', sequence: 0, fromPointId: 'p1', toPointId: 'p2', mapMeters: 1500, fiberLaidMeters: 400, isCut: false },
  ],
  ...over,
})

/** Shaped the way FIBER_INCLUDE loads it: portNo alongside the nested splitter. */
const fedByOutput = { portNo: 2, splitter: { id: 's1', ratio: 'R1_4', closure: { id: 'c1', code: 'CL-0001' } } }

/** A splitter whose port 2 already feeds fiber f1 — i.e. the stored feed above. */
const splitterFeeding = (toFiberId = 'f1') =>
  fakeClosureRepo({
    findSplitterById: vi.fn(async () => ({ id: 's1', closureId: 'c1', outputs: [{ portNo: 2, toFiberId }] })),
  })

function fakeFiberRepo(over = {}) {
  return {
    list: vi.fn(async () => [existingFiber()]),
    findById: vi.fn(async (id) => (id === 'ghost' ? null : existingFiber())),
    findByName: vi.fn(async () => null),
    findUsingPort: vi.fn(async () => null),
    create: vi.fn(async (d) => ({ id: 'new', ...d })),
    update: vi.fn(async (id, d) => ({ id, ...d })),
    delete: vi.fn(async () => {}),
    replaceGeometry: vi.fn(async () => {}),
    findSegment: vi.fn(async (fiberId, segmentId) => (segmentId === 'seg1' ? { id: 'seg1', fiberId } : null)),
    updateSegment: vi.fn(async () => {}),
    cutSegment: vi.fn(async () => {}),
    restoreAll: vi.fn(async () => {}),
    splittersFedBy: vi.fn(async () => []),
    fedBy: vi.fn(async () => null),
    ...over,
  }
}

function fakeClosureRepo(over = {}) {
  return {
    findById: vi.fn(async (id) => ({ id, code: 'CL-0001', latitude: 1.01, longitude: 1.01 })),
    create: vi.fn(async (d) => ({ id: 'cnew', ...d })),
    findSplitterById: vi.fn(async () => null),
    updateOutput: vi.fn(async () => {}),
    findManyWithSplitters: vi.fn(async () => []),
    claimSplitterInput: vi.fn(async () => ({ count: 0 })),
    ...over,
  }
}

function fakePopRepo(over = {}) {
  return {
    findById: vi.fn(async (id) => ({ id, name: 'POP A', latitude: 1, longitude: 1 })),
    create: vi.fn(async (d) => ({ id: 'popnew', ...d })),
    findOltById: vi.fn(async (id) => ({ id, name: 'OLT-1', ponPortCount: 16 })),
    ...over,
  }
}

const fakeBuildingRepo = (over = {}) => ({
  findById: vi.fn(async (id) => (id === 'ghost' ? null : { id, buildingName: 'Tower', latitude: 1.02, longitude: 1.02 })),
  ...over,
})

function svc({ fiber, closure, pop, building } = {}) {
  const deps = {
    fiberRepository: fiber ?? fakeFiberRepo(),
    closureRepository: closure ?? fakeClosureRepo(),
    popRepository: pop ?? fakePopRepo(),
    buildingRepository: building ?? fakeBuildingRepo(),
    storage: fakeStorage(),
    sequences: { nextFiberName: vi.fn(async () => 'FIB-001'), nextClosureCode: vi.fn(async () => 'CL-0042') },
    prisma: { $transaction: (fn) => fn('tx') },
  }
  return { service: createFiberService(deps), deps }
}

const P = {
  pop: { type: 'POP', popId: 'pop1', latitude: 0, longitude: 0 },
  waypoint: { type: 'WAYPOINT', latitude: 1.005, longitude: 1.0 },
  newClosure: { type: 'CLOSURE', newClosure: { kind: 'inline' }, latitude: 1.01, longitude: 1.01 },
  closure: (id) => ({ type: 'CLOSURE', closureId: id, latitude: 1.01, longitude: 1.01 }),
  building: { type: 'BUILDING', buildingId: 'b1', latitude: 0, longitude: 0 },
}

const base = { coreCount: 12, status: 'PLANNED' }

describe('fiber schemas', () => {
  it('exports the sanctioned core counts and coerces blank numeric strings to undefined', () => {
    expect(CORE_COUNTS).toEqual([2, 4, 6, 12, 24, 48])
    const parsed = createFiberSchema.safeParse({
      ...base,
      points: [P.pop, P.building],
      ponPort: '',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data.ponPort).toBeUndefined()
    expect(createFiberSchema.safeParse({ ...base, coreCount: 10, points: [P.pop, P.building] }).success).toBe(false)
    // oltId and ponPort travel together
    expect(createFiberSchema.safeParse({ ...base, oltId: 'olt1', points: [P.pop, P.building] }).success).toBe(false)
  })

  it('lets a PATCH carry one half of a cross-field pair — the service merges and re-checks', () => {
    expect(updateFiberSchema.safeParse({ ponPort: 5 }).success).toBe(true)
    expect(updateFiberSchema.safeParse({ fromSplitterOutput: { splitterId: 's1', portNo: 1 } }).success).toBe(true)
  })
})

describe('fiber service', () => {
  it('fakes match the real repository surfaces', () => {
    for (const k of Object.keys(fakeFiberRepo())) expect(typeof realFiberRepo[k]).toBe('function')
    for (const k of Object.keys(fakeClosureRepo())) expect(typeof realClosureRepo[k]).toBe('function')
    for (const k of Object.keys(fakePopRepo())) expect(typeof realPopRepo[k]).toBe('function')
  })

  it('404s on an unknown fiber', async () => {
    const { service } = svc()
    await expect(service.getFiber('ghost')).rejects.toMatchObject({ status: 404 })
    await expect(service.deleteFiber('ghost')).rejects.toMatchObject({ status: 404 })
    await expect(service.updateFiber('ghost', {})).rejects.toMatchObject({ status: 404 })
    await expect(service.restoreFiber('ghost')).rejects.toMatchObject({ status: 404 })
  })

  it('creates a fiber: mints name + closure code, resolves typed points, derives segments', async () => {
    const { service, deps } = svc()
    await service.createFiber({ ...base, points: [P.pop, P.waypoint, P.newClosure, P.building] })

    expect(deps.sequences.nextClosureCode).toHaveBeenCalledTimes(1)
    expect(deps.closureRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CL-0042', kind: 'inline', latitude: 1.01, longitude: 1.01 }),
      'tx',
    )
    expect(deps.fiberRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'FIB-001', coreCount: 12 }),
      'tx',
    )

    const [fiberId, points, segments, tx] = deps.fiberRepository.replaceGeometry.mock.calls[0]
    expect(fiberId).toBe('new')
    expect(tx).toBe('tx')
    // The POP point takes the POP's own coordinates, not the ones the user drew.
    expect(points[0]).toMatchObject({ type: 'POP', popId: 'pop1', latitude: 1, longitude: 1 })
    expect(segments).toHaveLength(2)
    for (const s of segments) expect(s.mapMeters).toBeGreaterThan(0)
  })

  it('rejects a splitter closure in the middle of the line', async () => {
    const closure = fakeClosureRepo({
      findManyWithSplitters: vi.fn(async () => [{ id: 'c2', splitters: [{ id: 's1', ratio: 'R1_4' }] }]),
    })
    const { service } = svc({ closure })
    await expect(
      service.createFiber({ ...base, points: [P.pop, P.closure('c2'), P.building] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('409s when the OLT PON port already feeds another fiber', async () => {
    const fiber = fakeFiberRepo({ findUsingPort: vi.fn(async () => ({ id: 'other', name: 'FIB-009' })) })
    const { service } = svc({ fiber })
    await expect(
      service.createFiber({ ...base, oltId: 'olt1', ponPort: 3, points: [P.pop, P.building] }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('400s when the PON port is beyond the OLT port count', async () => {
    const { service } = svc()
    await expect(
      service.createFiber({ ...base, oltId: 'olt1', ponPort: 99, points: [P.pop, P.building] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('409s a taken splitter output and claims a free one for the new fiber', async () => {
    const taken = fakeClosureRepo({
      findSplitterById: vi.fn(async () => ({
        id: 's1',
        closureId: 'c1',
        outputs: [{ portNo: 1, toFiberId: 'f9' }],
      })),
    })
    await expect(
      svc({ closure: taken }).service.createFiber({
        ...base,
        fromSplitterOutput: { splitterId: 's1', portNo: 1 },
        points: [P.closure('c1'), P.building],
      }),
    ).rejects.toMatchObject({ status: 409 })

    const free = fakeClosureRepo({
      findSplitterById: vi.fn(async () => ({
        id: 's1',
        closureId: 'c1',
        outputs: [{ portNo: 1, toFiberId: null }],
      })),
      findManyWithSplitters: vi.fn(async () => [{ id: 'c1', splitters: [{ id: 's1', ratio: 'R1_4' }] }]),
    })
    const { service } = svc({ closure: free })
    await service.createFiber({
      ...base,
      fromSplitterOutput: { splitterId: 's1', portNo: 1 },
      points: [P.closure('c1'), P.building],
    })
    expect(free.updateOutput).toHaveBeenCalledWith('s1', 1, { toFiberId: 'new' }, 'tx')
  })

  it('carries the laid length forward when a redraw keeps the same endpoints', async () => {
    const { service, deps } = svc()
    await service.updateFiber('f1', {
      points: [P.pop, P.waypoint, P.closure('c1'), P.building],
    })
    const [, , segments] = deps.fiberRepository.replaceGeometry.mock.calls[0]
    expect(segments[0]).toMatchObject({ fiberLaidMeters: 400 })
    expect(segments[1].fiberLaidMeters).toBeUndefined()
  })

  it('cuts only a segment that belongs to the fiber', async () => {
    const { service, deps } = svc()
    await expect(service.cutFiber('f1', { segmentId: 'nope' })).rejects.toMatchObject({ status: 404 })
    await service.cutFiber('f1', { segmentId: 'seg1', note: 'JCB' })
    expect(deps.fiberRepository.cutSegment).toHaveBeenCalledWith('f1', 'seg1', 'JCB')
  })

  it('rejects image URLs that did not come from the uploads API', async () => {
    const { service } = svc()
    await expect(
      service.createFiber({ ...base, images: ['https://evil/x.jpg'], points: [P.pop, P.building] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('400s when segmentLaidMeters does not match the derived segment count', async () => {
    const { service } = svc()
    await expect(
      service.createFiber({
        ...base,
        segmentLaidMeters: [10, 20, 30],
        points: [P.pop, P.waypoint, P.newClosure, P.building],
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('reports what a cut fiber takes down', async () => {
    const cut = {
      ...existingFiber(),
      status: 'CUT',
      points: [
        ...existingFiber().points,
        {
          id: 'p3',
          sequence: 2,
          type: 'BUILDING',
          buildingId: 'b1',
          latitude: 1.02,
          longitude: 1.02,
          building: { buildingName: 'Tower' },
        },
      ],
      segments: [{ ...existingFiber().segments[0], isCut: true }],
    }
    const fiber = fakeFiberRepo({
      findById: vi.fn(async () => cut),
      splittersFedBy: vi.fn(async () => [
        {
          id: 's1',
          closureId: 'c1',
          outputs: [{ portNo: 1, toBuilding: { id: 'b2', buildingName: 'Annexe' }, toFiber: null }],
        },
      ]),
    })
    const { service } = svc({ fiber })
    const result = await service.getFiber('f1')
    expect(result.downstream.buildings.map((b) => b.id).sort()).toEqual(['b1', 'b2'])
    expect(result.totals.closureCount).toBe(1)
  })

  it('claims the splitter input of the closure a fiber ends on', async () => {
    const { service, deps } = svc()
    await service.createFiber({ ...base, points: [P.pop, P.waypoint, P.closure('c1')] })
    expect(deps.closureRepository.claimSplitterInput).toHaveBeenCalledWith('c1', 'new', 'tx')
  })

  describe('update-time cross-field rules run on merged values', () => {
    it('accepts half a port pair when the stored fiber supplies the other half', async () => {
      const fiber = fakeFiberRepo({ findById: vi.fn(async () => existingFiber({ oltId: 'olt1', ponPort: 2 })) })
      const { service } = svc({ fiber })
      await expect(service.updateFiber('f1', { ponPort: 5 })).resolves.toBeTruthy()
      expect(fiber.findUsingPort).toHaveBeenCalledWith('olt1', 5)
    })

    it('400s a port that the merged fiber would hold without an OLT', async () => {
      const { service } = svc()
      await expect(service.updateFiber('f1', { ponPort: 5 })).rejects.toMatchObject({ status: 400 })
    })

    it('400s a splitter feed on a fiber that keeps its OLT port', async () => {
      const fiber = fakeFiberRepo({ findById: vi.fn(async () => existingFiber({ oltId: 'olt1', ponPort: 2 })) })
      const { service } = svc({ fiber })
      await expect(
        service.updateFiber('f1', { fromSplitterOutput: { splitterId: 's1', portNo: 1 } }),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('a stored feed the payload does not repeat', () => {
    const fedFiber = () => fakeFiberRepo({ findById: vi.fn(async () => existingFiber({ fedBy: fedByOutput })) })

    it('still requires the redrawn line to start at the splitter closure', async () => {
      const { service } = svc({ fiber: fedFiber(), closure: splitterFeeding() })
      await expect(
        service.updateFiber('f1', { points: [P.closure('c2'), P.building] }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('passes when the redrawn line still starts there, without re-writing the output', async () => {
      const closure = splitterFeeding()
      const { service } = svc({ fiber: fedFiber(), closure })
      await expect(
        service.updateFiber('f1', { points: [P.closure('c1'), P.building] }),
      ).resolves.toBeTruthy()
      expect(closure.updateOutput).not.toHaveBeenCalled()
    })

    it('hands the output back when the payload explicitly detaches the feed', async () => {
      const closure = splitterFeeding()
      const { service } = svc({ fiber: fedFiber(), closure })
      await service.updateFiber('f1', { fromSplitterOutput: null })
      expect(closure.updateOutput).toHaveBeenCalledWith('s1', 2, { toFiberId: null }, 'tx')
    })
  })
})
