import { describe, it, expect } from 'vitest'
import { findJunctions } from '../src/modules/fibers/fiber-junctions.js'
import { haversineMeters } from '../src/lib/fiber-geo.js'

// One degree of latitude at the equator, on the 6371 km sphere the geo lib uses.
const METERS_PER_DEGREE = (6371000 * Math.PI) / 180
const BASE_LAT = 18.5
const BASE_LON = 73.8

/** A candidate `north` metres up from the base point — distances stay exact along a meridian. */
const at = (pointId, fiberId, north) => ({
  pointId,
  fiberId,
  fiberName: fiberId.toUpperCase(),
  latitude: BASE_LAT + north / METERS_PER_DEGREE,
  longitude: BASE_LON,
})

describe('findJunctions', () => {
  it('places three endpoints within 5 m of three fibers into one cluster', () => {
    const candidates = [at('p1', 'f1', 0), at('p2', 'f2', 2), at('p3', 'f3', 4)]

    const clusters = findJunctions(candidates, 10)

    expect(clusters).toHaveLength(1)
    expect(clusters[0].points.map((p) => p.pointId).sort()).toEqual(['p1', 'p2', 'p3'])
    expect(clusters[0].points[0]).toEqual({ pointId: 'p1', fiberId: 'f1', fiberName: 'F1' })
    // Centre is the arithmetic mean of the members — here the middle point.
    expect(clusters[0].centre.latitude).toBeCloseTo(candidates[1].latitude, 10)
    expect(clusters[0].centre.longitude).toBeCloseTo(BASE_LON, 10)
  })

  it('ignores two nearby endpoints that belong to the same fiber', () => {
    const candidates = [at('p1', 'f1', 0), at('p2', 'f1', 5)]

    expect(haversineMeters(candidates[0], candidates[1])).toBeCloseTo(5, 3)
    expect(findJunctions(candidates, 10)).toEqual([])
  })

  it('leaves a point 50 m away out of the cluster', () => {
    const candidates = [at('p1', 'f1', 0), at('p2', 'f2', 3), at('p3', 'f3', 50)]

    const clusters = findJunctions(candidates, 10)

    expect(clusters).toHaveLength(1)
    expect(clusters[0].points.map((p) => p.pointId).sort()).toEqual(['p1', 'p2'])
  })

  it('chains transitively: A–B 8 m and B–C 8 m merge even though A–C is 16 m', () => {
    const candidates = [at('a', 'f1', 0), at('b', 'f2', 8), at('c', 'f3', 16)]

    expect(haversineMeters(candidates[0], candidates[2])).toBeCloseTo(16, 3)

    const clusters = findJunctions(candidates, 10)

    expect(clusters).toHaveLength(1)
    expect(clusters[0].points.map((p) => p.pointId).sort()).toEqual(['a', 'b', 'c'])
  })

  it('returns the biggest cluster first', () => {
    const candidates = [
      at('p1', 'f1', 0),
      at('p2', 'f2', 2),
      at('p3', 'f3', 4),
      at('q1', 'f4', 500),
      at('q2', 'f5', 502),
    ]

    const clusters = findJunctions(candidates, 10)

    expect(clusters.map((c) => c.points.length)).toEqual([3, 2])
  })

  it('returns nothing for an empty or single-point input', () => {
    expect(findJunctions([], 10)).toEqual([])
    expect(findJunctions([at('p1', 'f1', 0)], 10)).toEqual([])
  })
})
