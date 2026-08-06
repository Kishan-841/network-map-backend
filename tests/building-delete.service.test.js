import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

function fakeRepo(building) {
  return {
    findById: vi.fn(async (id) => (id === building?.id ? building : null)),
    delete: vi.fn(async () => {}),
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
})
