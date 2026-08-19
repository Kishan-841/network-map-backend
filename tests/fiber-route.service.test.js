import { describe, it, expect, vi } from 'vitest'
import { createFiberRouteService } from '../src/modules/fiber-routes/fiber-route.service.js'
import { createFiberRouteSchema } from '../src/modules/fiber-routes/fiber-route.schemas.js'

const SEGMENTS = [
  [
    { latitude: 18.59, longitude: 73.74 },
    { latitude: 18.6, longitude: 73.75 },
  ],
  [
    { latitude: 18.6, longitude: 73.75 },
    { latitude: 18.61, longitude: 73.74 },
  ],
]

const DETAILS = { fiberType: '24 core', fiberId: 'FBR-001', placement: 'OUT' }

describe('fiber route schema', () => {
  it('accepts trunk + branch segments with the required details', () => {
    const parsed = createFiberRouteSchema.safeParse({
      name: 'Wakad trunk',
      segments: SEGMENTS,
      ...DETAILS,
      remark: 'along the main road',
      images: ['/uploads/a.jpg'],
    })
    expect(parsed.success).toBe(true)
  })

  it('requires fiberType, fiberId, and placement on create', () => {
    expect(createFiberRouteSchema.safeParse({ name: 'X', segments: SEGMENTS }).success).toBe(false)
    expect(
      createFiberRouteSchema.safeParse({
        name: 'X',
        segments: SEGMENTS,
        ...DETAILS,
        fiberType: '3 core', // not a real option
      }).success,
    ).toBe(false)
    expect(
      createFiberRouteSchema.safeParse({
        name: 'X',
        segments: SEGMENTS,
        ...DETAILS,
        placement: 'SIDEWAYS',
      }).success,
    ).toBe(false)
  })

  it('rejects a 1-point segment, empty segments, and bad colors', () => {
    expect(
      createFiberRouteSchema.safeParse({
        name: 'X',
        ...DETAILS,
        segments: [[{ latitude: 1, longitude: 1 }]],
      }).success,
    ).toBe(false)
    expect(
      createFiberRouteSchema.safeParse({ name: 'X', ...DETAILS, segments: [] }).success,
    ).toBe(false)
    expect(
      createFiberRouteSchema.safeParse({ name: 'X', ...DETAILS, segments: SEGMENTS, color: 'red' })
        .success,
    ).toBe(false)
  })
})

function fakeRepo({ existing = null, route = { id: 'f1', name: 'Trunk' } } = {}) {
  return {
    list: vi.fn(async () => [route]),
    findById: vi.fn(async (id) => (id === route.id ? route : null)),
    findByName: vi.fn(async () => existing),
    create: vi.fn(async (data) => ({ id: 'new', ...data })),
    update: vi.fn(async (id, data) => ({ ...route, ...data })),
    delete: vi.fn(async () => {}),
  }
}

const fakeStorage = () => ({
  keyFromUrl: (url) => (url.includes('/uploads/') ? url.split('/uploads/')[1] : null),
})

describe('fiber route service', () => {
  it('creates a route', async () => {
    const repo = fakeRepo()
    const service = createFiberRouteService({ fiberRouteRepository: repo, storage: fakeStorage() })
    const created = await service.createFiberRoute({ name: 'Trunk 2', segments: SEGMENTS })
    expect(repo.create).toHaveBeenCalledWith({ name: 'Trunk 2', segments: SEGMENTS })
    expect(created.id).toBe('new')
  })

  it('rejects image URLs that do not belong to our storage (XSS guard)', async () => {
    const service = createFiberRouteService({
      fiberRouteRepository: fakeRepo(),
      storage: fakeStorage(),
    })
    await expect(
      service.createFiberRoute({
        name: 'Trunk 3',
        segments: SEGMENTS,
        images: ['https://evil.example/x.jpg'],
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      service.updateFiberRoute('f1', { images: ['javascript:alert(1)'] }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      service.updateFiberRoute('f1', { images: ['http://x/uploads/ok.jpg'] }),
    ).resolves.toBeTruthy()
  })

  it('409s a duplicate name; renaming onto another route also 409s', async () => {
    const clash = fakeRepo({ existing: { id: 'OTHER', name: 'trunk' } })
    const service = createFiberRouteService({ fiberRouteRepository: clash, storage: fakeStorage() })
    await expect(
      service.createFiberRoute({ name: 'Trunk', segments: SEGMENTS }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(service.updateFiberRoute('f1', { name: 'Trunk' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('404s update/delete of unknown routes; delete works on known ones', async () => {
    const repo = fakeRepo()
    const service = createFiberRouteService({ fiberRouteRepository: repo, storage: fakeStorage() })
    await expect(service.updateFiberRoute('nope', { name: 'X' })).rejects.toMatchObject({
      status: 404,
    })
    await expect(service.deleteFiberRoute('nope')).rejects.toMatchObject({ status: 404 })
    await service.deleteFiberRoute('f1')
    expect(repo.delete).toHaveBeenCalledWith('f1')
  })
})
