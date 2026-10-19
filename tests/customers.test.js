import { describe, it, expect } from 'vitest'
import {
  normaliseMobile,
  parseSheetDate,
  foldBuildingName,
  matchBuildingNames,
  customerFieldErrors,
  foldWingName,
  matchWing,
  customerIdentity,
  mergeCustomerUpdate,
} from '../src/lib/customers.js'

describe('customer mobile normalisation', () => {
  it('keeps a plain 10-digit number', () => {
    expect(normaliseMobile('8686692513')).toBe('8686692513')
  })
  it('drops the 91 country code the billing sheet writes', () => {
    expect(normaliseMobile('918686692513')).toBe('8686692513')
  })
  it('drops a leading zero', () => {
    expect(normaliseMobile('08686692513')).toBe('8686692513')
  })
  it('ignores spaces, + and dashes', () => {
    expect(normaliseMobile('+91 98674 12726')).toBe('9867412726')
  })
  it('answers null for nothing to normalise', () => {
    expect(normaliseMobile('')).toBe(null)
    expect(normaliseMobile(null)).toBe(null)
    expect(normaliseMobile(undefined)).toBe(null)
  })
})

describe('customer sheet dates (IST wall clock)', () => {
  it('passes a real Date cell through', () => {
    const cell = new Date('2026-09-12T12:22:22.000Z')
    expect(parseSheetDate(cell).toISOString()).toBe('2026-09-12T12:22:22.000Z')
  })
  it('reads dd-mm-yyyy HH:MM:SS as IST', () => {
    expect(parseSheetDate('12-09-2026 17:52:22').toISOString()).toBe('2026-09-12T12:22:22.000Z')
    expect(parseSheetDate('11-12-2026 23:59:59').toISOString()).toBe('2026-12-11T18:29:59.000Z')
  })
  it('reads a bare dd-mm-yyyy as midnight IST', () => {
    expect(parseSheetDate('12-09-2026').toISOString()).toBe('2026-09-11T18:30:00.000Z')
  })
  it('reads an ISO string the app itself writes', () => {
    expect(parseSheetDate('2026-09-12T17:52:22.000Z').toISOString()).toBe('2026-09-12T17:52:22.000Z')
  })
  it('answers null for what it cannot read', () => {
    expect(parseSheetDate('n/a')).toBe(null)
    expect(parseSheetDate('')).toBe(null)
    expect(parseSheetDate(null)).toBe(null)
    expect(parseSheetDate(new Date('nope'))).toBe(null)
  })
})

describe('building name matching', () => {
  const towers = (name, id, zoneName) => ({ id, buildingName: name, formattedAddress: `${name} address`, zone: { name: zoneName } })
  const buildings = [
    towers('Capital Towers', 'b1', 'MORYA INTERNET FTTH'),
    towers('Anand Park Lane No. 1 Flat Belt', 'b2', 'MORYA INTERNET FTTH'),
    towers('Anand Park Lane No. 1 Flat Belt', 'b3', 'SHRI COLONY'),
    towers('Anand Park Lane No. 1 Flat Belt', 'b4', 'MORYA INTERNET FTTH'),
    towers('Vardhaman Vatika Phase 1', 'b5', 'MORYA INTERNET FTTH'),
  ]

  it('folds names for punctuation-insensitive matching', () => {
    expect(foldBuildingName('Vardhaman Vatika, Phase 1')).toBe('vardhamanvatikaphase1')
  })

  it('matches exactly, ignoring case and padding', () => {
    const out = matchBuildingNames([' capital towers '], buildings)
    expect(out[' capital towers '].matches.map((b) => b.id)).toEqual(['b1'])
  })

  it('matches a name the sheet wrote without the space before the number', () => {
    const out = matchBuildingNames(['vardhaman vatika phase1'], buildings)
    expect(out['vardhaman vatika phase1'].matches.map((b) => b.id)).toEqual(['b5'])
  })

  it('answers every match when a name is ambiguous', () => {
    const out = matchBuildingNames(['Anand Park Lane No. 1 Flat Belt'], buildings)
    expect(out['Anand Park Lane No. 1 Flat Belt'].matches.map((b) => b.id)).toEqual(['b2', 'b3', 'b4'])
  })

  it('answers no match for an unknown name', () => {
    expect(matchBuildingNames(['Nowhere'], buildings).Nowhere.matches).toEqual([])
  })
})

