import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'
import { createBuildingSchema } from '../src/modules/buildings/building.schemas.js'

describe('create schema photo limits', () => {
  const base = {
    buildingName: 'X',
    formattedAddress: 'A',
    latitude: 1,
    longitude: 1,
    zoneId: 'z1',
  }

  it('rejects two ENTRANCE photos in the create payload', () => {
    const result = createBuildingSchema.safeParse({
      ...base,
      photos: [
        { type: 'ENTRANCE', url: '/uploads/a.jpg' },
        { type: 'ENTRANCE', url: '/uploads/b.jpg' },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('allows one of each plus several ADDITIONAL', () => {
    const result = createBuildingSchema.safeParse({
      ...base,
      photos: [
        { type: 'ENTRANCE', url: '/uploads/a.jpg' },
        { type: 'PERMISSION_LETTER', url: '/uploads/l.pdf' },
        { type: 'ADDITIONAL', url: '/uploads/c.jpg' },
        { type: 'ADDITIONAL', url: '/uploads/d.jpg' },
      ],
    })
    expect(result.success).toBe(true)
  })
})

function fakeRepo({ building = { id: 'b1' }, photo } = {}) {
  return {
    findById: vi.fn(async (id) => (id === building?.id ? building : null)),
    createPhoto: vi.fn(async (data) => ({ id: 'p1', ...data })),
    findPhotoById: vi.fn(async () => photo ?? null),
    deletePhoto: vi.fn(async () => {}),
    upsertPermissionDocument: vi.fn(async () => {}),
    clearPermissionDocument: vi.fn(async () => {}),
  }
}

const fakeStorage = () => ({
  delete: vi.fn(async () => {}),
  keyFromUrl: (url) => (url.includes('/uploads/') ? url.split('/uploads/')[1] : null),
})

describe('building service photos', () => {
  it('adds a photo to an existing building', async () => {
    const repo = fakeRepo()
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })
    const photo = await service.addPhoto('b1', { type: 'ENTRANCE', url: '/uploads/a.jpg' })
    expect(repo.createPhoto).toHaveBeenCalledWith({
      buildingId: 'b1',
      type: 'ENTRANCE',
      url: '/uploads/a.jpg',
    })
    expect(photo.id).toBe('p1')
  })

  it('rejects a url that does not belong to our storage (XSS guard)', async () => {
    const service = createBuildingService({ buildingRepository: fakeRepo(), storage: fakeStorage() })
    await expect(
      service.addPhoto('b1', { type: 'ENTRANCE', url: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      service.addPhoto('b1', { type: 'ENTRANCE', url: 'https://evil.example/x.jpg' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('404s when the building does not exist', async () => {
    const service = createBuildingService({
      buildingRepository: fakeRepo({ building: null }),
      storage: fakeStorage(),
    })
    await expect(service.addPhoto('nope', { type: 'ENTRANCE', url: 'x' })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('updates permission.documentUrl when a manager adds a PERMISSION_LETTER', async () => {
    const repo = fakeRepo()
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })
    await service.addPhoto(
      'b1',
      { type: 'PERMISSION_LETTER', url: '/uploads/letter.pdf' },
      { id: 'u1', role: 'MANAGER' },
    )
    expect(repo.upsertPermissionDocument).toHaveBeenCalledWith('b1', '/uploads/letter.pdf')
  })

  it('403s when a surveyor tries to add a PERMISSION_LETTER', async () => {
    const repo = fakeRepo()
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })
    await expect(
      service.addPhoto(
        'b1',
        { type: 'PERMISSION_LETTER', url: '/uploads/letter.pdf' },
        { id: 'u2', role: 'SURVEYOR' },
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.createPhoto).not.toHaveBeenCalled()
    expect(repo.upsertPermissionDocument).not.toHaveBeenCalled()
  })

  it('surveyors can still add ENTRANCE and ADDITIONAL photos to their own buildings', async () => {
    // Surveyors may only touch buildings they created (zone-access feature).
    const repo = fakeRepo({ building: { id: 'b1', createdById: 'u2' } })
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })
    await service.addPhoto(
      'b1',
      { type: 'ENTRANCE', url: '/uploads/door.jpg' },
      { id: 'u2', role: 'SURVEYOR' },
    )
    await service.addPhoto(
      'b1',
      { type: 'ADDITIONAL', url: '/uploads/side.jpg' },
      { id: 'u2', role: 'SURVEYOR' },
    )
    expect(repo.createPhoto).toHaveBeenCalledTimes(2)
  })

  it('409s a second ENTRANCE photo (one per building)', async () => {
    const repo = fakeRepo({
      building: { id: 'b1', createdById: 'u2', photos: [{ id: 'p0', type: 'ENTRANCE' }] },
    })
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })
    await expect(
      service.addPhoto('b1', { type: 'ENTRANCE', url: '/uploads/door2.jpg' }, { id: 'u2', role: 'SURVEYOR' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(repo.createPhoto).not.toHaveBeenCalled()
  })

  it('409s a second PERMISSION_LETTER', async () => {
    const repo = fakeRepo({
      building: { id: 'b1', photos: [{ id: 'p0', type: 'PERMISSION_LETTER' }] },
    })
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })
    await expect(
      service.addPhoto('b1', { type: 'PERMISSION_LETTER', url: '/uploads/l2.pdf' }, { id: 'u1', role: 'ADMIN' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('allows multiple ADDITIONAL photos', async () => {
    const repo = fakeRepo({
      building: {
        id: 'b1',
        createdById: 'u2',
        photos: [{ id: 'p0', type: 'ADDITIONAL' }, { id: 'p1', type: 'ENTRANCE' }],
      },
    })
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })
    await service.addPhoto('b1', { type: 'ADDITIONAL', url: '/uploads/x.jpg' }, { id: 'u2', role: 'SURVEYOR' })
    expect(repo.createPhoto).toHaveBeenCalledTimes(1)
  })

  it('removes a photo, deletes the stored file, clears matching permission doc', async () => {
    const photo = {
      id: 'p9',
      buildingId: 'b1',
      type: 'PERMISSION_LETTER',
      url: 'http://x/uploads/2026/07/l.pdf',
    }
    const repo = fakeRepo({ photo })
    const storage = fakeStorage()
    const service = createBuildingService({ buildingRepository: repo, storage })
    await service.removePhoto('b1', 'p9')
    expect(repo.deletePhoto).toHaveBeenCalledWith('p9')
    expect(storage.delete).toHaveBeenCalledWith({ key: '2026/07/l.pdf' })
    expect(repo.clearPermissionDocument).toHaveBeenCalledWith('b1', photo.url)
  })

  it('404s when removing a photo that belongs to another building', async () => {
    const photo = { id: 'p9', buildingId: 'OTHER', url: 'u' }
    const service = createBuildingService({
      buildingRepository: fakeRepo({ photo }),
      storage: fakeStorage(),
    })
    await expect(service.removePhoto('b1', 'p9')).rejects.toMatchObject({ status: 404 })
  })

  it('still removes the DB row when file deletion fails', async () => {
    const photo = { id: 'p9', buildingId: 'b1', type: 'ENTRANCE', url: 'http://x/uploads/z.jpg' }
    const repo = fakeRepo({ photo })
    const storage = {
      delete: vi.fn(async () => {
        throw new Error('disk')
      }),
      keyFromUrl: () => 'z.jpg',
    }
    const service = createBuildingService({ buildingRepository: repo, storage })
    await service.removePhoto('b1', 'p9')
    expect(repo.deletePhoto).toHaveBeenCalledWith('p9')
  })
})
