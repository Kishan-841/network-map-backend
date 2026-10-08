import { describe, it, expect } from 'vitest'
import {
  approvalTransition,
  transitionData,
  transitionVisit,
  assertStatusUnlocked,
  approvalShape,
} from '../src/modules/permission-buildings/approval.js'
import { isVisibleBuilding, VISIBLE_BUILDING, andWhere } from '../src/lib/building-source.js'

describe('approvalTransition', () => {
  const cases = [
    [null, 'ACCEPTED', 'SUBMIT'],
    ['REJECTED', 'ACCEPTED', 'SUBMIT'],
    ['PENDING', 'ACCEPTED', null],
    ['APPROVED', 'ACCEPTED', null],
    ['PENDING', 'FOLLOW_UP', 'WITHDRAW'],
    ['PENDING', null, 'WITHDRAW'],
    ['REJECTED', 'DENIED', null],
    [null, 'FOLLOW_UP', null],
    ['APPROVED', 'DENIED', null],
  ]
  for (const [approval, statusAfter, expected] of cases) {
    it(`${approval} + ${statusAfter} → ${expected}`, () => {
      expect(approvalTransition({ approval, statusAfter })).toBe(expected)
    })
  }

  it('writes the building fields and a history row 1 ms after its cause', () => {
    const at = new Date('2026-10-08T10:00:00.000Z')
    expect(transitionData('SUBMIT', at)).toEqual({
      permissionApproval: 'PENDING',
      approvalSubmittedAt: at,
      approvalDecidedAt: null,
      approvalDecidedById: null,
    })
    expect(transitionData('WITHDRAW', at)).toEqual({ permissionApproval: null, approvalSubmittedAt: null })
    expect(transitionVisit('WITHDRAW', { userId: 'u', remark: 'r', at })).toMatchObject({
      kind: 'WITHDRAWN',
      remark: 'r',
      createdAt: new Date('2026-10-08T10:00:00.001Z'),
    })
    expect(transitionVisit('SUBMIT', { userId: 'u', remark: 'r', at }).kind).toBe('SUBMITTED')
    expect(transitionVisit(null, { userId: 'u', remark: 'r', at })).toBeNull()
  })
})

describe('assertStatusUnlocked', () => {
  it('locks an approved society: executive may send none, others only the same value', () => {
    expect(() => assertStatusUnlocked({ approval: 'APPROVED', current: 'ACCEPTED', next: 'ACCEPTED', isExecutive: true })).toThrow(/keep their status/)
    expect(() => assertStatusUnlocked({ approval: 'APPROVED', current: 'ACCEPTED', next: 'ACCEPTED', isExecutive: false })).not.toThrow()
    expect(() => assertStatusUnlocked({ approval: 'APPROVED', current: 'ACCEPTED', next: 'DENIED', isExecutive: false })).toThrow()
    expect(() => assertStatusUnlocked({ approval: 'APPROVED', current: 'ACCEPTED', next: undefined, isExecutive: true })).not.toThrow()
    expect(() => assertStatusUnlocked({ approval: 'PENDING', current: 'ACCEPTED', next: 'DENIED', isExecutive: true })).not.toThrow()
  })
})

describe('visibility helpers', () => {
  it('isVisibleBuilding mirrors VISIBLE_BUILDING', () => {
    expect(isVisibleBuilding({ source: 'COVERAGE' })).toBe(true)
    expect(isVisibleBuilding({ source: 'ACQUISITION' })).toBe(true)
    expect(isVisibleBuilding({ source: 'PERMISSION', permissionApproval: null })).toBe(false)
    expect(isVisibleBuilding({ source: 'PERMISSION', permissionApproval: 'PENDING' })).toBe(false)
    expect(isVisibleBuilding({ source: 'PERMISSION', permissionApproval: 'APPROVED' })).toBe(true)
  })

  it('andWhere composes with AND, so an existing OR survives', () => {
    const where = { OR: [{ zoneId: 'z' }, { createdById: 'u' }] }
    expect(andWhere(where, VISIBLE_BUILDING)).toEqual({ AND: [where, VISIBLE_BUILDING] })
    expect(andWhere({}, VISIBLE_BUILDING)).toEqual(VISIBLE_BUILDING)
  })

  it('approvalShape is null for a society never sent', () => {
    expect(approvalShape({ permissionApproval: null })).toBeNull()
    expect(approvalShape({ permissionApproval: 'REJECTED', approvalReason: 'x', approvalDecidedBy: { id: 'a', name: 'A', email: 'e' } })).toEqual({
      status: 'REJECTED',
      reason: 'x',
      submittedAt: null,
      decidedAt: null,
      decidedBy: { id: 'a', name: 'A' },
    })
  })
})
