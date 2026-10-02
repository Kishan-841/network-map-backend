import { describe, it, expect, vi } from 'vitest'
import { createLeadCaptureService } from '../src/modules/leads/lead-capture.service.js'
import { buildingRepository as realBuildingRepository } from '../src/modules/buildings/building.repository.js'

const live = {
  id: 'b1', placeId: 'place-live', buildingName: 'Sunrise Heights',
  formattedAddress: '12 Baner Road', latitude: 18.52, longitude: 73.85,
  isLive: true, feasibleStatus: 'FEASIBLE', details: { homePass: 300 },
  zone: { name: 'Zone A' }, createdBy: { name: 'Rahul' },
}
const surveyed = { ...live, id: 'b2', placeId: 'place-soon', isLive: false, buildingName: 'Pending Towers' }

/**
 * Mirrors the real repository's contract, including searchForPartner's `id`
 * branch — which in the real one is scoped to the coverage registry. A
 * building not in `buildings` stands in for one partners cannot see.
 */
const fakeBuildings = (buildings) => ({
  findByPlaceId: vi.fn(async (id) => buildings.find((b) => b.placeId === id) ?? null),
  findWithinBounds: vi.fn(async () => buildings),
  searchForPartner: vi.fn(async (_query, _take, id) => buildings.filter((b) => b.id === id)),
})

const svc = (buildings) => createLeadCaptureService({ buildingRepository: fakeBuildings(buildings) })

const capture = (buildings, existing = null) => {
  const leadRepository = {
    create: vi.fn(async (d) => ({ id: 'l1', status: 'NEW', ...d })),
    findOpenByMobile: vi.fn(async () => existing),
    recordEvent: vi.fn(async () => {}),
  }
  const buildingRepository = fakeBuildings(buildings)
  const service = createLeadCaptureService({ buildingRepository, leadRepository })
  return { leadRepository, buildingRepository, service }
}

const partner = { id: 'p1', status: 'APPROVED', onboardedById: 'e1' }

const at = (b) => ({ placeId: b.placeId, latitude: b.latitude, longitude: b.longitude })

describe('the building signal', () => {
  it('is LIVE for a building we serve today', async () => {
    expect((await svc([live]).matchPlace(at(live))).match).toBe('LIVE')
  })

  it('is IN_REGISTRY for one we have surveyed but not lit', async () => {
    // The amber case. Three states exist even though only two were described:
    // "coming soon" is true, and a better thing for a partner to say.
    expect((await svc([surveyed]).matchPlace(at(surveyed))).match).toBe('IN_REGISTRY')
  })

  it('is NOT_FOUND when we hold nothing there', async () => {
    expect((await svc([]).matchPlace({ latitude: 1, longitude: 1 })).match).toBe('NOT_FOUND')
  })

  it('prefers a LIVE building over a nearer unlit one', async () => {
    const near = { ...surveyed, latitude: 18.5200, longitude: 73.8500 }
    const far = { ...live, latitude: 18.5203, longitude: 73.8500 }
    const out = await svc([near, far]).matchPlace({ latitude: 18.52, longitude: 73.85 })
    expect(out.match).toBe('LIVE')
  })

  it('tells the caller nothing about the building beyond the verdict', async () => {
    const out = await svc([live]).matchPlace(at(live))
    expect(Object.keys(out).sort()).toEqual(['buildingId', 'match'])
    // buildingId is for the SERVER to link the lead; it never reaches a client
    // response — the route strips it.
    const forClient = { match: out.match }
    for (const secret of ['Sunrise', 'Baner', 'Zone A', '300', 'Rahul']) {
      expect(JSON.stringify(forClient)).not.toContain(secret)
    }
  })
})

