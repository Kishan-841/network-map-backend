import { describe, it, expect } from 'vitest'
import { pointToPolylineMeters } from '../src/lib/fiber-geo.js'

// ~111.32 m per 0.001° of latitude; Pune is near 18.6° N.
const P = { latitude: 18.6, longitude: 73.8 }

describe('pointToPolylineMeters', () => {
  it('is the distance to the nearest vertex for a single point', () => {
    const d = pointToPolylineMeters(P, [{ latitude: 18.601, longitude: 73.8 }])
    expect(d).toBeGreaterThan(108)
    expect(d).toBeLessThan(114)
  })
  it('measures to the middle of a long segment, not just its ends', () => {
    // A line 2 km east-west passing 50 m north of P; both ends are ~1 km away.
    const line = [{ latitude: 18.60045, longitude: 73.79 }, { latitude: 18.60045, longitude: 73.81 }]
    const d = pointToPolylineMeters(P, line)
    expect(d).toBeGreaterThan(45)
    expect(d).toBeLessThan(55)
  })
  it('takes the closest of several segments', () => {
    const line = [
      { latitude: 18.61, longitude: 73.79 },
      { latitude: 18.61, longitude: 73.81 },
      { latitude: 18.6002, longitude: 73.81 },
      { latitude: 18.6002, longitude: 73.79 },
    ]
    expect(pointToPolylineMeters(P, line)).toBeLessThan(25)
  })
  it('is Infinity for no points', () => {
    expect(pointToPolylineMeters(P, [])).toBe(Infinity)
  })
})
