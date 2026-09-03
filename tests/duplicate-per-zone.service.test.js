import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

/**
 * The same building under two different zones.
 *
 * Two operators can genuinely serve one building, and each needs it in their
 * own zone. What must stay blocked is the same building twice in the SAME
 * zone, which is a real duplicate.
 */
const ZONE = { id: 'z1', name: 'Zone A' }

const build = ({ clash = null } = {}) => {
  const buildingRepository = {
    create: vi.fn(async (data) => ({ id: 'b1', ...data, photos: [] })),
    findByPlaceIdInZone: vi.fn(async () => clash),
    findByPlaceId: vi.fn(async () => null),
  }
  const zoneRepository = { findById: vi.fn(async () => ZONE) }
  return {
    buildingRepository,
    zoneRepository,
    service: createBuildingService({
      buildingRepository,
      zoneRepository,
      storage: { keyFromUrl: () => null, signUrl: (u) => u },
      userRepository: { assignedZoneIds: async () => ['z1', 'z2'] },
    }),
  }
}

const ADMIN = { id: 'a1', role: 'ADMIN' }
const PLACE = {
  buildingName: 'Balaji Heights',
  placeId: 'ChIJplace123',
  latitude: 18.59,
  longitude: 73.74,
  zoneId: 'z1',
}

describe('adding a building that already exists elsewhere', () => {
  it('allows it under a different zone', async () => {
    const { buildingRepository, service } = build({ clash: null })
    await service.createBuilding({ ...PLACE, zoneId: 'z2' }, 'a1', ADMIN)
    expect(buildingRepository.create).toHaveBeenCalled()
  })

  it('checks for a clash in the zone being added to, not globally', async () => {
    const { buildingRepository, service } = build()
    await service.createBuilding({ ...PLACE, zoneId: 'z2' }, 'a1', ADMIN)
    expect(buildingRepository.findByPlaceIdInZone).toHaveBeenCalledWith('ChIJplace123', 'z2')
  })

  it('refuses the same building twice in the SAME zone', async () => {
    const { buildingRepository, service } = build({ clash: { id: 'existing' } })
    await expect(service.createBuilding({ ...PLACE }, 'a1', ADMIN)).rejects.toMatchObject({
      status: 409,
    })
    expect(buildingRepository.create).not.toHaveBeenCalled()
  })

  it('names the zone in the refusal, so the fix is obvious', async () => {
    const { service } = build({ clash: { id: 'existing' } })
    const message = await service.createBuilding({ ...PLACE }, 'a1', ADMIN).catch((e) => e.message)
    expect(message).toContain('Zone A')
  })

  it('does not check at all when there is no Place id', async () => {
    // Bulk imports and manual entries have no placeId and are unconstrained.
    const { buildingRepository, service } = build()
    await service.createBuilding({ ...PLACE, placeId: undefined }, 'a1', ADMIN)
    expect(buildingRepository.findByPlaceIdInZone).not.toHaveBeenCalled()
    expect(buildingRepository.create).toHaveBeenCalled()
  })
})
