import { describe, it, expect } from 'vitest'
import { createPopSchema, updatePopSchema } from '../src/modules/pops/pop.schemas.js'

const base = { name: 'POP-1', latitude: 18.5, longitude: 73.8 }

describe('createPopSchema zoneIds', () => {
  it('accepts a zoneIds array', () => {
    const r = createPopSchema.parse({ ...base, zoneIds: ['z1', 'z2'] })
    expect(r.zoneIds).toEqual(['z1', 'z2'])
  })
  it('folds a legacy singular zoneId into zoneIds (deploy-window back-compat)', () => {
    const r = createPopSchema.parse({ ...base, zoneId: 'z9' })
    expect(r.zoneIds).toEqual(['z9'])
  })
  it('rejects when neither zoneId nor zoneIds is given', () => {
    expect(() => createPopSchema.parse(base)).toThrow()
  })
  it('rejects an empty zoneIds array', () => {
    expect(() => createPopSchema.parse({ ...base, zoneIds: [] })).toThrow()
  })
})

describe('updatePopSchema', () => {
  it('allows omitting zoneIds', () => {
    expect(updatePopSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
  })
  it('still folds a legacy zoneId on update', () => {
    expect(updatePopSchema.parse({ zoneId: 'z3' }).zoneIds).toEqual(['z3'])
  })
})
