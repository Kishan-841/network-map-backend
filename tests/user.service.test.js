import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { createUserService } from '../src/modules/users/user.service.js'

function fakeUserRepository(seed = []) {
  const users = [...seed]
  return {
    users,
    findByEmail: async (email) => users.find((u) => u.email === email) ?? null,
    findById: async (id) => users.find((u) => u.id === id) ?? null,
    create: async (data) => {
      const user = { id: `user-${users.length + 1}`, isActive: true, ...data }
      users.push(user)
      return user
    },
    list: async () => users,
    update: async (id, data) => {
      const user = users.find((u) => u.id === id)
      Object.assign(user, data)
      return user
    },
  }
}

describe('user service', () => {
  it('creates a user with a bcrypt-hashed password and no passwordHash in the result', async () => {
    const repo = fakeUserRepository()
    const service = createUserService({ userRepository: repo })
    const user = await service.createUser({
      name: 'New Surveyor',
      email: 'new@isp.local',
      password: 'StrongPass1',
      role: 'SURVEYOR',
    })

    expect(user).not.toHaveProperty('passwordHash')
    expect(user.email).toBe('new@isp.local')
    expect(bcrypt.compareSync('StrongPass1', repo.users[0].passwordHash)).toBe(true)
  })

  it('hashes a new password on update and never returns passwordHash', async () => {
    const repo = fakeUserRepository([
      { id: 'u1', email: 'a@isp.local', passwordHash: 'old', role: 'SURVEYOR', isActive: true },
    ])
    const service = createUserService({ userRepository: repo })
    const updated = await service.updateUser('u1', { password: 'NewPass123' })
    expect(updated).not.toHaveProperty('passwordHash')
    expect(bcrypt.compareSync('NewPass123', repo.users[0].passwordHash)).toBe(true)
  })

  it('rejects updating email to one another user already has (409)', async () => {
    const repo = fakeUserRepository([
      { id: 'u1', email: 'a@isp.local', role: 'ADMIN' },
      { id: 'u2', email: 'b@isp.local', role: 'SURVEYOR' },
    ])
    const service = createUserService({ userRepository: repo })
    await expect(service.updateUser('u2', { email: 'a@isp.local' })).rejects.toMatchObject({
      status: 409,
    })
  })

  it('allows keeping the same email on update', async () => {
    const repo = fakeUserRepository([{ id: 'u1', email: 'a@isp.local', role: 'ADMIN' }])
    const service = createUserService({ userRepository: repo })
    const updated = await service.updateUser('u1', { email: 'a@isp.local', name: 'Renamed' })
    expect(updated.name).toBe('Renamed')
  })

  it('rejects a duplicate email with 409', async () => {
    const repo = fakeUserRepository([{ id: 'u1', email: 'dup@isp.local' }])
    const service = createUserService({ userRepository: repo })
    await expect(
      service.createUser({
        name: 'Dup',
        email: 'dup@isp.local',
        password: 'StrongPass1',
        role: 'SURVEYOR',
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('lists users without password hashes', async () => {
    const repo = fakeUserRepository([
      { id: 'u1', email: 'a@isp.local', passwordHash: 'x', role: 'ADMIN' },
    ])
    const service = createUserService({ userRepository: repo })
    const users = await service.listUsers()
    expect(users[0]).not.toHaveProperty('passwordHash')
  })

  it('updates role and isActive', async () => {
    const repo = fakeUserRepository([
      { id: 'u1', email: 'a@isp.local', passwordHash: 'x', role: 'SURVEYOR', isActive: true },
    ])
    const service = createUserService({ userRepository: repo })
    const updated = await service.updateUser('u1', { role: 'MANAGER', isActive: false })
    expect(updated.role).toBe('MANAGER')
    expect(updated.isActive).toBe(false)
    expect(updated).not.toHaveProperty('passwordHash')
  })

  it('clears fiber access when a ticked user moves to a role that cannot hold it', async () => {
    const repo = fakeUserRepository([
      { id: 'u1', email: 'a@isp.local', passwordHash: 'x', role: 'SURVEYOR', canManageFiber: true },
    ])
    const service = createUserService({ userRepository: repo })
    const updated = await service.updateUser('u1', { role: 'ACQUISITION_AGENT' })
    expect(updated.canManageFiber).toBe(false)
  })

  it('keeps fiber access when a ticked user moves between map roles', async () => {
    const repo = fakeUserRepository([
      { id: 'u1', email: 'a@isp.local', passwordHash: 'x', role: 'SURVEYOR', canManageFiber: true },
    ])
    const service = createUserService({ userRepository: repo })
    const updated = await service.updateUser('u1', { role: 'SUPERVISOR' })
    expect(updated.canManageFiber).toBe(true)
  })

  it('setAccess ticks a surveyor and refuses a role that cannot hold fiber access', async () => {
    const repo = fakeUserRepository([
      { id: 'u1', email: 'a@isp.local', passwordHash: 'x', role: 'SURVEYOR', canManageFiber: false },
      { id: 'u2', email: 'b@isp.local', passwordHash: 'x', role: 'ACQUISITION_AGENT', canManageFiber: false },
    ])
    const service = createUserService({ userRepository: repo })
    const ticked = await service.setAccess('u1', { canManageFiber: true })
    expect(ticked.canManageFiber).toBe(true)
    expect(ticked).not.toHaveProperty('passwordHash')
    await expect(service.setAccess('u2', { canManageFiber: true })).rejects.toMatchObject({ status: 400 })
    await expect(service.setAccess('nope', { canManageFiber: true })).rejects.toMatchObject({ status: 404 })
  })

  it('the fake repository only has methods the real one has', async () => {
    const { userRepository: real } = await import('../src/modules/users/user.repository.js')
    for (const key of Object.keys(fakeUserRepository())) {
      if (key === 'users') continue
      expect(typeof real[key], `userRepository.${key}`).toBe('function')
    }
  })

  it('clears the building-edit grant when a ticked surveyor stops being one', async () => {
    const repo = fakeUserRepository([
      { id: 'u1', email: 'a@isp.local', passwordHash: 'x', role: 'SURVEYOR', canEditBuildings: true },
    ])
    const service = createUserService({ userRepository: repo })
    expect((await service.updateUser('u1', { role: 'MANAGER' })).canEditBuildings).toBe(false)
  })

  it('setAccess touches only the ticks the request names', async () => {
    const repo = fakeUserRepository([
      {
        id: 'u1',
        email: 'a@isp.local',
        passwordHash: 'x',
        role: 'SURVEYOR',
        canManageFiber: true,
        canEditBuildings: false,
      },
    ])
    const service = createUserService({ userRepository: repo })
    const updated = await service.setAccess('u1', { canEditBuildings: true })
    expect(updated.canEditBuildings).toBe(true)
    expect(updated.canManageFiber).toBe(true)
  })
})
