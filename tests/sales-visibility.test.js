import { describe, it, expect } from 'vitest'
import { scopedUserIds, assignedToWhere, buildingScopeWhere, canAssign, poolWhere } from '../src/lib/sales-visibility.js'

describe('scopedUserIds', () => {
  it('ADMIN gets null (no restriction)', () => {
    expect(scopedUserIds({ id: 'a', role: 'ADMIN' }, ['x'])).toBeNull()
  })
  it('a manager sees themselves and everyone under them', () => {
    expect(scopedUserIds({ id: 'm', role: 'SALES_MANAGER' }, ['t1', 's1', 's2'])).toEqual(['m', 't1', 's1', 's2'])
  })
  it('a team leader sees themselves and their executives', () => {
    expect(scopedUserIds({ id: 'tl', role: 'TEAM_LEADER' }, ['s1', 's2'])).toEqual(['tl', 's1', 's2'])
  })
  it('an executive sees only themselves — team ids are ignored', () => {
    expect(scopedUserIds({ id: 'se', role: 'SALES_EXECUTIVE' }, ['someone'])).toEqual(['se'])
  })
  it('fails closed for a non-sales role and for no actor', () => {
    expect(scopedUserIds({ id: 'u', role: 'SURVEYOR' }, ['x'])).toEqual([])
    expect(scopedUserIds(null)).toEqual([])
    expect(scopedUserIds(undefined)).toEqual([])
  })
})

describe('assignedToWhere', () => {
  it('null is unrestricted', () => {
    expect(assignedToWhere(null)).toEqual({})
  })
  it('an id set restricts to those holders', () => {
    expect(assignedToWhere(['a', 'b'])).toEqual({ assignedToId: { in: ['a', 'b'] } })
  })
  it('an empty set matches nothing (fails closed)', () => {
    expect(assignedToWhere([])).toEqual({ assignedToId: { in: [] } })
  })
})

describe('buildingScopeWhere', () => {
  it('scopes to buildings with an ACTIVE assignment held in the set', () => {
    expect(buildingScopeWhere(['a'])).toEqual({
      salesAssignments: { some: { status: 'ACTIVE', assignedToId: { in: ['a'] } } },
    })
  })
  it('ADMIN (null) sees every assigned building', () => {
    expect(buildingScopeWhere(null)).toEqual({ salesAssignments: { some: { status: 'ACTIVE' } } })
  })
})

describe('canAssign', () => {
  it('admins, managers and team leaders may assign; executives and others may not', () => {
    expect(['ADMIN', 'SALES_MANAGER', 'TEAM_LEADER'].every(canAssign)).toBe(true)
    expect(['SALES_EXECUTIVE', 'SURVEYOR', undefined].some(canAssign)).toBe(false)
  })
})

describe('poolWhere', () => {
  const held = (ids) => buildingScopeWhere(ids)
  it('a team leader with zones works zone buildings OR anything their team holds', () => {
    const tl = { id: 'tl', role: 'TEAM_LEADER', zoneIds: ['z1', 'z2'] }
    expect(poolWhere(tl, ['tl', 's1'])).toEqual({ OR: [{ zoneId: { in: ['z1', 'z2'] } }, held(['tl', 's1'])] })
  })
  it('a team leader with no zones falls back to what their team holds', () => {
    expect(poolWhere({ id: 'tl', role: 'TEAM_LEADER', zoneIds: [] }, ['tl'])).toEqual(held(['tl']))
    expect(poolWhere({ id: 'tl', role: 'TEAM_LEADER' }, ['tl'])).toEqual(held(['tl']))
  })
  it('zones on any other role are ignored — only a TL works by zone', () => {
    expect(poolWhere({ id: 's', role: 'SALES_EXECUTIVE', zoneIds: ['z1'] }, ['s'])).toEqual(held(['s']))
    expect(poolWhere({ id: 'm', role: 'SALES_MANAGER', zoneIds: ['z1'] }, ['m'])).toEqual(held(['m']))
  })
  it('fails closed: an empty id set and no zones matches nothing', () => {
    expect(poolWhere({ role: 'TEAM_LEADER' }, [])).toEqual(held([]))
  })
})
