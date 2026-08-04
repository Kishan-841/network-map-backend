import { describe, it, expect } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

const own = {
  id: 'b1',
  createdById: 'u-surv',
  buildingName: 'Mine',
  latitude: 18.5,
  longitude: 73.8,
  placeId: null,
}
const foreign = {
  id: 'b2',
  createdById: 'u-other',
  buildingName: 'Theirs',
  latitude: 18.5001,
  longitude: 73.8001,
  placeId: null,
}

function makeService({ buildings = [own, foreign], assigned = ['z1'] } = {}) {
  let lastWhere = null
  const service = createBuildingService({
    buildingRepository: {
      list: async (where) => {
        lastWhere = where
        return buildings.filter((b) => !where.createdById || b.createdById === where.createdById)
      },
      count: async () => buildings.length,
      findById: async (id) => buildings.find((b) => b.id === id) ?? null,
      findWithinBounds: async () => buildings,
      findByPlaceId: async () => null,
      create: async (data) => ({ id: 'new', ...data }),
      createPhoto: async (data) => data,
    },
    storage: { keyFromUrl: () => 'key' },
    userRepository: { assignedZoneIds: async () => assigned },
  })
  return { service, whereUsed: () => lastWhere }
}

const surveyor = { id: 'u-surv', role: 'SURVEYOR' }
const admin = { id: 'u-a', role: 'ADMIN' }

describe('building scoping', () => {
  it('forces createdById for surveyors even when the param says otherwise', async () => {
    const { service, whereUsed } = makeService()
    await service.listBuildings({ createdById: 'u-other' }, surveyor)
    expect(whereUsed().createdById).toBe('u-surv')
  })

  it('does not scope admins', async () => {
    const { service, whereUsed } = makeService()
    await service.listBuildings({}, admin)
    expect(whereUsed().createdById).toBeUndefined()
  })

  it('404s surveyor access to a foreign building', async () => {
    const { service } = makeService()
    await expect(service.getBuilding('b2', surveyor)).rejects.toMatchObject({ status: 404 })
    await expect(service.getBuilding('b2', admin)).resolves.toMatchObject({ id: 'b2' })
  })

  it('403s creation outside assigned zones', async () => {
    const { service } = makeService({ assigned: ['z1'] })
    const input = {
      buildingName: 'X',
      formattedAddress: 'A',
      latitude: 1,
      longitude: 1,
      zoneId: 'z9',
    }
    await expect(service.createBuilding(input, 'u-surv', surveyor)).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      service.createBuilding({ ...input, zoneId: 'z1' }, 'u-surv', surveyor),
    ).resolves.toMatchObject({ id: 'new' })
  })

  it('403s a surveyor setting permission details or a permission letter at create', async () => {
    const { service } = makeService()
    const input = {
      buildingName: 'X',
      formattedAddress: 'A',
      latitude: 1,
      longitude: 1,
      zoneId: 'z1',
    }
    await expect(
      service.createBuilding({ ...input, permission: { amountPaid: 5000 } }, 'u-surv', surveyor),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      service.createBuilding(
        { ...input, photos: [{ type: 'PERMISSION_LETTER', url: 'u' }] },
        'u-surv',
        surveyor,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('lets a surveyor delete a photo on their own building but not a foreign one', async () => {
    const buildings = [
      { ...own, photos: [] },
      { ...foreign, photos: [] },
    ]
    const service = createBuildingService({
      buildingRepository: {
        findById: async (id) => buildings.find((b) => b.id === id) ?? null,
        findPhotoById: async (photoId) =>
          photoId === 'own-photo'
            ? { id: 'own-photo', buildingId: 'b1', type: 'ENTRANCE', url: '/uploads/x.jpg' }
            : { id: 'foreign-photo', buildingId: 'b2', type: 'ENTRANCE', url: '/uploads/y.jpg' },
        deletePhoto: async () => {},
      },
      storage: { keyFromUrl: () => null },
      userRepository: { assignedZoneIds: async () => [] },
    })
    await expect(service.removePhoto('b1', 'own-photo', surveyor)).resolves.toBeUndefined()
    await expect(service.removePhoto('b2', 'foreign-photo', surveyor)).rejects.toMatchObject({
      status: 403,
    })
  })

  it('403s photo add on a foreign building for surveyors', async () => {
    const { service } = makeService()
    await expect(
      service.addPhoto('b2', { type: 'ENTRANCE', url: 'u' }, surveyor),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('masks foreign building names in nearby results for surveyors only', async () => {
    const { service } = makeService()
    const forSurveyor = await service.findNearby(
      { latitude: 18.5, longitude: 73.8, radiusMeters: 500, name: 'Mine' },
      surveyor,
    )
    expect(forSurveyor.find((b) => b.id === 'b1').buildingName).toBe('Mine')
    expect(forSurveyor.find((b) => b.id === 'b2').buildingName).toBeNull()
    const forAdmin = await service.findNearby(
      { latitude: 18.5, longitude: 73.8, radiusMeters: 500 },
      admin,
    )
    expect(forAdmin.find((b) => b.id === 'b2').buildingName).toBe('Theirs')
  })

  it('strips ALL sensitive fields of foreign buildings for surveyors (only masks name)', async () => {
    const richForeign = {
      ...foreign,
      formattedAddress: '123 Secret St',
      zoneId: 'z-secret',
      zone: { id: 'z-secret', name: 'Secret Zone' },
      details: { floors: 42, homePass: 999, remarks: 'confidential' },
      feasibleStatus: 'FEASIBLE',
    }
    const { service } = makeService({ buildings: [own, richForeign] })
    const forSurveyor = await service.findNearby(
      { latitude: 18.5, longitude: 73.8, radiusMeters: 500, name: 'Mine' },
      surveyor,
    )
    const masked = forSurveyor.find((b) => b.id === 'b2')
    // Only distance + duplicate-signal fields survive; everything else is gone.
    expect(masked.buildingName).toBeNull()
    expect(masked.formattedAddress ?? null).toBeNull()
    expect(masked.zone).toBeUndefined()
    expect(masked.details).toBeUndefined()
    expect(masked.latitude).toBeUndefined()
    expect(masked.createdById).toBeUndefined()
    expect(masked.feasibleStatus).toBeUndefined()
    // Duplicate detection still works.
    expect(typeof masked.distanceMeters).toBe('number')
    expect(masked).toHaveProperty('samePlaceId')

    // Own building keeps everything.
    const ownResult = forSurveyor.find((b) => b.id === 'b1')
    expect(ownResult.buildingName).toBe('Mine')
    expect(ownResult.latitude).toBe(18.5)
  })
})
