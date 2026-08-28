import { describe, it, expect, vi } from 'vitest'
import { createFeasibilityService } from '../src/modules/partners/feasibility.service.js'

const live = {
  id: 'b1', placeId: 'place-1', buildingName: 'Sunrise Heights',
  formattedAddress: '12 Baner Road', latitude: 18.52, longitude: 73.85,
  isLive: true, feasibleStatus: 'FEASIBLE',
  details: { homePass: 120 }, zone: { name: 'Zone A' },
  createdBy: { name: 'Rahul Surveyor' },
}
const notLive = { ...live, id: 'b2', placeId: 'place-2', isLive: false, buildingName: 'Pending Towers' }

const svc = (buildings, demand) =>
  createFeasibilityService({
    buildingRepository: {
      findByPlaceId: vi.fn(async (id) => buildings.find((b) => b.placeId === id) ?? null),
      findWithinBounds: vi.fn(async () => buildings),
    },
    demandRepository: demand,
  })

const at = (b) => ({ placeId: b.placeId, latitude: b.latitude, longitude: b.longitude, name: b.buildingName })

describe('the verdict', () => {
  it('is SERVICEABLE for a building we already serve', async () => {
    expect((await svc([live]).check(at(live), 'p1')).verdict).toBe('SERVICEABLE')
  })

  it('is NOT_SERVICEABLE for one we hold but do not serve', async () => {
    expect((await svc([notLive]).check(at(notLive), 'p1')).verdict).toBe('NOT_SERVICEABLE')
  })

  it('is NOT_SURVEYED when we hold nothing there', async () => {
    const out = await svc([]).check({ latitude: 1, longitude: 1, name: 'Nowhere' }, 'p1')
    expect(out.verdict).toBe('NOT_SURVEYED')
  })

  it('matches on proximity when there is no placeId', async () => {
    const out = await svc([live]).check({ latitude: 18.5201, longitude: 73.8501 }, 'p1')
    expect(out.verdict).toBe('SERVICEABLE')
  })

  it('does not match a building streets away', async () => {
    const out = await svc([live]).check({ latitude: 18.60, longitude: 73.95 }, 'p1')
    expect(out.verdict).toBe('NOT_SURVEYED')
  })
})

describe('the response leaks nothing — the whole point', () => {
  it('returns the verdict and nothing else', async () => {
    const out = await svc([live]).check(at(live), 'p1')
    expect(Object.keys(out)).toEqual(['verdict'])
  })

  it('carries no trace of the building record', async () => {
    const out = await svc([live]).check(at(live), 'p1')
    const serialised = JSON.stringify(out)
    for (const secret of [
      'Sunrise Heights', '12 Baner Road', 'Zone A', '120', 'b1', '18.52', '73.85', 'Rahul',
    ]) {
      expect(serialised).not.toContain(secret)
    }
  })

  it('says the same thing whether we hold nothing or hold something unserved', async () => {
    const nothing = await svc([]).check({ latitude: 1, longitude: 1 }, 'p1')
    expect(Object.keys(nothing)).toEqual(Object.keys(await svc([notLive]).check(at(notLive), 'p1')))
  })
})

describe('demand signal', () => {
  it('records a miss so we learn what people are asking for', async () => {
    const demand = { record: vi.fn(async () => {}) }
    await svc([], demand).check({ latitude: 1, longitude: 2, name: 'Hopeful Society', placeId: 'x' }, 'p9')
    expect(demand.record).toHaveBeenCalledWith(
      expect.objectContaining({ partnerId: 'p9', name: 'Hopeful Society', latitude: 1, longitude: 2 }),
    )
  })

  it('does not record one when we already serve the building', async () => {
    const demand = { record: vi.fn(async () => {}) }
    await svc([live], demand).check(at(live), 'p1')
    expect(demand.record).not.toHaveBeenCalled()
  })
})
