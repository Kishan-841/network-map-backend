import { describe, it, expect } from 'vitest'
import { HOME_PASS_TIERS, homePassTier, tierRangeLabel } from '../src/lib/home-pass-tier.js'

/**
 * The boundaries are the whole point — the ranges as specified overlapped at
 * 200 / 500 / 1000, and every one of those edges is a building that would land
 * in the wrong tier if the rule ever drifted.
 */
describe('homePassTier boundaries', () => {
  const cases = [
    [1, 'BRONZE'],
    [199, 'BRONZE'],
    [200, 'BRONZE'], // upper bound is inclusive: "1-200 HP" includes 200
    [201, 'SILVER'],
    [499, 'SILVER'],
    [500, 'SILVER'],
    [501, 'GOLD'],
    [999, 'GOLD'],
    [1000, 'GOLD'],
    [1001, 'PLATINUM'],
    [5000, 'PLATINUM'],
    [5001, 'PLATINUM'], // above 5000 stays Platinum — there is no fifth tier
    [999999, 'PLATINUM'],
  ]
  for (const [value, tier] of cases) {
    it(`${value} home pass → ${tier}`, () => {
      expect(homePassTier(value)).toBe(tier)
    })
  }
})

describe('homePassTier for buildings with no figure', () => {
  it('is unrated for null and undefined, never Bronze', () => {
    expect(homePassTier(null)).toBeNull()
    expect(homePassTier(undefined)).toBeNull()
  })

  it('is unrated for zero — nobody has measured it', () => {
    expect(homePassTier(0)).toBeNull()
  })

  it('is unrated for nonsense rather than throwing', () => {
    expect(homePassTier('abc')).toBeNull()
    expect(homePassTier(-5)).toBeNull()
  })

  it('accepts a numeric string, as a query param would arrive', () => {
    expect(homePassTier('250')).toBe('SILVER')
  })
})

describe('tier definition is contiguous', () => {
  it('leaves no gap between one tier and the next', () => {
    for (let i = 1; i < HOME_PASS_TIERS.length; i++) {
      expect(HOME_PASS_TIERS[i].min).toBe(HOME_PASS_TIERS[i - 1].max + 1)
    }
  })

  it('every tier covers at least one value and the last is open-ended', () => {
    for (const tier of HOME_PASS_TIERS) {
      expect(homePassTier(tier.min)).toBe(tier.key)
      if (tier.max !== null) expect(homePassTier(tier.max)).toBe(tier.key)
    }
    expect(HOME_PASS_TIERS.at(-1).max).toBeNull()
  })

  it('labels the ranges the way they read on screen', () => {
    expect(tierRangeLabel(HOME_PASS_TIERS[0])).toBe('1–200')
    expect(tierRangeLabel(HOME_PASS_TIERS.at(-1))).toBe('1001+')
  })
})
