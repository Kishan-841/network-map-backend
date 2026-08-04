import { describe, it, expect } from 'vitest'
import { haversineMeters, boundingBox } from '../src/lib/geo.js'

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(19.076, 72.8777, 19.076, 72.8777)).toBe(0)
  })

  it('measures ~111 m for 0.001° latitude difference', () => {
    const d = haversineMeters(19.076, 72.8777, 19.077, 72.8777)
    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(118)
  })

  it('matches a known city-scale distance (Mumbai CST → Gateway ≈ 2 km)', () => {
    const d = haversineMeters(18.9398, 72.8355, 18.922, 72.8347)
    expect(d).toBeGreaterThan(1900)
    expect(d).toBeLessThan(2100)
  })
})

describe('boundingBox', () => {
  it('spans ~2×radius vertically', () => {
    const box = boundingBox(19.076, 72.8777, 100)
    const height = haversineMeters(box.minLat, 72.8777, box.maxLat, 72.8777)
    expect(height).toBeGreaterThan(190)
    expect(height).toBeLessThan(210)
  })

  it('contains points inside the radius and excludes far ones', () => {
    const box = boundingBox(19.076, 72.8777, 100)
    expect(19.0765).toBeGreaterThan(box.minLat)
    expect(19.0765).toBeLessThan(box.maxLat)
    expect(box.maxLat).toBeLessThan(19.078) // 100 m ≈ 0.0009°, not 0.002°
  })

  it('does not blow up near the poles (cos(lat) → 0)', () => {
    const box = boundingBox(90, 0, 5000)
    // Longitude delta must stay finite and bounded, not span the whole planet.
    expect(Number.isFinite(box.minLon)).toBe(true)
    expect(Number.isFinite(box.maxLon)).toBe(true)
    expect(box.maxLon - box.minLon).toBeLessThanOrEqual(360)
  })
})
