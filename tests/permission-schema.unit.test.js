import { describe, it, expect } from 'vitest'
import { createBuildingSchema } from '../src/modules/buildings/building.schemas.js'

const base = {
  buildingName: 'Green Society', formattedAddress: 'Baner, Pune',
  latitude: 18.5, longitude: 73.8, zoneId: 'z1',
}
const permission = (p) => createBuildingSchema.parse({ ...base, permission: p })

describe('permission capture fields', () => {
  it('accepts a full society-permission block', () => {
    const r = permission({
      permissionStatus: 'ACCEPTED', societyOffer: 'PAYMENT',
      paymentType: 'RECURRING', amountPaid: 5000, demoCount: 0,
    })
    expect(r.permission).toMatchObject({ permissionStatus: 'ACCEPTED', societyOffer: 'PAYMENT', paymentType: 'RECURRING', demoCount: 0 })
  })
  it('accepts a DEMO offer with a count', () => {
    expect(permission({ permissionStatus: 'FOLLOW_UP', societyOffer: 'DEMO', demoCount: 3 }).permission.demoCount).toBe(3)
  })
  it('rejects an unknown permission status', () => {
    expect(() => permission({ permissionStatus: 'MAYBE' })).toThrow()
  })
  it('rejects an unknown society offer', () => {
    expect(() => permission({ societyOffer: 'BARTER' })).toThrow()
  })
  it('rejects an unknown payment type', () => {
    expect(() => permission({ paymentType: 'WEEKLY' })).toThrow()
  })
})
