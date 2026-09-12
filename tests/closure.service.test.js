import { describe, it, expect, vi } from 'vitest'
import { createClosureService } from '../src/modules/closures/closure.service.js'
import { closureRepository as realRepo } from '../src/modules/closures/closure.repository.js'

function fakeRepo(over = {}) {
  const closure = {
    id: 'c1',
    code: 'CL-0001',
    latitude: 18.5,
    longitude: 73.8,
    splitters: [],
    _count: { points: 0 },
  }
  const splitter = {
    id: 's1',
    closureId: 'c1',
    ratio: 'R1_4',
    outputs: [
      { id: 'o1', splitterId: 's1', portNo: 1, toFiberId: null, toBuildingId: null, label: null },
      { id: 'o2', splitterId: 's1', portNo: 2, toFiberId: null, toBuildingId: null, label: null },
    ],
  }
  const repo = {
    list: vi.fn(async () => [closure]),
    findById: vi.fn(async (id) => (id === 'c1' ? closure : null)),
    create: vi.fn(async (d) => ({ id: 'new', ...d })),
    update: vi.fn(async (id, d) => ({ ...closure, ...d })),
    delete: vi.fn(async () => {}),
    fibersThrough: vi.fn(async () => []),
    fibersEndingAt: vi.fn(async () => []),
    createSplitter: vi.fn(async (d, portCount) => ({ id: 'news', ...d, portCount })),
    findSplitterById: vi.fn(async (id) => (id === 's1' ? splitter : null)),
    updateSplitter: vi.fn(async (id, d) => ({ ...splitter, ...d })),
    deleteSplitter: vi.fn(async () => {}),
    updateOutput: vi.fn(async (splitterId, portNo, d) => ({ splitterId, portNo, ...d })),
    findManyWithSplitters: vi.fn(async () => []),
    claimSplitterInput: vi.fn(async () => ({ count: 0 })),
    ...over,
  }
  return repo
}

function svc(over, fpOver) {
  return createClosureService({
    closureRepository: fakeRepo(over),
    fiberPointRepository: {
      updatePositionForClosure: vi.fn(async () => 0),
      recomputeSegmentsTouching: vi.fn(async () => 0),
      ...fpOver,
    },
    sequences: { nextClosureCode: async () => 'CL-0042' },
    prisma: { $transaction: (fn) => fn('tx') },
  })
}

