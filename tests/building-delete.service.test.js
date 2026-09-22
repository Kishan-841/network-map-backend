import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

function fakeRepo(building, { fiberNames = [] } = {}) {
  return {
    findById: vi.fn(async (id) => (id === building?.id ? building : null)),
    delete: vi.fn(async () => {}),
    fiberNamesAttachedTo: vi.fn(async () => fiberNames),
  }
}

const fakeStorage = () => ({
  delete: vi.fn(async () => {}),
  keyFromUrl: (url) => (url.includes('/uploads/') ? url.split('/uploads/')[1] : null),
})

describe('building service delete', () => {
  it('deletes the row and every distinct stored file (photos + permission doc)', async () => {
    const building = {
      id: 'b1',
      photos: [
        { id: 'p1', url: 'http://x/uploads/a.jpg' },
        { id: 'p2', url: 'http://x/uploads/letter.pdf' },
      ],
      // Same URL as photo p2 — must be deleted from storage only once.
      permission: { documentUrl: 'http://x/uploads/letter.pdf' },
    }
    const repo = fakeRepo(building)
    const storage = fakeStorage()
    const service = createBuildingService({ buildingRepository: repo, storage })

    await service.deleteBuilding('b1')

    expect(repo.delete).toHaveBeenCalledWith('b1')
    expect(storage.delete).toHaveBeenCalledTimes(2)
    expect(storage.delete).toHaveBeenCalledWith({ key: 'a.jpg' })
    expect(storage.delete).toHaveBeenCalledWith({ key: 'letter.pdf' })
  })

  it('deletes a permission documentUrl that has no photo row', async () => {
    const building = {
      id: 'b1',
      photos: [],
      permission: { documentUrl: 'http://x/uploads/only-doc.pdf' },
    }
    const storage = fakeStorage()
    const service = createBuildingService({ buildingRepository: fakeRepo(building), storage })

    await service.deleteBuilding('b1')

    expect(storage.delete).toHaveBeenCalledWith({ key: 'only-doc.pdf' })
  })

  it('404s when the building does not exist', async () => {
    const service = createBuildingService({
      buildingRepository: fakeRepo(null),
      storage: fakeStorage(),
    })
    await expect(service.deleteBuilding('nope')).rejects.toMatchObject({ status: 404 })
  })

  it('still succeeds when file deletion fails (row already gone)', async () => {
    const building = { id: 'b1', photos: [{ id: 'p1', url: 'http://x/uploads/a.jpg' }] }
    const repo = fakeRepo(building)
    const storage = {
      delete: vi.fn(async () => {
        throw new Error('r2 down')
      }),
      keyFromUrl: () => 'a.jpg',
    }
    const service = createBuildingService({ buildingRepository: repo, storage })

    await expect(service.deleteBuilding('b1')).resolves.toBeUndefined()
    expect(repo.delete).toHaveBeenCalledWith('b1')
  })

  it('skips foreign URLs that do not belong to our storage', async () => {
    const building = { id: 'b1', photos: [{ id: 'p1', url: 'https://evil.example/x.jpg' }] }
    const storage = fakeStorage()
    const service = createBuildingService({ buildingRepository: fakeRepo(building), storage })

    await service.deleteBuilding('b1')

    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('409s with the attached fiber names when a FiberPoint still references the building', async () => {
    const building = { id: 'b1', photos: [] }
    const repo = fakeRepo(building, { fiberNames: ['FIB-001'] })
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })

    await expect(service.deleteBuilding('b1')).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('FIB-001'),
    })
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('deletes normally when no fiber is attached', async () => {
    const building = { id: 'b1', photos: [] }
    const repo = fakeRepo(building, { fiberNames: [] })
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })

    await expect(service.deleteBuilding('b1')).resolves.toBeUndefined()
    expect(repo.delete).toHaveBeenCalledWith('b1')
  })
})

describe('building service bulk delete', () => {
  const fakeStorage = () => ({ delete: vi.fn(async () => {}), keyFromUrl: () => null })

  it('deletes each ticked building and skips one still attached to a fiber', async () => {
    const rows = {
      b1: { id: 'b1', buildingName: 'Tower A', photos: [], permission: null },
      b2: { id: 'b2', buildingName: 'Tower B', photos: [], permission: null },
      b3: { id: 'b3', buildingName: 'Tower C', photos: [], permission: null },
    }
    const repo = {
      findById: vi.fn(async (id) => rows[id] ?? null),
      delete: vi.fn(async () => {}),
      fiberNamesAttachedTo: vi.fn(async (id) => (id === 'b2' ? ['FIB-1'] : [])),
    }
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })

    const res = await service.bulkDeleteBuildings({ ids: ['b1', 'b2', 'b3'] })

    expect(res.deletedCount).toBe(2)
    expect(res.deleted.map((d) => d.id).sort()).toEqual(['b1', 'b3'])
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0]).toMatchObject({ id: 'b2', name: 'Tower B' })
    expect(res.skipped[0].reason).toContain('FIB-1')
    expect(repo.delete).toHaveBeenCalledTimes(2)
    expect(repo.delete).not.toHaveBeenCalledWith('b2')
  })

  it('records a missing id as skipped rather than crashing the batch', async () => {
    const repo = {
      findById: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
      fiberNamesAttachedTo: vi.fn(async () => []),
    }
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })

    const res = await service.bulkDeleteBuildings({ ids: ['ghost'] })

    expect(res.deletedCount).toBe(0)
    expect(res.skipped[0].reason).toMatch(/not found/i)
    expect(repo.delete).not.toHaveBeenCalled()
  })
})
