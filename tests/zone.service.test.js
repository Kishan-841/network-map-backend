import { describe, it, expect, vi } from 'vitest'
import { createZoneService } from '../src/modules/zones/zone.service.js'

function fakeZoneRepository({ zones = [], buildingCount = 0 } = {}) {
  const store = [...zones]
  return {
    store,
    findById: vi.fn(async (id) => store.find((z) => z.id === id) ?? null),
    findByName: vi.fn(async (name) => store.find((z) => z.name === name) ?? null),
    create: vi.fn(async (data) => {
      const zone = { id: `z-${store.length + 1}`, ...data }
      store.push(zone)
      return zone
    }),
    update: vi.fn(async (id, data) => {
      const zone = store.find((z) => z.id === id)
      Object.assign(zone, data)
      return zone
    }),
    delete: vi.fn(async (id) => {
      store.splice(store.findIndex((z) => z.id === id), 1)
    }),
    countBuildings: vi.fn(async () => buildingCount),
  }
}

describe('zone service', () => {
  it('creates a zone', async () => {
    const repo = fakeZoneRepository()
    const service = createZoneService({ zoneRepository: repo })
    const zone = await service.createZone({ name: 'Zone C', city: 'Metropolis' })
    expect(zone.id).toBe('z-1')
    expect(repo.create).toHaveBeenCalledWith({ name: 'Zone C', city: 'Metropolis' })
  })

  it('passes a polygon boundary through on create', async () => {
    const repo = fakeZoneRepository()
    const service = createZoneService({ zoneRepository: repo })
    const boundary = [
      { latitude: 18.6, longitude: 73.75 },
      { latitude: 18.61, longitude: 73.76 },
      { latitude: 18.59, longitude: 73.77 },
    ]
    await service.createZone({ name: 'Zone D', city: 'Metropolis', boundary })
    expect(repo.create).toHaveBeenCalledWith({ name: 'Zone D', city: 'Metropolis', boundary })
  })

  it('409s on a duplicate zone name', async () => {
    const repo = fakeZoneRepository({ zones: [{ id: 'z1', name: 'Zone A', city: 'X' }] })
    const service = createZoneService({ zoneRepository: repo })
    await expect(service.createZone({ name: 'Zone A', city: 'Y' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('404s when updating a missing zone', async () => {
    const service = createZoneService({ zoneRepository: fakeZoneRepository() })
    await expect(service.updateZone('nope', { name: 'New' })).rejects.toMatchObject({ status: 404 })
  })

  it('updates an existing zone', async () => {
    const repo = fakeZoneRepository({ zones: [{ id: 'z1', name: 'Zone A', city: 'X' }] })
    const service = createZoneService({ zoneRepository: repo })
    const zone = await service.updateZone('z1', { city: 'Newtown' })
    expect(zone.city).toBe('Newtown')
  })

  it('deletes a zone with no buildings', async () => {
    const repo = fakeZoneRepository({ zones: [{ id: 'z1', name: 'Zone A', city: 'X' }] })
    const service = createZoneService({ zoneRepository: repo })
    await service.deleteZone('z1')
    expect(repo.delete).toHaveBeenCalledWith('z1')
  })

  it('409s when deleting a zone that still has buildings', async () => {
    const repo = fakeZoneRepository({
      zones: [{ id: 'z1', name: 'Zone A', city: 'X' }],
      buildingCount: 3,
    })
    const service = createZoneService({ zoneRepository: repo })
    await expect(service.deleteZone('z1')).rejects.toMatchObject({ status: 409 })
    expect(repo.delete).not.toHaveBeenCalled()
  })
})