describe('closure service', () => {
  it('fake matches the real repository surface', () => {
    for (const k of Object.keys(fakeRepo())) expect(typeof realRepo[k]).toBe('function')
  })

  it('createClosure assigns the code from the injected sequence', async () => {
    const repo = fakeRepo()
    const s = createClosureService({
      closureRepository: repo,
      fiberPointRepository: { updatePositionForClosure: vi.fn(), recomputeSegmentsTouching: vi.fn() },
      sequences: { nextClosureCode: async () => 'CL-0042' },
      prisma: { $transaction: (fn) => fn('tx') },
    })
    await s.createClosure({ latitude: 1, longitude: 1 })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CL-0042', latitude: 1, longitude: 1 }),
      'tx',
    )
  })

  it('404s on unknown closure', async () => {
    await expect(svc().updateClosure('ghost', {})).rejects.toMatchObject({ status: 404 })
    await expect(svc().deleteClosure('ghost')).rejects.toMatchObject({ status: 404 })
    await expect(svc().getClosure('ghost')).rejects.toMatchObject({ status: 404 })
  })

  it('refuses to delete a closure fibers pass through', async () => {
    await expect(
      svc({ findById: async () => ({ id: 'c1', _count: { points: 2 } }) }).deleteClosure('c1'),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('getClosure reports fiber role: out at seq 0, in at max seq, through otherwise, [] with none', async () => {
    const through = svc({
      fibersThrough: async () => [
        { fiber: { id: 'f1', name: 'FIB-001', coreCount: 12, status: 'PLANNED' }, pointSeq: 0, maxSeq: 2 },
        { fiber: { id: 'f2', name: 'FIB-002', coreCount: 12, status: 'PLANNED' }, pointSeq: 1, maxSeq: 2 },
        { fiber: { id: 'f3', name: 'FIB-003', coreCount: 12, status: 'PLANNED' }, pointSeq: 2, maxSeq: 2 },
      ],
    })
    const result = await through.getClosure('c1')
    expect(result.fibers).toEqual([
      expect.objectContaining({ id: 'f1', role: 'out' }),
      expect.objectContaining({ id: 'f2', role: 'through' }),
      expect.objectContaining({ id: 'f3', role: 'in' }),
    ])

    const empty = await svc().getClosure('c1')
    expect(empty.fibers).toEqual([])
  })

  it('updateClosure with a new position rewrites fiber points and recomputes segments', async () => {
    const fp = { updatePositionForClosure: vi.fn(async () => 1), recomputeSegmentsTouching: vi.fn(async () => 0) }
    const s = createClosureService({
      closureRepository: fakeRepo(),
      fiberPointRepository: fp,
      sequences: { nextClosureCode: async () => 'CL-0042' },
      prisma: { $transaction: (fn) => fn('tx') },
    })
    await s.updateClosure('c1', { latitude: 18.6, longitude: 73.9 })
    expect(fp.updatePositionForClosure).toHaveBeenCalledWith('c1', { latitude: 18.6, longitude: 73.9 })
    expect(fp.recomputeSegmentsTouching).toHaveBeenCalledWith({ closureId: 'c1' })
  })

  it('addSplitter pre-fills inputFiberId when exactly one fiber ends at the closure', async () => {
    const repo = fakeRepo({ fibersEndingAt: vi.fn(async () => [{ id: 'f1' }]) })
    const s = createClosureService({
      closureRepository: repo,
      fiberPointRepository: { updatePositionForClosure: vi.fn(), recomputeSegmentsTouching: vi.fn() },
      sequences: { nextClosureCode: async () => 'CL-0042' },
      prisma: { $transaction: (fn) => fn('tx') },
    })
    await s.addSplitter('c1', { ratio: 'R1_4', location: 'WAN' })
    expect(repo.createSplitter).toHaveBeenCalledWith(
      { closureId: 'c1', ratio: 'R1_4', location: 'WAN', inputFiberId: 'f1' },
      4,
    )
  })

  it('addSplitter leaves inputFiberId null when zero or multiple fibers end there', async () => {
    const repo = fakeRepo({ fibersEndingAt: vi.fn(async () => []) })
    const s = createClosureService({
      closureRepository: repo,
      fiberPointRepository: { updatePositionForClosure: vi.fn(), recomputeSegmentsTouching: vi.fn() },
      sequences: { nextClosureCode: async () => 'CL-0042' },
      prisma: { $transaction: (fn) => fn('tx') },
    })
    await s.addSplitter('c1', { ratio: 'R1_8', location: 'WAN' })
    expect(repo.createSplitter).toHaveBeenCalledWith(
      { closureId: 'c1', ratio: 'R1_8', location: 'WAN', inputFiberId: null },
      8,
    )
  })

  it('404s addSplitter on an unknown closure', async () => {
    await expect(svc().addSplitter('ghost', { ratio: 'R1_4', location: 'WAN' })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('addSplitter 409s when a fiber passes through the closure', async () => {
    const repo = fakeRepo({
      fibersThrough: vi.fn(async () => [
        { fiber: { id: 'f1', name: 'FIB-001' }, pointSeq: 1, maxSeq: 2 },
      ]),
    })
    const s = createClosureService({
      closureRepository: repo,
      fiberPointRepository: { updatePositionForClosure: vi.fn(), recomputeSegmentsTouching: vi.fn() },
      sequences: { nextClosureCode: async () => 'CL-0042' },
      prisma: { $transaction: (fn) => fn('tx') },
    })
    await expect(s.addSplitter('c1', { ratio: 'R1_4', location: 'WAN' })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('FIB-001'),
    })
    expect(repo.createSplitter).not.toHaveBeenCalled()
  })

  it('addSplitter succeeds when fibers only end (in) or start (out) at the closure', async () => {
    const repo = fakeRepo({
      fibersThrough: vi.fn(async () => [
        { fiber: { id: 'f1', name: 'FIB-001' }, pointSeq: 0, maxSeq: 2 },
        { fiber: { id: 'f2', name: 'FIB-002' }, pointSeq: 2, maxSeq: 2 },
      ]),
      fibersEndingAt: vi.fn(async () => []),
    })
    const s = createClosureService({
      closureRepository: repo,
      fiberPointRepository: { updatePositionForClosure: vi.fn(), recomputeSegmentsTouching: vi.fn() },
      sequences: { nextClosureCode: async () => 'CL-0042' },
      prisma: { $transaction: (fn) => fn('tx') },
    })
    await expect(s.addSplitter('c1', { ratio: 'R1_4', location: 'WAN' })).resolves.toBeDefined()
    expect(repo.createSplitter).toHaveBeenCalled()
  })

  it('deleteSplitter 409s when an output still feeds a fiber', async () => {
    await expect(
      svc({
        findSplitterById: async () => ({
          id: 's1',
          outputs: [{ portNo: 1, toFiberId: 'f1' }],
        }),
      }).deleteSplitter('s1'),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('deleteSplitter succeeds when no output feeds a fiber', async () => {
    const repo = fakeRepo()
    const s = svc({ deleteSplitter: repo.deleteSplitter })
    await expect(s.deleteSplitter('s1')).resolves.toBeUndefined()
  })

  it('404s deleteSplitter/updateSplitter/setOutput on an unknown splitter', async () => {
    await expect(svc().deleteSplitter('ghost')).rejects.toMatchObject({ status: 404 })
    await expect(svc().updateSplitter('ghost', {})).rejects.toMatchObject({ status: 404 })
    await expect(svc().setOutput('ghost', 1, {})).rejects.toMatchObject({ status: 404 })
  })

  it('updateSplitter 409s when shrinking the ratio below a used port', async () => {
    await expect(
      svc({
        findSplitterById: async () => ({
          id: 's1',
          outputs: [
            { portNo: 1, toFiberId: 'f1', toBuildingId: null },
            { portNo: 2, toFiberId: null, toBuildingId: null },
          ],
        }),
      }).updateSplitter('s1', { ratio: 'R1_2' }),
    ).resolves.toBeDefined()

    await expect(
      svc({
        findSplitterById: async () => ({
          id: 's1',
          outputs: [
            { portNo: 1, toFiberId: 'f1', toBuildingId: null },
            { portNo: 4, toFiberId: 'f2', toBuildingId: null },
          ],
        }),
      }).updateSplitter('s1', { ratio: 'R1_2' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('setOutput 404s when the port does not exist on the splitter', async () => {
    await expect(svc().setOutput('s1', 99, { label: 'X' })).rejects.toMatchObject({ status: 404 })
  })

  it('setOutput updates the output on a valid port', async () => {
    const repo = fakeRepo()
    const s = svc({ updateOutput: repo.updateOutput, findSplitterById: repo.findSplitterById })
    await s.setOutput('s1', 2, { label: 'Shop' })
    expect(repo.updateOutput).toHaveBeenCalledWith('s1', 2, { label: 'Shop' })
  })
})
