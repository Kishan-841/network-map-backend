import { describe, it, expect } from 'vitest'
import { isSimilarName } from '../src/lib/name-similarity.js'

describe('isSimilarName', () => {
  it.each([
    ['Sunrise Apartments', 'Sunrise Apartments'],
    ['Sunrise Apartments', 'sunrise apartments'],
    ['Sunrise Apartments', 'Sunrise Apartment'],
    ['Sunrise Apartments', 'Apartments Sunrise'],
    ['Sea View Tower', 'Sea-View Tower'],
    ['Sunrise Apartments', 'Sunrize Apartments'],
  ])('flags "%s" vs "%s" as similar', (a, b) => {
    expect(isSimilarName(a, b)).toBe(true)
  })

  it.each([
    ['Sunrise Apartments', 'Moonlight Residency'],
    ['Sea View Tower', 'Hill Crest Villa'],
    ['Block A', 'Sunrise Apartments'],
  ])('does NOT flag "%s" vs "%s"', (a, b) => {
    expect(isSimilarName(a, b)).toBe(false)
  })
})
