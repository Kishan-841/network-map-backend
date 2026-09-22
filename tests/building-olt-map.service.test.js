import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

// Bulk OLT mapping (olt-mapping.md). The rule under test is the zone rule: a
// non-admin may only map buildings that all sit in ONE zone, to an OLT in that
// same zone; an ADMIN may cross zones.
const OLT = { id: 'olt1', name: 'OLT-01', ponPortCount: 16, pop: { zoneId: 'zoneA' } }
const ADMIN = { id: 'a', role: 'ADMIN' }
const SURVEYOR = { id: 's', role: 'SURVEYOR' }

function build({ olt = OLT, rows = [], count, zones = [] } = {}) {
  const repo = {
    findOltWithZone: vi.fn(async () => olt),
    findManyScoped: vi.fn(async () => rows),
    updateMany: vi.fn(async () => ({ count: count ?? rows.length })),
  }
  const service = createBuildingService({
    buildingRepository: repo,
    storage: { keyFromUrl: () => null },
    userRepository: { assignedZoneIds: async () => zones },
  })
  return { repo, service }
}

describe('bulkAssignOlt', () => {
  it('maps buildings in one zone to an OLT in that zone (surveyor)', async () => {
    const { repo, service } = build({ rows: [{ id: 'b1', zoneId: 'zoneA' }, { id: 'b2', zoneId: 'zoneA' }], zones: ['zoneA'] })
    const res = await service.bulkAssignOlt({ ids: ['b1', 'b2'], oltId: 'olt1', ponPort: 12 }, SURVEYOR)
    expect(res).toMatchObject({ count: 2, oltId: 'olt1', ponPort: 12 })
    expect(repo.updateMany).toHaveBeenCalledWith(expect.anything(), { oltId: 'olt1', ponPort: 12 })
  })

  it('refuses when the selected buildings span two zones (non-admin)', async () => {
    const { service } = build({ rows: [{ id: 'b1', zoneId: 'zoneA' }, { id: 'b2', zoneId: 'zoneB' }], zones: ['zoneA', 'zoneB'] })
    await expect(service.bulkAssignOlt({ ids: ['b1', 'b2'], oltId: 'olt1', ponPort: 12 }, SURVEYOR)).rejects.toMatchObject({ status: 400 })
  })

  it('refuses an OLT in a different zone than the buildings (non-admin)', async () => {
    const { service } = build({ olt: { ...OLT, pop: { zoneId: 'zoneB' } }, rows: [{ id: 'b1', zoneId: 'zoneA' }], zones: ['zoneA'] })
    await expect(service.bulkAssignOlt({ ids: ['b1'], oltId: 'olt1', ponPort: 12 }, SURVEYOR)).rejects.toMatchObject({ status: 400 })
  })

  it('lets an ADMIN cross zones', async () => {
    const { service } = build({ rows: [{ id: 'b1', zoneId: 'zoneA' }, { id: 'b2', zoneId: 'zoneB' }] })
    const res = await service.bulkAssignOlt({ ids: ['b1', 'b2'], oltId: 'olt1', ponPort: 12 }, ADMIN)
    expect(res.count).toBe(2)
  })

  it('rejects a PON port beyond the OLT port count', async () => {
    const { service } = build({ rows: [{ id: 'b1', zoneId: 'zoneA' }] })
    await expect(service.bulkAssignOlt({ ids: ['b1'], oltId: 'olt1', ponPort: 99 }, ADMIN)).rejects.toMatchObject({ status: 400 })
  })

  it('rejects an unknown OLT', async () => {
    const { service } = build({ olt: null })
    await expect(service.bulkAssignOlt({ ids: ['b1'], oltId: 'nope', ponPort: 1 }, ADMIN)).rejects.toMatchObject({ status: 400 })
  })

  it('rejects when none of the buildings are visible to the actor', async () => {
    const { service } = build({ rows: [] })
    await expect(service.bulkAssignOlt({ ids: ['b1'], oltId: 'olt1', ponPort: 1 }, ADMIN)).rejects.toMatchObject({ status: 400 })
  })
})
