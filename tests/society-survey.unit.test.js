import { describe, it, expect } from 'vitest'
import { mergeSurvey, stageOf, assertLinksMatchWings, assertSubmittable } from '../src/modules/permission-buildings/survey.js'
import { MATERIAL_KEYS, SOCIETY_MATERIALS } from '../src/lib/society-materials.js'
import { createPermissionBuildingService } from '../src/modules/permission-buildings/permission-building.service.js'
import { permissionBuildingRepository } from '../src/modules/permission-buildings/permission-building.repository.js'

describe('society survey rules', () => {
  const stored = {
    // jsonb hands keys back in its own order
    checks: { wingsOk: true, nameOk: true, homePassOk: false },
    wings: [{ shafts: 1, name: 'A', floors: 5, homePass: 20, flatsPerFloor: 4 }],
    links: [],
    materials: { FAT_BOX: 2 },
  }

  it('mergeSurvey: key order and zero quantities are not changes; left-out parts are kept', () => {
    const { next, changes } = mergeSurvey(stored, {
      checks: { nameOk: true, nameCorrection: null, wingsOk: true, homePassOk: false, note: '' },
      wings: [{ name: 'A', floors: 5, flatsPerFloor: 4, shafts: 1, homePass: 20 }],
      materials: { FAT_BOX: 2, FIBER_4F: 0 },
    })
    expect(changes).toEqual([])
    expect(next.links).toEqual([])
    expect(next.materials).toEqual({ FAT_BOX: 2 })
  })

  it('mergeSurvey lists exactly the parts that changed', () => {
    expect(mergeSurvey(stored, { materials: { FAT_BOX: 3 } }).changes).toEqual(['materials'])
    const two = { ...stored, wings: [...stored.wings, { name: 'B', floors: 1, flatsPerFloor: 1, shafts: 0, homePass: 1 }] }
    expect(mergeSurvey(two, { links: [{ from: 'a', to: 'b', method: 'TRAY', meters: null }] }).next.links).toEqual([
      { from: 'A', to: 'B', method: 'TRAY' },
    ])
  })

  it('stageOf', () => {
    expect(stageOf({ permissionApproval: null })).toBe('NOT_SENT')
    expect(stageOf({ permissionApproval: 'PENDING' })).toBe('APPROVAL_PENDING')
    expect(stageOf({ permissionApproval: 'REJECTED' })).toBe('APPROVAL_REJECTED')
    expect(stageOf({ permissionApproval: 'APPROVED', surveyStatus: 'REJECTED' })).toBe('APPROVED_NO_SURVEY')
    expect(stageOf({ permissionApproval: 'APPROVED', surveyStatus: 'SUBMITTED' })).toBe('SURVEY_SUBMITTED')
    expect(stageOf({ permissionApproval: 'APPROVED', surveyStatus: 'APPROVED' })).toBe('MATERIALS_APPROVED')
    expect(stageOf({ permissionApproval: 'APPROVED', isLive: true })).toBe('LIVE')
  })

  it('links must name existing, different wings; submit needs a wing and a material', () => {
    expect(() => assertLinksMatchWings({ wings: [{ name: 'A' }], links: [{ from: 'a', to: 'B' }] })).toThrow()
    expect(() => assertLinksMatchWings({ wings: [{ name: 'A' }, { name: 'B' }], links: [{ from: 'a', to: 'b' }] })).not.toThrow()
    expect(() => assertSubmittable({ wings: [], materials: { FAT_BOX: 1 } })).toThrow()
    expect(() => assertSubmittable({ wings: [{}], materials: {} })).toThrow()
    expect(() => assertSubmittable({ wings: [{}], materials: { FAT_BOX: 1 } })).not.toThrow()
  })

  it('the catalogue has 31 unique keys', () => {
    expect(new Set(MATERIAL_KEYS).size).toBe(31)
    expect(SOCIETY_MATERIALS.every((m) => ['m', 'count'].includes(m.unit))).toBe(true)
  })

  it('the repository has the survey methods the service calls', () => {
    for (const m of ['findSurvey', 'surveyPendingCount', 'withSurveyLock', 'findScopeRow', 'findDetail', 'pageIds', 'listRows']) {
      expect(typeof permissionBuildingRepository[m]).toBe('function')
    }
  })
  it('save / submit / mark-live re-check the zone under the lock (404 when it moved)', async () => {
    const before = { id: 'b1', source: 'PERMISSION', createdById: 'pe', zoneId: 'z1', permissionApproval: 'APPROVED' }
    const fresh = { ...before, zoneId: 'z2', isLive: false, societySurvey: { status: 'APPROVED', wings: [], links: [], materials: {} } }
    const repo = {
      findScopeRow: async () => before,
      withSurveyLock: async (id, fn) => fn({ fresh, write: { survey: async () => ({}), building: async () => ({}), visit: async () => ({}) } }),
    }
    const service = createPermissionBuildingService({ repo })
    const actor = { id: 's', role: 'SURVEYOR', zoneIds: ['z1'] }
    await expect(service.saveSurvey('b1', {}, actor)).rejects.toMatchObject({ status: 404 })
    await expect(service.submitSurvey('b1', {}, actor)).rejects.toMatchObject({ status: 404 })
    await expect(service.markLive('b1', {}, actor)).rejects.toMatchObject({ status: 404 })
  })
})
