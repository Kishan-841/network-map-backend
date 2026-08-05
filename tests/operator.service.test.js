import { describe, it, expect } from 'vitest'
import { createOperatorService } from '../src/modules/operators/operator.service.js'
import { operatorImportSchema } from '../src/modules/operators/operator.schemas.js'

function fakeDeps({ operators = [], zones = [], users = [] } = {}) {
  const ops = [...operators]
  const zs = zones.map((z) => ({ ...z }))
  const userUpdates = []
  let opSeq = ops.length
  let zSeq = zs.length
  return {
    userUpdates,
    ops,
    zs,
    operatorRepository: {
      listAll: async () => ops,
      create: async (data) => {
        const op = { id: `op${++opSeq}`, ...data }
        ops.push(op)
        return op
      },
    },
    zoneRepository: {
      listAll: async () => zs,
      create: async (data) => {
        const z = { id: `z${++zSeq}`, ...data }
        zs.push(z)
        return z
      },
      update: async (id, data) => {
        Object.assign(
          zs.find((z) => z.id === id),
          data,
        )
      },
    },
    userRepository: {
      findByEmailInsensitive: async (email) =>
        users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null,
      update: async (id, data) => userUpdates.push([id, data]),
    },
  }
}

describe('operatorImportSchema', () => {
  it('rejects empty rows and bad emails', () => {
    expect(operatorImportSchema.safeParse({ rows: [] }).success).toBe(false)
    expect(
      operatorImportSchema.safeParse({
        rows: [{ operator: 'O', zone: 'Z', city: 'C', email: 'bad' }],
      }).success,
    ).toBe(false)
  })
})

describe('importOperatorMapping', () => {
  it('creates operators + zones and assigns surveyors by email (union, replace)', async () => {
    const deps = fakeDeps({
      users: [{ id: 'u1', email: 'surv@isp.local', role: 'SURVEYOR' }],
    })
    const service = createOperatorService(deps)
    const result = await service.importOperatorMapping([
      { operator: 'AHILYANAGAR', zone: 'AHILYANAGAR', city: 'AHILYANAGAR', email: 'surv@isp.local' },
      { operator: 'AHILYANAGAR', zone: 'RUPESH GAIKWAD', city: 'AHILYANAGAR', email: 'SURV@isp.local' },
    ])
    expect(result.operatorsCreated).toBe(1) // one operator across both rows
    expect(result.zonesCreated).toBe(2)
    expect(result.surveyorsUpdated).toEqual([{ email: 'surv@isp.local', zones: 2 }])
    // Both zones belong to the same created operator.
    const opId = deps.ops[0].id
    expect(deps.zs.every((z) => z.operatorId === opId)).toBe(true)
    // The surveyor's assignment is the union of both zones (replace/set).
    const [, data] = deps.userUpdates[0]
    expect(data.assignedZones.set).toHaveLength(2)
  })

  it('links an existing zone to its operator and reports it', async () => {
    const deps = fakeDeps({
      zones: [{ id: 'z1', name: 'Baner', city: 'Pune', operatorId: null }],
      users: [{ id: 'u1', email: 'surv@isp.local', role: 'SURVEYOR' }],
    })
    const service = createOperatorService(deps)
    const result = await service.importOperatorMapping([
      { operator: 'BANER OP', zone: 'baner', city: 'Pune', email: 'surv@isp.local' },
    ])
    expect(result.zonesCreated).toBe(0)
    expect(result.zonesLinked).toBe(1)
    expect(deps.zs[0].operatorId).toBe(deps.ops[0].id)
  })

  it('skips unknown and non-surveyor emails', async () => {
    const deps = fakeDeps({
      users: [{ id: 'u2', email: 'mgr@isp.local', role: 'MANAGER' }],
    })
    const service = createOperatorService(deps)
    const result = await service.importOperatorMapping([
      { operator: 'O', zone: 'Z1', city: 'C', email: 'ghost@isp.local' },
      { operator: 'O', zone: 'Z2', city: 'C', email: 'mgr@isp.local' },
    ])
    expect(result.surveyorsUpdated).toHaveLength(0)
    expect(result.skipped).toEqual([
      { email: 'ghost@isp.local', reason: 'user not found' },
      { email: 'mgr@isp.local', reason: 'not a surveyor' },
    ])
    expect(deps.userUpdates).toHaveLength(0)
  })
})
