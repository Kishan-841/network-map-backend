import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { createUserService } from '../src/modules/users/user.service.js'

function fakeRepos({ users = [], zoneCount = (ids) => ids.length } = {}) {
  const calls = []
  return {
    calls,
    userRepository: {
      findByEmail: async (email) => users.find((u) => u.email === email) ?? null,
      findById: async (id) => users.find((u) => u.id === id) ?? null,
      create: async (data) => {
        calls.push(['create', data])
        return { id: 'new', ...data }
      },
      update: async (id, data) => {
        calls.push(['update', id, data])
        return { id, ...data }
      },
    },
    zoneRepository: { countByIds: async (ids) => zoneCount(ids) },
  }
}

const surveyorInput = {
  name: 'S',
  email: 's@isp.local',
  password: 'Passw0rd1',
  role: 'SURVEYOR',
}

describe('user zone assignment', () => {
  it('connects zones on surveyor create', async () => {
    const deps = fakeRepos()
    const service = createUserService(deps)
    await service.createUser({ ...surveyorInput, zoneIds: ['z1', 'z2'] })
    const [, data] = deps.calls.find(([op]) => op === 'create')
    expect(data.assignedZones).toEqual({ connect: [{ id: 'z1' }, { id: 'z2' }] })
  })

  it('ignores zoneIds for non-surveyors', async () => {
    const deps = fakeRepos()
    const service = createUserService(deps)
    await service.createUser({ ...surveyorInput, role: 'MANAGER', zoneIds: ['z1'] })
    const [, data] = deps.calls.find(([op]) => op === 'create')
    expect(data.assignedZones).toBeUndefined()
  })

  it('rejects unknown zone ids with 400', async () => {
    const deps = fakeRepos({ zoneCount: () => 0 })
    const service = createUserService(deps)
    await expect(
      service.createUser({ ...surveyorInput, zoneIds: ['nope'] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('replaces the set on update', async () => {
    const existing = {
      id: 'u1',
      email: 's@isp.local',
      role: 'SURVEYOR',
      passwordHash: bcrypt.hashSync('x', 4),
    }
    const deps = fakeRepos({ users: [existing] })
    const service = createUserService(deps)
    await service.updateUser('u1', { zoneIds: ['z9'] })
    const [, , data] = deps.calls.find(([op]) => op === 'update')
    expect(data.assignedZones).toEqual({ set: [{ id: 'z9' }] })
  })

  it('leaves assignments unchanged when zoneIds omitted', async () => {
    const existing = { id: 'u1', email: 's@isp.local', role: 'SURVEYOR' }
    const deps = fakeRepos({ users: [existing] })
    const service = createUserService(deps)
    await service.updateUser('u1', { name: 'New' })
    const [, , data] = deps.calls.find(([op]) => op === 'update')
    expect(data.assignedZones).toBeUndefined()
  })
})
