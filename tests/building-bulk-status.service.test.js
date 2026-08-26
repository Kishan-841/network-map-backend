import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

/**
 * Bulk go-live. The property that matters: the rows updated are exactly the
 * rows the list would have shown for the same filter and the same actor. If
 * these two ever drift, an admin marks live buildings they never saw.
 */

const fakeUserRepo = (zones = []) => ({ assignedZoneIds: async () => zones })

function fakeRepo() {
  return {
    updateMany: vi.fn(async () => ({ count: 3 })),
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
  }
}

const build = (zones = []) => {
  const repo = fakeRepo()
  return {
    repo,
    service: createBuildingService({
      buildingRepository: repo,
      storage: { keyFromUrl: () => null },
      userRepository: fakeUserRepo(zones),
    }),
  }
}

const ADMIN = { id: 'a1', role: 'ADMIN' }
const SURVEYOR = { id: 's1', role: 'SURVEYOR' }

describe('bulkSetLive', () => {
  it('applies a zone filter and defaults to the coverage registry', async () => {
    const { repo, service } = build()
    const result = await service.bulkSetLive({ filter: { zoneId: 'z1' }, isLive: true }, ADMIN)
    expect(repo.updateMany).toHaveBeenCalledWith(
      { source: 'COVERAGE', zoneId: 'z1' },
      { isLive: true },
    )
    expect(result).toEqual({ count: 3, isLive: true })
  })

  it('reaches an operator through the zone, exactly like the list does', async () => {
    const { repo, service } = build()
    await service.bulkSetLive({ filter: { operatorId: 'op1' }, isLive: true }, ADMIN)
    expect(repo.updateMany).toHaveBeenCalledWith(
      { source: 'COVERAGE', zone: { operatorId: 'op1' } },
      { isLive: true },
    )
  })

  it('never touches acquisition rows when no source is asked for', async () => {
    const { repo, service } = build()
    await service.bulkSetLive({ filter: {}, isLive: true }, ADMIN)
    expect(repo.updateMany.mock.calls[0][0]).toMatchObject({ source: 'COVERAGE' })
  })

  it('confines an explicit id list to the actor’s scope', async () => {
    const { repo, service } = build(['z1'])
    await service.bulkSetLive({ ids: ['b1', 'b2'], isLive: true }, SURVEYOR)
    const [where] = repo.updateMany.mock.calls[0]
    // The ids are ANDed with the surveyor's zone-or-own scope, so passing an
    // id from someone else's zone cannot flip it.
    expect(where.AND[1]).toEqual({ id: { in: ['b1', 'b2'] } })
    expect(where.AND[0].AND).toEqual([
      { OR: [{ zoneId: { in: ['z1'] } }, { createdById: 's1' }] },
    ])
    expect(where.AND[0].source).toBe('COVERAGE')
  })

  it('carries the search term through, so a filtered view marks what it shows', async () => {
    const { repo, service } = build()
    await service.bulkSetLive({ filter: { search: 'mall' }, isLive: true }, ADMIN)
    const [where] = repo.updateMany.mock.calls[0]
    expect(where.OR).toEqual([
      { buildingName: { contains: 'mall', mode: 'insensitive' } },
      { formattedAddress: { contains: 'mall', mode: 'insensitive' } },
      { zone: { name: { contains: 'mall', mode: 'insensitive' } } },
    ])
  })

  it('can mark buildings not live again', async () => {
    const { repo, service } = build()
    const result = await service.bulkSetLive({ ids: ['b1'], isLive: false }, ADMIN)
    expect(repo.updateMany.mock.calls[0][1]).toEqual({ isLive: false })
    expect(result.isLive).toBe(false)
  })
})

describe('tier filter', () => {
  const whereFor = async (filters, actor = ADMIN) => {
    const { repo, service } = build()
    await service.bulkSetLive({ filter: filters, isLive: true }, actor)
    return repo.updateMany.mock.calls[0][0]
  }

  it('turns a tier into its home-pass range', async () => {
    expect((await whereFor({ tier: 'SILVER' })).AND).toEqual([
      { details: { homePass: { gte: 201, lte: 500 } } },
    ])
  })

  it('leaves the top tier open-ended', async () => {
    expect((await whereFor({ tier: 'PLATINUM' })).AND).toEqual([
      { details: { homePass: { gte: 1001 } } },
    ])
  })

  it('matches unrated buildings with or without a details row', async () => {
    expect((await whereFor({ tier: 'UNRATED' })).AND).toEqual([
      { OR: [{ details: { is: null } }, { details: { homePass: null } }] },
    ])
  })

  it('composes with a zone filter rather than replacing it', async () => {
    const where = await whereFor({ tier: 'GOLD', zoneId: 'z1' })
    expect(where.zoneId).toBe('z1')
    expect(where.AND).toEqual([{ details: { homePass: { gte: 501, lte: 1000 } } }])
  })

  it('composes with the surveyor scope instead of overwriting it', async () => {
    const { repo, service } = build(['z1'])
    await service.bulkSetLive({ filter: { tier: 'BRONZE' }, isLive: true }, SURVEYOR)
    // Both predicates survive — a surveyor filtering by tier still only ever
    // touches their own zones.
    // Order within an AND carries no meaning — assert both survive.
    expect(repo.updateMany.mock.calls[0][0].AND).toEqual(
      expect.arrayContaining([
        { OR: [{ zoneId: { in: ['z1'] } }, { createdById: 's1' }] },
        { details: { homePass: { gte: 1, lte: 200 } } },
      ]),
    )
    expect(repo.updateMany.mock.calls[0][0].AND).toHaveLength(2)
  })
})
