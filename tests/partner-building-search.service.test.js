import { describe, it, expect, vi } from 'vitest'
import { createBuildingSearchService } from '../src/modules/partners/building-search.service.js'

const rows = [
  { id: 'b1', buildingName: 'Green Meadows CHS', formattedAddress: '12 Baner Road, Pune',
    isLive: true, latitude: 18.52, longitude: 73.85, details: { homePass: 300 },
    zone: { name: 'Zone A' }, createdBy: { name: 'Rahul' } },
  { id: 'b2', buildingName: 'Green Valley Towers', formattedAddress: '9 Wakad, Pune',
    isLive: false, latitude: 18.53, longitude: 73.86, details: { homePass: 120 },
    zone: { name: 'Zone B' }, createdBy: { name: 'Priya' } },
]

// Mirrors the repository: an `id` fetches that one building, otherwise the
// query matches. Without honouring `id`, the fake would hand back the wrong
// row and the serviceability check would look like it passed.
const svc = (found = rows) =>
  createBuildingSearchService({
    buildingRepository: {
      searchForPartner: vi.fn(async (query, take, id) =>
        id ? found.filter((b) => b.id === id) : found,
      ),
    },
  })

describe('searching our own registry', () => {
  it('needs a real query — a partner cannot list the whole registry', async () => {
    await expect(svc().search('')).rejects.toMatchObject({ status: 400 })
    await expect(svc().search('a')).rejects.toMatchObject({ status: 400 })
    await expect(svc().search('ab')).rejects.toMatchObject({ status: 400 })
  })

  it('returns matches for a real query', async () => {
    const out = await svc().search('green')
    expect(out).toHaveLength(2)
    expect(out[0].buildingName).toBe('Green Meadows CHS')
  })

  it('says which are serviceable', async () => {
    const out = await svc().search('green')
    expect(out.find((b) => b.id === 'b1').isServiceable).toBe(true)
    expect(out.find((b) => b.id === 'b2').isServiceable).toBe(false)
  })

  it('returns ONLY what is needed to pick one', async () => {
    const out = await svc().search('green')
    expect(Object.keys(out[0]).sort()).toEqual(
      ['buildingName', 'formattedAddress', 'id', 'isServiceable'].sort(),
    )
  })

  it('leaks no survey data — no home pass, zone, surveyor or coordinates', async () => {
    const serialised = JSON.stringify(await svc().search('green'))
    for (const secret of ['300', '120', 'Zone A', 'Zone B', 'Rahul', 'Priya', '18.52', '73.85']) {
      expect(serialised).not.toContain(secret)
    }
  })
})

describe('serviceability is decided on the server', () => {
  it('confirms a live building', async () => {
    await expect(svc().assertServiceable('b1')).resolves.toBeUndefined()
  })

  it('refuses one that is not live, whatever the client claims', async () => {
    await expect(svc().assertServiceable('b2')).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a building id we do not hold', async () => {
    await expect(svc([]).assertServiceable('nope')).rejects.toMatchObject({ status: 400 })
  })
})
