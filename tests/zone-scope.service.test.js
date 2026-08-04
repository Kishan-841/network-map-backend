import { describe, it, expect } from 'vitest'
import { createZoneService } from '../src/modules/zones/zone.service.js'

const allZones = [{ id: 'z1' }, { id: 'z2' }, { id: 'z3' }]
const repo = {
  list: async () => allZones,
  listAssigned: async (userId) => (userId === 'u-surv' ? [allZones[1]] : []),
}

describe('listZones scoping', () => {
  it('returns all zones for ADMIN and MANAGER', async () => {
    const service = createZoneService({ zoneRepository: repo })
    expect(await service.listZones({ id: 'u-a', role: 'ADMIN' })).toHaveLength(3)
    expect(await service.listZones({ id: 'u-m', role: 'MANAGER' })).toHaveLength(3)
  })

  it('returns only assigned zones for SURVEYOR', async () => {
    const service = createZoneService({ zoneRepository: repo })
    const zones = await service.listZones({ id: 'u-surv', role: 'SURVEYOR' })
    expect(zones).toEqual([{ id: 'z2' }])
  })
})
