import { describe, it, expect, vi } from 'vitest'
import { createSalesService } from '../src/modules/sales/sales.service.js'

/**
 * Sales selfies and meeting photos leave the API as short-lived signed links,
 * like building photos and partner documents — so they still show once the
 * bucket is private. The database keeps the permanent link.
 */
const STORED_SELFIE = 'https://pub.example.r2.dev/2026/09/selfie.jpg'
const STORED_PHOTO = 'https://pub.example.r2.dev/2026/09/meeting.jpg'
const storage = { readUrl: vi.fn(async (u) => `${u}?X-Amz-Signature=sig`) }
const visit = { id: 'v1', userId: 'u1', selfieUrl: STORED_SELFIE, checkOutAt: null }
const meeting = { id: 'm1', teamLeaderId: 'u1', photoUrl: STORED_PHOTO }

const repo = {
  openVisitFor: vi.fn(async () => visit),
  listVisits: vi.fn(async () => [visit, { ...visit, id: 'v2', selfieUrl: null }]),
  getVisit: vi.fn(async () => visit),
  ownedVisit: vi.fn(async () => visit),
  checkoutVisit: vi.fn(async () => ({ ...visit, checkOutAt: new Date() })),
  existingMeeting: vi.fn(async () => null),
  createMeeting: vi.fn(async () => meeting),
  countMeetings: vi.fn(async () => 1),
  listMeetings: vi.fn(async () => [meeting]),
}
const admin = { id: 'a1', role: 'ADMIN' }
const svc = createSalesService({ repo, storage })
const signed = (u) => `${u}?X-Amz-Signature=sig`

describe('sales photos leave the API signed', () => {
  it('the open visit', async () => {
    expect((await svc.openVisit(admin)).selfieUrl).toBe(signed(STORED_SELFIE))
  })
  it('a visit in full', async () => {
    expect((await svc.getVisit('v1', admin)).selfieUrl).toBe(signed(STORED_SELFIE))
  })
  it('every visit in a list, and a visit without a selfie stays empty', async () => {
    const rows = await svc.listVisits(admin)
    expect(rows[0].selfieUrl).toBe(signed(STORED_SELFIE))
    expect(rows[1].selfieUrl).toBeNull()
  })
  it('a visit just checked out', async () => {
    expect((await svc.checkOut('v1', { checkOutLat: 1, checkOutLng: 2 }, { id: 'u1', role: 'SALES_EXECUTIVE' })).selfieUrl).toBe(signed(STORED_SELFIE))
  })
  it('a meeting just logged, and every meeting in the list', async () => {
    expect((await svc.createMeeting({ id: 'u1', role: 'TEAM_LEADER' }, { photoUrl: STORED_PHOTO, latitude: 1, longitude: 2 })).photoUrl).toBe(signed(STORED_PHOTO))
    const { items } = await svc.listMeetings(admin)
    expect(items[0].photoUrl).toBe(signed(STORED_PHOTO))
  })
  it('no visit open → null, not a crash', async () => {
    const quiet = createSalesService({ repo: { ...repo, openVisitFor: vi.fn(async () => null) }, storage })
    expect(await quiet.openVisit(admin)).toBeNull()
  })
})

describe('sales photos are SAVED in their permanent form', () => {
  // A page that sent back the signed preview link must not store a link that
  // dies in an hour — it is turned back into the permanent one.
  const SIGNED = `${STORED_SELFIE}?X-Amz-Signature=sig`
  const store = {
    readUrl: async (u) => u,
    canonicalUrl: vi.fn((u) => u.split('?')[0]),
  }

  it('the check-in selfie', async () => {
    const createVisit = vi.fn(async (d) => ({ id: 'v9', ...d }))
    const s = createSalesService({
      storage: store,
      repo: {
        openVisitFor: vi.fn(async () => null),
        listBuildings: vi.fn(async () => [{ id: 'b1', buildingName: 'B1', formattedAddress: 'Road' }]),
        createVisit,
      },
    })
    await s.checkIn({ buildingId: 'b1', checkInLat: 1, checkInLng: 2, selfieUrl: SIGNED }, admin)
    expect(createVisit.mock.calls[0][0].selfieUrl).toBe(STORED_SELFIE)
  })

  it('the meeting photo', async () => {
    const createMeeting = vi.fn(async (d) => ({ id: 'm9', ...d }))
    const s = createSalesService({
      storage: store,
      repo: { existingMeeting: vi.fn(async () => null), createMeeting },
    })
    await s.createMeeting({ id: 'u1', role: 'TEAM_LEADER' }, { photoUrl: `${STORED_PHOTO}?X-Amz-Signature=sig`, latitude: 1, longitude: 2 })
    expect(createMeeting.mock.calls[0][0].photoUrl).toBe(STORED_PHOTO)
  })
})