describe('capturing the lead', () => {
  const base = {
    customerName: 'Ravi', customerMobile: '9812345678', requirementMbps: 200,
    placeId: 'place-live', placeName: 'Sunrise Heights', address: '12 Baner Road',
    latitude: 18.52, longitude: 73.85,
  }

  it('links the building when we know it', async () => {
    const { leadRepository, service } = capture([live])
    await service.capture(base, partner)
    expect(leadRepository.create.mock.calls[0][0].buildingId).toBe('b1')
    expect(leadRepository.create.mock.calls[0][0].buildingMatch).toBe('LIVE')
  })

  it('STILL captures the lead when the building is unknown to us', async () => {
    const { leadRepository, service } = capture([])
    const out = await service.capture({ ...base, placeId: 'place-nowhere' }, partner)
    expect(out.id).toBe('l1')
    const saved = leadRepository.create.mock.calls[0][0]
    expect(saved.buildingId).toBeNull()
    expect(saved.buildingMatch).toBe('NOT_FOUND')
  })

  it('keeps what they searched for, so an unmatched building is not lost', async () => {
    const { leadRepository, service } = capture([])
    await service.capture({ ...base, placeId: 'place-nowhere', placeName: 'Hopeful Society' }, partner)
    const saved = leadRepository.create.mock.calls[0][0]
    expect(saved.searchedPlaceId).toBe('place-nowhere')
    expect(saved.searchedPlaceName).toBe('Hopeful Society')
  })

  it('records what speed they asked for', async () => {
    const { leadRepository, service } = capture([live])
    await service.capture(base, partner)
    expect(leadRepository.create.mock.calls[0][0].requirementMbps).toBe(200)
  })

  it('refuses a partner who is not approved', async () => {
    const { service } = capture([live])
    await expect(
      service.capture(base, { ...partner, status: 'PENDING_APPROVAL' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('does NOT trust a match the client claims', async () => {
    // Now that buildingId IS accepted, this is the case it must survive: an id
    // the server cannot find links nothing, and the claimed verdict is ignored.
    const { leadRepository, service } = capture([])
    await service.capture({ ...base, buildingMatch: 'LIVE', buildingId: 'b1' }, partner)
    const saved = leadRepository.create.mock.calls[0][0]
    expect(saved.buildingMatch).toBe('NOT_FOUND')
    expect(saved.buildingId).toBeNull()
  })

  it('marks a repeat customer as a duplicate without naming the other partner', async () => {
    const { service } = capture([live], { id: 'l0', partnerId: 'rival-partner' })
    const out = await service.capture(base, partner)
    expect(out.status).toBe('DUPLICATE')
    expect(JSON.stringify(out)).not.toContain('rival-partner')
  })
})

describe('a building picked from our own search (PRD §6.1)', () => {
  // What the app sends: the pick, and no coordinates at all.
  const pick = (buildingId) => ({ customerName: 'Ravi', customerMobile: '9812345678', buildingId })

  it('links the lead to the building the partner picked', async () => {
    const { leadRepository, service } = capture([live])
    await service.capture(pick('b1'), partner)
    const saved = leadRepository.create.mock.calls[0][0]
    expect(saved.buildingId).toBe('b1')
    expect(saved.buildingMatch).toBe('LIVE')
  })

  it('says coming soon for a picked building we have not lit yet', async () => {
    const { leadRepository, service } = capture([surveyed])
    await service.capture(pick('b2'), partner)
    expect(leadRepository.create.mock.calls[0][0].buildingMatch).toBe('IN_REGISTRY')
  })

  it('looks the pick up through the same scoped method partner search uses', async () => {
    // searchForPartner's id branch is restricted to the coverage registry, so
    // guessing the id of an acquisition-side building links nothing.
    const { buildingRepository, service } = capture([live])
    await service.capture(pick('b1'), partner)
    expect(buildingRepository.searchForPartner).toHaveBeenCalledWith(null, 1, 'b1')
  })

  it('links nothing for an id partners cannot see — and still keeps the lead', async () => {
    const { leadRepository, service } = capture([live])
    const out = await service.capture(pick('acquisition-only-building'), partner)
    expect(out.id).toBe('l1')
    const saved = leadRepository.create.mock.calls[0][0]
    expect(saved.buildingId).toBeNull()
    expect(saved.buildingMatch).toBe('NOT_FOUND')
  })

  it('trusts the explicit pick over coordinate guessing', async () => {
    // The partner named the building. A LIVE neighbour found by proximity must
    // not overrule what they actually chose.
    const { leadRepository, service } = capture([surveyed, live])
    await service.capture({ ...pick('b2'), latitude: live.latitude, longitude: live.longitude }, partner)
    const saved = leadRepository.create.mock.calls[0][0]
    expect(saved.buildingId).toBe('b2')
    expect(saved.buildingMatch).toBe('IN_REGISTRY')
  })

  it('relies on a method the REAL repository actually has', () => {
    // Fakes that satisfied a contract the real repository did not have have
    // shipped 500s three times in this project. This one checks the real one.
    expect(typeof realBuildingRepository.searchForPartner).toBe('function')
  })
})
