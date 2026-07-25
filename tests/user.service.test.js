import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { createUserService } from '../src/modules/users/user.service.js'

function fakeUserRepository(seed = []) {
  const users = [...seed]
  return {
    users,
    findByEmail: async (email) => users.find((u) => u.email === email) ?? null,
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
})
