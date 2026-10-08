import { describe, it, expect } from 'vitest'
import { diffPermissionEdit } from '../src/modules/buildings/permission-edit-diff.js'

const existing = {
  buildingName: 'Sai Heights',
  formattedAddress: 'Baner',
  latitude: 18.5,
  longitude: 73.8,
  zoneId: null,
  isLive: false,
  details: { wings: 2, floors: 7, homePass: 120, buildingType: null, remarks: null },
  permission: { permissionStatus: 'FOLLOW_UP', societyOffer: 'DEMO', paymentType: null, demoCount: 2, amountPaid: '1500.00', permissionDate: new Date('2026-10-01T00:00:00Z') },
  contact: { contactName: 'A', contactPhone: '9876543210', contactEmail: null, designation: 'SECRETARY', designationOther: null },
  photos: [
    { id: 'p1', type: 'ENTRANCE', url: 'https://r2/e.jpg' },
    { id: 'p2', type: 'PERMISSION_LETTER', url: 'https://r2/l.pdf' },
  ],
}

describe('diffPermissionEdit', () => {
  it('reports nothing when a full form resends the same values', () => {
    const r = diffPermissionEdit(existing, {
      building: { buildingName: 'Sai Heights', formattedAddress: 'Baner', latitude: 18.5, longitude: 73.8 },
      details: { wings: 2, floors: 7, homePass: 120, buildingType: null },
      permission: { permissionStatus: 'FOLLOW_UP', societyOffer: 'DEMO', demoCount: 2, amountPaid: 1500, permissionDate: '2026-10-01' },
      contact: { contactName: 'A', contactPhone: '9876543210', designation: 'SECRETARY', contactEmail: '' },
      photos: [
        { type: 'ENTRANCE', url: 'https://r2/e.jpg' },
        { type: 'PERMISSION_LETTER', url: 'https://r2/l.pdf' },
      ],
    })
    expect(r).toEqual({ changes: [], statusBefore: null, statusAfter: null, photoPlan: null })
  })

  it('names each changed group and the status before → after', () => {
    const r = diffPermissionEdit(existing, {
      building: { buildingName: 'Sai Heights 2', latitude: 18.6 },
      details: { floors: 8 },
      permission: { permissionStatus: 'ACCEPTED', paymentType: 'ONE_TIME', ownerName: 'X' },
      contact: { contactName: 'B', contactPhone: '9876543210', designation: 'SECRETARY' },
    })
    expect(r.changes.sort()).toEqual(['contact', 'details', 'location', 'name', 'offer', 'permission', 'status'])
    expect(r).toMatchObject({ statusBefore: 'FOLLOW_UP', statusAfter: 'ACCEPTED' })
  })

  it('plans photo adds / removes and moves the permission document with the letter', () => {
    const r = diffPermissionEdit(existing, {
      photos: [
        { type: 'ENTRANCE', url: 'https://r2/e.jpg' },
        { type: 'ADDITIONAL', url: 'https://r2/a.jpg' },
      ],
    })
    expect(r.changes).toEqual(['photos'])
    expect(r.photoPlan).toEqual({
      add: [{ type: 'ADDITIONAL', url: 'https://r2/a.jpg' }],
      removeIds: ['p2'],
      removeUrls: ['https://r2/l.pdf'],
      documentUrl: null,
    })
  })
})
