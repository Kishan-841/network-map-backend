import { describe, it, expect } from 'vitest'
import {
  istDay, istMinutes, istToday, addDays, weekdayIndex, dateOnly,
  parseSheetDate, parseSheetTime, toMinutes, isYes, expandDates, normalizeName,
} from '../src/lib/visit-plan.js'

describe('IST helpers', () => {
  it('puts 00:30 IST on its own day, not the previous UTC day', () => {
    const t = new Date('2026-11-02T19:00:00Z') // 03 Nov 00:30 IST
    expect(istDay(t)).toBe('2026-11-03')
    expect(istMinutes(t)).toBe(30)
    expect(istToday(new Date('2026-11-02T18:29:59Z'))).toBe('2026-11-02')
  })
  it('adds days across months and years, and knows the weekday', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(weekdayIndex('2026-11-02')).toBe(0) // Monday
    expect(weekdayIndex('2026-11-08')).toBe(6) // Sunday
    expect(dateOnly('2026-11-02').toISOString()).toBe('2026-11-02T00:00:00.000Z')
  })
})

describe('sheet values', () => {
  it('parses dates', () => {
    expect(parseSheetDate('2026-11-02')).toBe('2026-11-02')
    expect(parseSheetDate('02-11-2026')).toBe('2026-11-02')
    expect(parseSheetDate('2/11/2026')).toBe('2026-11-02')
    for (const bad of ['', '31-02-2026', '2026-13-01', 'next monday', '02-11-26']) expect(parseSheetDate(bad)).toBeNull()
  })
  it('parses times to HH:mm', () => {
    expect(parseSheetTime('09:30')).toBe('09:30')
    expect(parseSheetTime('9:30')).toBe('09:30')
    expect(parseSheetTime('09:30:00')).toBe('09:30')
    expect(parseSheetTime('1:05 PM')).toBe('13:05')
    expect(parseSheetTime('12:00 am')).toBe('00:00')
    for (const bad of ['', '25:00', '9.30', 'noon']) expect(parseSheetTime(bad)).toBeNull()
    expect(toMinutes('13:05')).toBe(785)
  })
  it('reads yes-ish cells', () => {
    for (const y of ['Y', 'y', 'Yes', 'YES', '✓', 'true', '1']) expect(isYes(y)).toBe(true)
    for (const n of ['', 'N', 'no', '0', 'x']) expect(isYes(n)).toBe(false)
  })
  it('normalises names for matching', () => {
    expect(normalizeName('  Silver  Oak, Pimple-Saudagar ')).toBe('silver oak pimple saudagar')
  })
})

describe('expandDates', () => {
  const none = [false, false, false, false, false, false, false]
  it('no weekday ticked = one day', () => {
    expect(expandDates({ date: '2026-11-03', until: '2026-11-30', weekdays: none })).toEqual(['2026-11-03'])
  })
  it('every ticked weekday from date to until, inclusive', () => {
    const monThu = [true, false, false, true, false, false, false]
    expect(expandDates({ date: '2026-11-02', until: '2026-11-12', weekdays: monThu })).toEqual([
      '2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12',
    ])
  })
  it("the date's own weekday counts only if ticked", () => {
    const thu = [false, false, false, true, false, false, false]
    expect(expandDates({ date: '2026-11-02', until: '2026-11-08', weekdays: thu })).toEqual(['2026-11-05'])
  })
  it('until before date gives nothing', () => {
    expect(expandDates({ date: '2026-11-10', until: '2026-11-01', weekdays: [true, ...none.slice(1)] })).toEqual([])
  })
})
