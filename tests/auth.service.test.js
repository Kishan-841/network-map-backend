import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createAuthService } from '../src/modules/auth/auth.service.js'
import { env } from '../src/config/env.js'

function fakeUserRepository(users) {
  return {
    findByEmail: async (email) => users.find((u) => u.email === email) ?? null,
  }
}

const surveyor = {
  id: 'user-1',
  name: 'Field One',
  email: 'field@isp.local',
  passwordHash: bcrypt.hashSync('correct-password', 4),
  role: 'SURVEYOR',
  isActive: true,
}

describe('auth service login', () => {
  it('returns a signed JWT and public user for valid credentials', async () => {
    const service = createAuthService({ userRepository: fakeUserRepository([surveyor]) })
    const { token, user } = await service.login({
      email: 'field@isp.local',
      password: 'correct-password',
    })

    const payload = jwt.verify(token, env.jwtSecret)
    expect(payload.sub).toBe('user-1')
    expect(payload.role).toBe('SURVEYOR')
    expect(user).not.toHaveProperty('passwordHash')
    expect(user.email).toBe('field@isp.local')
  })

  it('rejects a wrong password with 401', async () => {
    const service = createAuthService({ userRepository: fakeUserRepository([surveyor]) })
    await expect(
      service.login({ email: 'field@isp.local', password: 'wrong' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an unknown email with 401', async () => {
    const service = createAuthService({ userRepository: fakeUserRepository([]) })
    await expect(
      service.login({ email: 'nobody@isp.local', password: 'x' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects a deactivated user with 401', async () => {
    const inactive = { ...surveyor, isActive: false }
    const service = createAuthService({ userRepository: fakeUserRepository([inactive]) })
    await expect(
      service.login({ email: 'field@isp.local', password: 'correct-password' }),
    ).rejects.toMatchObject({ status: 401 })
  })
})
