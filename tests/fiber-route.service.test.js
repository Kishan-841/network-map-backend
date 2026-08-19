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

describe('fiber route schema', () => {
  it('accepts trunk + branch segments and defaults color', () => {
    const parsed = createFiberRouteSchema.safeParse({ name: 'Wakad trunk', segments: SEGMENTS })
    expect(parsed.success).toBe(true)
  })

  it('rejects a 1-point segment, empty segments, and bad colors', () => {
    expect(
      createFiberRouteSchema.safeParse({
        name: 'X',
        segments: [[{ latitude: 1, longitude: 1 }]],
      }).success,
    ).toBe(false)
    expect(createFiberRouteSchema.safeParse({ name: 'X', segments: [] }).success).toBe(false)
    expect(
      createFiberRouteSchema.safeParse({ name: 'X', segments: SEGMENTS, color: 'red' }).success,
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

describe('fiber route service', () => {
  it('creates a route', async () => {
    const repo = fakeRepo()
    const service = createFiberRouteService({ fiberRouteRepository: repo })
    const created = await service.createFiberRoute({ name: 'Trunk 2', segments: SEGMENTS })
    expect(repo.create).toHaveBeenCalledWith({ name: 'Trunk 2', segments: SEGMENTS })
    expect(created.id).toBe('new')
  })

  it('409s a duplicate name; renaming onto another route also 409s', async () => {
    const clash = fakeRepo({ existing: { id: 'OTHER', name: 'trunk' } })
    const service = createFiberRouteService({ fiberRouteRepository: clash })
    await expect(
      service.createFiberRoute({ name: 'Trunk', segments: SEGMENTS }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(service.updateFiberRoute('f1', { name: 'Trunk' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('404s update/delete of unknown routes; delete works on known ones', async () => {
    const repo = fakeRepo()
    const service = createFiberRouteService({ fiberRouteRepository: repo })
    await expect(service.updateFiberRoute('nope', { name: 'X' })).rejects.toMatchObject({
      status: 404,
    })
    await expect(service.deleteFiberRoute('nope')).rejects.toMatchObject({ status: 404 })
    await service.deleteFiberRoute('f1')
    expect(repo.delete).toHaveBeenCalledWith('f1')
  })
})
