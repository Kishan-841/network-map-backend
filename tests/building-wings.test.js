import { describe, it, expect } from 'vitest'
import { normaliseWings, wingSetErrors, isComplete, deriveTotals } from '../src/lib/building-wings.js'

const w = (o) => ({ name: 'A', latitude: 18.5, longitude: 73.8, homePass: 10, isLive: false, ...o })

describe('building wing rules', () => {
  it('normalises names and numbers', () => {
    expect(normaliseWings([w({ name: '  B ', homePass: '12' })])[0]).toMatchObject({ name: 'B', homePass: 12 })
  })
  it('refuses more wings than the wing count', () => {
    expect(wingSetErrors([w(), w({ name: 'B' })], 1)).toEqual(['This building has 1 wing — 2 cannot be placed'])
  })
  it('refuses wings when the building has no wing count', () => {
    expect(wingSetErrors([w()], null)).toEqual(['Set the number of wings before locating them'])
  })
  it('refuses duplicate names case-insensitively', () => {
    expect(wingSetErrors([w({ name: 'A' }), w({ name: 'a' })], 3)).toEqual(['Wing name "a" is used twice'])
  })
  it('refuses an empty or too long name, bad home pass and bad coordinates', () => {
    expect(wingSetErrors([w({ name: ' ' })], 2)).toContain('Every wing needs a name')
    expect(wingSetErrors([w({ name: 'x'.repeat(41) })], 2)).toContain('Wing names are at most 40 characters')
    expect(wingSetErrors([w({ homePass: -1 })], 2)).toContain('Home pass must be a whole number, 0 or more')
    expect(wingSetErrors([w({ latitude: 91 })], 2)).toContain('Wing A has an invalid location')
  })
  it('an empty set is always valid (removes every wing)', () => {
    expect(wingSetErrors([], null)).toEqual([])
  })
  it('is complete only when every wing is placed', () => {
    expect(isComplete(3, 3)).toBe(true)
    expect(isComplete(2, 3)).toBe(false)
    expect(isComplete(0, 0)).toBe(false)
    expect(isComplete(1, null)).toBe(false)
  })
  it('derives live = any wing live, home pass = sum', () => {
    expect(deriveTotals([w({ homePass: 10 }), w({ homePass: 5, isLive: true })])).toEqual({ isLive: true, homePass: 15 })
    expect(deriveTotals([w({ homePass: 4 })])).toEqual({ isLive: false, homePass: 4 })
  })
})
