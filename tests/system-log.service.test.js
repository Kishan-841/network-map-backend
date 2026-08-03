import { describe, it, expect } from 'vitest'
import { createSystemLogService } from '../src/modules/system-logs/system-log.service.js'

function fakeRepos({ user = null, failCreate = false } = {}) {
  const created = []
  const calls = []
  return {
    created,
    calls,
    systemLogRepository: {
      create: async (data) => {
        if (failCreate) throw new Error('db down')
        created.push(data)
        return data
      },
      findMany: async (args) => {
        calls.push(['findMany', args])
        return []
      },
      count: async (where) => {
        calls.push(['count', where])
        return 0
      },
    },
    userRepository: { findById: async () => user },
  }
}

const baseEntry = {
  module: 'Building',
  action: 'Update',
  description: 'Building updated',
  requestUrl: '/api/v1/buildings/b1',
  httpMethod: 'PATCH',
  status: 'SUCCESS',
  statusCode: 200,
}

describe('recordLog', () => {
  it('fills user snapshot from userId and sanitizes values', async () => {
    const deps = fakeRepos({
      user: { id: 'u1', name: 'Amit', email: 'amit@isp.local', role: 'ADMIN' },
    })
    const service = createSystemLogService(deps)
    await service.recordLog({
      ...baseEntry,
      userId: 'u1',
      newValue: { name: 'Tower A', password: 'nope' },
    })
    expect(deps.created).toHaveLength(1)
    const row = deps.created[0]
    expect(row.userName).toBe('Amit')
    expect(row.userEmail).toBe('amit@isp.local')
    expect(row.userRole).toBe('ADMIN')
    expect(row.newValue).toEqual({ name: 'Tower A' })
  })

  it('never rejects even when the write fails', async () => {
    const service = createSystemLogService(fakeRepos({ failCreate: true }))
    await expect(service.recordLog({ ...baseEntry, userId: null })).resolves.toBeUndefined()
  })
})

describe('listLogs', () => {
  it('builds AND filters plus OR search and paginates', async () => {
    const deps = fakeRepos()
    const service = createSystemLogService(deps)
    const result = await service.listLogs({
      page: 2,
      pageSize: 50,
      module: 'Building',
      status: 'FAILED',
      search: 'tower',
    })
    const [, findArgs] = deps.calls.find(([name]) => name === 'findMany')
    expect(findArgs.skip).toBe(50)
    expect(findArgs.take).toBe(50)
    expect(findArgs.where.AND).toContainEqual({ module: 'Building' })
    expect(findArgs.where.AND).toContainEqual({ status: 'FAILED' })
    const orClause = findArgs.where.AND.find((c) => c.OR)
    expect(orClause.OR).toContainEqual({
      description: { contains: 'tower', mode: 'insensitive' },
    })
    expect(result).toEqual({ items: [], total: 0, page: 2, pageSize: 50, totalPages: 0 })
  })

  it('uses an empty where when no filters are set', async () => {
    const deps = fakeRepos()
    const service = createSystemLogService(deps)
    await service.listLogs({ page: 1, pageSize: 50 })
    const [, findArgs] = deps.calls.find(([name]) => name === 'findMany')
    expect(findArgs.where).toEqual({})
  })
})
