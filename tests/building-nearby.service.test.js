import { describe, it, expect } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

const near = {
  id: 'b1',
  placeId: 'way:1',
  buildingName: 'Sunrise Apartments',
  latitude: 19.0761,
  longitude: 72.8777,
}
const far = {
  id: 'b2',
  placeId: 'way:2',
  buildingName: 'Distant Tower',
  latitude: 19.09,
  longitude: 72.9,
}

function fakeRepo(buildings) {
  return {
    findWithinBounds: async (box) =>
      buildings.filter(
        (b) =>
          b.latitude >= box.minLat &&
          b.latitude <= box.maxLat &&
          b.longitude >= box.minLon &&
          b.longitude <= box.maxLon,
      ),
    findByPlaceId: async (placeId) => buildings.find((b) => b.placeId === placeId) ?? null,
  }
}

describe('building service findNearby', () => {
  it('returns buildings within radius with integer distance, sorted ascending', async () => {
    const service = createBuildingService({ buildingRepository: fakeRepo([near, far]) })
    const results = await service.findNearby({
      latitude: 19.076,
      longitude: 72.8777,
      radiusMeters: 100,
    })
    expect(results.map((r) => r.id)).toEqual(['b1'])
    expect(results[0].distanceMeters).toBeGreaterThan(0)
    expect(results[0].distanceMeters).toBeLessThan(50)
    expect(Number.isInteger(results[0].distanceMeters)).toBe(true)
  })

  it('flags similar names', async () => {
    const service = createBuildingService({ buildingRepository: fakeRepo([near]) })
    const results = await service.findNearby({
      latitude: 19.076,
      longitude: 72.8777,
      radiusMeters: 100,
      name: 'Sunrise Apartment',
    })
    expect(results[0].similarName).toBe(true)
  })

  it('flags an exact placeId match even outside the radius', async () => {
    const service = createBuildingService({ buildingRepository: fakeRepo([far]) })
    const results = await service.findNearby({
      latitude: 19.076,
      longitude: 72.8777,
      radiusMeters: 100,
      placeId: 'way:2',
    })
    expect(results).toHaveLength(1)
    expect(results[0].samePlaceId).toBe(true)
  })

  it('returns empty array when nothing is close', async () => {
    const service = createBuildingService({ buildingRepository: fakeRepo([far]) })
    const results = await service.findNearby({
      latitude: 19.076,
      longitude: 72.8777,
      radiusMeters: 100,
    })
    expect(results).toEqual([])
  })
})
