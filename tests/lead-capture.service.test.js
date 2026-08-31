import { describe, it, expect, vi } from 'vitest'
import { createLeadCaptureService } from '../src/modules/leads/lead-capture.service.js'

const live = {
  id: 'b1', placeId: 'place-live', buildingName: 'Sunrise Heights',
  formattedAddress: '12 Baner Road', latitude: 18.52, longitude: 73.85,
  isLive: true, feasibleStatus: 'FEASIBLE', details: { homePass: 300 },
  zone: { name: 'Zone A' }, createdBy: { name: 'Rahul' },
}
const surveyed = { ...live, id: 'b2', placeId: 'place-soon', isLive: false, buildingName: 'Pending Towers' }

const svc = (buildings) =>
  createLeadCaptureService({
    buildingRepository: {
      findByPlaceId: vi.fn(async (id) => buildings.find((b) => b.placeId === id) ?? null),
      findWithinBounds: vi.fn(async () => buildings),
    },
  })

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
  const partner = { id: 'p1', status: 'APPROVED', onboardedById: 'e1' }
  const base = {
    customerName: 'Ravi', customerMobile: '9812345678', requirementMbps: 200,
    placeId: 'place-live', placeName: 'Sunrise Heights', address: '12 Baner Road',
    latitude: 18.52, longitude: 73.85,
  }

  const capture = (buildings, existing = null) => {
    const leadRepository = {
      create: vi.fn(async (d) => ({ id: 'l1', status: 'NEW', ...d })),
      findOpenByMobile: vi.fn(async () => existing),
      recordEvent: vi.fn(async () => {}),
    }
    const service = createLeadCaptureService({
      buildingRepository: {
        findByPlaceId: vi.fn(async (id) => buildings.find((b) => b.placeId === id) ?? null),
        findWithinBounds: vi.fn(async () => buildings),
      },
      leadRepository,
    })
    return { leadRepository, service }
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