describe('customer field rules', () => {
  const good = { name: 'Sachin Ganji', mobile: '918686692513', email: 'ganjisachin@gmail.com' }

  it('accepts a well-formed row', () => {
    expect(customerFieldErrors(good)).toEqual([])
  })
  it('requires a name', () => {
    expect(customerFieldErrors({ ...good, name: '  ' })).toContain('Customer name is missing')
  })
  it('requires a usable mobile number', () => {
    expect(customerFieldErrors({ ...good, mobile: '' })).toContain('Mobile number is missing')
    expect(customerFieldErrors({ ...good, mobile: 'abc' })).toContain('Mobile number is missing')
  })
  it('checks an email when one is given, and is happy without one', () => {
    expect(customerFieldErrors({ ...good, email: 'nope' })).toContain('Email address looks wrong')
    expect(customerFieldErrors({ ...good, email: '' })).toEqual([])
  })
})

describe('wing names', () => {
  const wings = [{ id: 'wa', name: 'A' }, { id: 'wb', name: 'Wing B' }]
  it('folds the word wing and punctuation away', () => {
    for (const v of ['A', 'a', 'Wing A', 'A Wing', 'A-wing', ' wing-a ']) expect(foldWingName(v)).toBe('a')
  })
  it('matches a located wing', () => {
    expect(matchWing('b', wings)).toEqual({ wingId: 'wb', flag: null })
  })
  it('blank → no wing, no flag', () => {
    expect(matchWing('  ', wings)).toEqual({ wingId: null, flag: null })
  })
  it('not located → flagged', () => {
    expect(matchWing('C', wings)).toEqual({ wingId: null, flag: 'Wing C is not located yet — added without a wing' })
  })
  it('two wings folding alike → flagged, never guessed', () => {
    expect(matchWing('A', [{ id: '1', name: 'A' }, { id: '2', name: 'Wing A' }]).flag)
      .toBe('Wing A matches more than one wing — added without a wing')
  })
  it('on an update row the copy says the wing was left as it was', () => {
    expect(matchWing('C', wings, { update: true }))
      .toEqual({ wingId: null, flag: 'Wing C is not located yet — wing left as it was' })
    expect(matchWing('A', [{ id: '1', name: 'A' }, { id: '2', name: 'Wing A' }], { update: true }).flag)
      .toBe('Wing A matches more than one wing — wing left as it was')
    expect(matchWing('b', wings, { update: true })).toEqual({ wingId: 'wb', flag: null })
  })
})

describe('customer identity', () => {
  it('username wins', () => expect(customerIdentity({ username: ' 868 ', buildingId: 'b', mobile: '9' })).toBe('u:868'))
  it('falls back to building + normalised mobile', () =>
    expect(customerIdentity({ username: '', buildingId: 'b', mobile: '918686692513' })).toBe('m:b:8686692513'))
})

describe('merge for update', () => {
  const existing = { name: 'A', email: 'a@x.in', planExpiresAt: new Date('2026-12-11T18:29:59Z'), wingId: 'wa', ponNumber: null }
  it('blank never erases', () => {
    expect(mergeCustomerUpdate(existing, { name: '', email: null, wingId: null })).toEqual({ data: {}, changed: false })
  })
  it('same instant is unchanged', () => {
    expect(mergeCustomerUpdate(existing, { planExpiresAt: new Date('2026-12-11T18:29:59Z') }).changed).toBe(false)
  })
  it('a Date matches an ISO string of the same instant', () => {
    const stored = { planExpiresAt: '2026-12-11T18:29:59.000Z' }
    expect(mergeCustomerUpdate(stored, { planExpiresAt: new Date('2026-12-11T18:29:59Z') }).changed).toBe(false)
  })
  it('a filled cell overwrites', () => {
    expect(mergeCustomerUpdate(existing, { ponNumber: '6', name: 'A' })).toEqual({ data: { ponNumber: '6' }, changed: true })
  })
})
