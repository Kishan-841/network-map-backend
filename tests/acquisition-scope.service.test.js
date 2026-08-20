import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

const AGENT = { id: 'ag1', role: 'ACQUISITION_AGENT' }
const LEAD = { id: 'ld1', role: 'ACQUISITION_LEAD' }
const ADMIN = { id: 'ad1', role: 'ADMIN' }

const CONTACT = {
  contactName: 'R. Sharma',
  contactPhone: '9876543210',
  designation: 'SECRETARY',
}
const PHOTOS = [
  { type: 'SELFIE', url: '/uploads/selfie.jpg' },
  { type: 'CONTACT_PERSON', url: '/uploads/contact.jpg' },
]
const INPUT = (over = {}) => ({
  buildingName: 'Shanti Residency',
  formattedAddress: '12 MG Road',
  latitude: 18.52,
  longitude: 73.85,
  pincode: '411014',
  contact: CONTACT,
  photos: PHOTOS,
  ...over,
})

function makeService({ pincodes = [{ pincode: '411014', cityId: 'c1' }] } = {}) {
  let lastWhere = null
  const created = []
  const service = createBuildingService({
    buildingRepository: {
      create: vi.fn(async (data) => {
        created.push(data)
        return { id: 'b1', ...data }
      }),
      list: async (where) => ((lastWhere = where), []),
      count: async () => 0,
      findById: async (id) =>
        id === 'own'
          ? { id, createdById: AGENT.id, source: 'ACQUISITION', zoneId: null }
          : id === 'other-agent'
            ? { id, createdById: 'ag2', source: 'ACQUISITION', zoneId: null }
            : { id, createdById: 'surv', source: 'COVERAGE', zoneId: 'z1' },
    },
    storage: { keyFromUrl: () => 'k' },
    userRepository: {
      assignedPincodes: async () => pincodes,
      assignedZoneIds: async () => [],
    },
  })
  return { service, created, whereUsed: () => lastWhere }
}

describe('acquisition agent — creating a building', () => {
  it('stores city+pincode from the assignment, no zone, source ACQUISITION', async () => {
    const { service, created } = makeService()
    await service.createBuilding(INPUT(), AGENT.id, AGENT)
    expect(created[0]).toMatchObject({
      pincode: '411014',
      cityId: 'c1',
      zoneId: null,
      source: 'ACQUISITION',
      createdById: AGENT.id,
    })
    expect(created[0].contact.create).toEqual(CONTACT)
  })

  it('requires contact details, a selfie, and a contact photo', async () => {
    const { service } = makeService()
    await expect(
      service.createBuilding(INPUT({ contact: undefined }), AGENT.id, AGENT),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      service.createBuilding(
        INPUT({ photos: [{ type: 'CONTACT_PERSON', url: '/uploads/c.jpg' }] }),
        AGENT.id,
        AGENT,
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      service.createBuilding(
        INPUT({ photos: [{ type: 'SELFIE', url: '/uploads/s.jpg' }] }),
        AGENT.id,
        AGENT,
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('403s a pincode outside the agent assignment, and when none are assigned', async () => {
    const { service } = makeService()
    await expect(
      service.createBuilding(INPUT({ pincode: '400001' }), AGENT.id, AGENT),
    ).rejects.toMatchObject({ status: 403 })
    const empty = makeService({ pincodes: [] })
    await expect(empty.service.createBuilding(INPUT(), AGENT.id, AGENT)).rejects.toMatchObject({
      status: 403,
    })
  })

  it('rejects contact details from non-acquisition roles', async () => {
    const { service } = makeService()
    await expect(
      service.createBuilding(INPUT({ zoneId: 'z1' }), ADMIN.id, ADMIN),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('acquisition visibility', () => {
  it('agent list is restricted to their own acquisition rows', async () => {
    const { service, whereUsed } = makeService()
    await service.listBuildings({}, AGENT)
    expect(whereUsed()).toMatchObject({ createdById: AGENT.id, source: 'ACQUISITION' })
  })

  it('lead list covers all acquisition rows and never coverage rows', async () => {
    const { service, whereUsed } = makeService()
    await service.listBuildings({}, LEAD)
    expect(whereUsed().source).toBe('ACQUISITION')
    expect(whereUsed().createdById).toBeUndefined()
  })

  it('coverage roles never receive acquisition rows by default', async () => {
    const { service, whereUsed } = makeService()
    await service.listBuildings({}, ADMIN)
    expect(whereUsed().source).toBe('COVERAGE')
  })

  it('agent may open only their own building; lead only acquisition ones', async () => {
    const { service } = makeService()
    await expect(service.getBuilding('own', AGENT)).resolves.toMatchObject({ id: 'own' })
    await expect(service.getBuilding('other-agent', AGENT)).rejects.toMatchObject({ status: 404 })
    await expect(service.getBuilding('coverage-row', LEAD)).rejects.toMatchObject({ status: 404 })
    await expect(service.getBuilding('other-agent', LEAD)).resolves.toBeTruthy()
  })
})
