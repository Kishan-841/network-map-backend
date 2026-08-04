import { describe, it, expect } from 'vitest'
import { createUserService } from '../src/modules/users/user.service.js'
import { bulkZoneAssignSchema } from '../src/modules/users/user.schemas.js'

const zones = [
  { id: 'z1', name: 'Baner' },
  { id: 'z2', name: 'Wakad West' },
]
const users = [
  { id: 'u1', email: 'surv@isp.local', role: 'SURVEYOR' },
  { id: 'u2', email: 'mgr@isp.local', role: 'MANAGER' },
]

function fakeDeps() {
  const updates = []
  return {
    updates,
    userRepository: {
      findByEmailInsensitive: async (email) =>
        users.find((u) => u.email === email.toLowerCase()) ?? null,
      update: async (id, data) => {
        updates.push([id, data])
        return { id, ...data }
      },
    },
    zoneRepository: { list: async () => zones, countByIds: async (ids) => ids.length },
  }
}

describe('bulkZoneAssignSchema', () => {
  it('rejects empty assignments and bad emails', () => {
    expect(bulkZoneAssignSchema.safeParse({ assignments: [] }).success).toBe(false)
    expect(
      bulkZoneAssignSchema.safeParse({
        assignments: [{ email: 'not-an-email', zoneNames: ['Baner'] }],
      }).success,
    ).toBe(false)
  })

  it('accepts valid rows', () => {
    const parsed = bulkZoneAssignSchema.parse({
      assignments: [{ email: 'a@b.co', zoneNames: [' Baner '] }],
    })
    expect(parsed.assignments[0].zoneNames).toEqual(['Baner'])
  })
})

describe('bulkAssignZones', () => {
  it('replaces the assignment set, matching names case-insensitively', async () => {
    const deps = fakeDeps()
    const service = createUserService(deps)
    const result = await service.bulkAssignZones([
      { email: 'SURV@isp.local', zoneNames: ['baner', 'WAKAD WEST'] },
    ])
    expect(result.updated).toEqual([{ email: 'surv@isp.local', zones: 2 }])
    expect(result.skipped).toHaveLength(0)
    const [id, data] = deps.updates[0]
    expect(id).toBe('u1')
    expect(data.assignedZones).toEqual({ set: [{ id: 'z1' }, { id: 'z2' }] })
  })

  it('skips unknown users, non-surveyors, and rows with unknown zones', async () => {
    const deps = fakeDeps()
    const service = createUserService(deps)
    const result = await service.bulkAssignZones([
      { email: 'ghost@isp.local', zoneNames: ['Baner'] },
      { email: 'mgr@isp.local', zoneNames: ['Baner'] },
      { email: 'surv@isp.local', zoneNames: ['Baner', 'Nope Zone'] },
    ])
    expect(deps.updates).toHaveLength(0)
    expect(result.updated).toHaveLength(0)
    expect(result.skipped).toEqual([
      { email: 'ghost@isp.local', reason: 'user not found' },
      { email: 'mgr@isp.local', reason: 'not a surveyor' },
      { email: 'surv@isp.local', reason: "zone(s) not found: Nope Zone" },
    ])
    expect(result.total).toBe(3)
  })

  it('deduplicates zone names within a row', async () => {
    const deps = fakeDeps()
    const service = createUserService(deps)
    await service.bulkAssignZones([{ email: 'surv@isp.local', zoneNames: ['Baner', 'baner'] }])
    const [, data] = deps.updates[0]
    expect(data.assignedZones).toEqual({ set: [{ id: 'z1' }] })
  })
})
