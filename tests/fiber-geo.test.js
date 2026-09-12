import { describe, it, expect } from 'vitest'
import { haversineMeters, pathMeters } from '../src/lib/fiber-geo.js'

describe('geo', () => {
  it('measures ~111 m per 0.001° of latitude', () => {
    const d = haversineMeters({ latitude: 18.5, longitude: 73.8 }, { latitude: 18.501, longitude: 73.8 })
    expect(d).toBeGreaterThan(110); expect(d).toBeLessThan(112)
  })
  it('sums a path and returns 0 for a single point', () => {
    const pts = [{ latitude: 18.5, longitude: 73.8 }, { latitude: 18.501, longitude: 73.8 }, { latitude: 18.502, longitude: 73.8 }]
    expect(pathMeters(pts)).toBeCloseTo(2 * haversineMeters(pts[0], pts[1]), 3)
    expect(pathMeters([pts[0]])).toBe(0)
  })
})
