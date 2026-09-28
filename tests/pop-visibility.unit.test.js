import { describe, it, expect } from 'vitest'
import { popZoneScope } from '../src/lib/visibility.js'

describe('popZoneScope', () => {
  it('lets an ADMIN see everything', () => {
    expect(popZoneScope({ role: 'ADMIN', id: 'a' })).toEqual({})
  })
  it('matches nothing without an actor', () => {
    expect(popZoneScope(undefined)).toEqual({ id: { in: [] } })
  })
  it('with no zones, matches only the maker', () => {
    expect(popZoneScope({ id: 'u1', zoneIds: [] })).toEqual({ createdById: 'u1' })
  })
  it('matches the maker OR any assigned zone', () => {
    expect(popZoneScope({ id: 'u1', zoneIds: ['z1', 'z2'] })).toEqual({
      OR: [{ createdById: 'u1' }, { zones: { some: { id: { in: ['z1', 'z2'] } } } }],
    })
  })
})
