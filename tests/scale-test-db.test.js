import { describe, it, expect } from 'vitest'
import { assertScaleTarget, copySql, offsetFor, PLAN } from '../scripts/scale-test-db.js'

// The 10x copy script must never write anywhere but a *_scale database.
describe('scale-test-db guard', () => {
  it('refuses without a target', () => {
    expect(() => assertScaleTarget(undefined)).toThrow(/SCALE_DATABASE_URL/)
  })
  it('refuses a database not ending in _scale', () => {
    expect(() => assertScaleTarget('postgresql://u:p@localhost:5432/isp_feasibility_dev')).toThrow(/_scale/)
  })
  it('refuses the dev database even if named _scale', () => {
    const u = 'postgresql://u:p@localhost:5432/x_scale'
    expect(() => assertScaleTarget(u, u)).toThrow(/dev database/)
  })
  it('accepts a separate _scale database', () => {
    expect(() =>
      assertScaleTarget('postgresql://u:p@localhost:5432/isp_feasibility_scale', 'postgresql://u:p@localhost:5432/isp_feasibility_dev'),
    ).not.toThrow()
  })
})

describe('copy SQL', () => {
  const fiber = PLAN.find((p) => p.table === 'Fiber')
  const sql = copySql(fiber, ['id', 'name', 'oltId', 'ponPort', 'zoneId'], 3)
  it('suffixes ids and unique names, nulls the OLT, keeps shared links', () => {
    expect(sql).toContain(`"id" || '-x3'`)
    expect(sql).toContain(`"name" || '-x3'`)
    expect(sql).toMatch(/NULL, "ponPort", "zoneId"/)
  })
  it('copies only originals', () => {
    expect(sql).toContain(`WHERE "id" NOT LIKE '%-x%'`)
  })
  it('shifts each copy to its own spot', () => {
    const spots = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => JSON.stringify(offsetFor(k))))
    expect(spots.size).toBe(9)
    expect(copySql(PLAN[0], ['id', 'latitude', 'longitude'], 2)).toMatch(/"latitude" \+ [-\d.]+, "longitude" \+ [-\d.]+/)
  })
})

describe('copy SQL respects every unique index', () => {
  it('suffixes a building placeId (unique per zone)', () => {
    expect(copySql(PLAN[0], ['id', 'placeId', 'zoneId'], 2)).toContain(`"placeId" || '-x2'`)
  })
})
