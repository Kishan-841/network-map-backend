import { describe, it, expect, vi } from 'vitest'
import { createPopService } from '../src/modules/pops/pop.service.js'
import { popRepository as realRepo } from '../src/modules/pops/pop.repository.js'

function fakeRepo(over = {}) {
  const pop = { id: 'pop1', name: 'Keshav-POP', latitude: 18.5, longitude: 73.8 }
  const olt = { id: 'olt1', popId: 'pop1', name: 'OLT-1', ponPortCount: 16 }
  const repo = {
    list: vi.fn(async () => [pop]),
    findById: vi.fn(async (id) => (id === 'pop1' ? pop : null)),
    findByName: vi.fn(async () => null),
    create: vi.fn(async (d) => ({ id: 'new', ...d })),
    update: vi.fn(async (id, d) => ({ ...pop, ...d })),
    delete: vi.fn(async () => {}),
    createOlt: vi.fn(async (d) => ({ id: 'newolt', ...d })),
    findOltById: vi.fn(async (id) => (id === 'olt1' ? olt : null)),
    findOltByName: vi.fn(async () => null),
    updateOlt: vi.fn(async (id, d) => ({ ...olt, ...d })),
    deleteOlt: vi.fn(async () => {}),
    countPointsForPop: vi.fn(async () => 0),
    maxUsedPort: vi.fn(async () => 0),
    countFibersForOlt: vi.fn(async () => 0),
    ...over,
  }
  return repo
}
const svc = (over) =>
  createPopService({
    popRepository: fakeRepo(over),
    fiberPointRepository: { updatePositionForPop: vi.fn(async () => 0) },
  })

describe('pop service', () => {
  it('fake matches the real repository surface', () => {
    for (const k of Object.keys(fakeRepo())) expect(typeof realRepo[k]).toBe('function')
  })

  it('409s a duplicate name and 404s unknown ids', async () => {
    await expect(
      svc({ findByName: async () => ({ id: 'x' }) }).createPop({
        name: 'Keshav-POP',
        latitude: 1,
        longitude: 1,
      }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(svc().updatePop('ghost', { name: 'X' })).rejects.toMatchObject({ status: 404 })
  })

  it('refuses to delete a POP that fibers reference', async () => {
    await expect(svc({ countPointsForPop: async () => 2 }).deletePop('pop1')).rejects.toMatchObject({
      status: 409,
    })
  })

  it('409s a duplicate OLT name at the same POP', async () => {
    await expect(
      svc({ findOltByName: async () => ({ id: 'other-olt' }) }).createOlt('pop1', {
        name: 'OLT-1',
        ponPortCount: 16,
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('refuses to shrink an OLT below a used port', async () => {
    await expect(
      svc({ maxUsedPort: async () => 9 }).updateOlt('pop1', 'olt1', { ponPortCount: 8 }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('moving a POP rewrites its fiber points', async () => {
    const fp = { updatePositionForPop: vi.fn(async () => 1) }
    const s = createPopService({ popRepository: fakeRepo(), fiberPointRepository: fp })
    await s.updatePop('pop1', { latitude: 18.6, longitude: 73.9 })
    expect(fp.updatePositionForPop).toHaveBeenCalledWith('pop1', {
      latitude: 18.6,
      longitude: 73.9,
    })
  })
})
