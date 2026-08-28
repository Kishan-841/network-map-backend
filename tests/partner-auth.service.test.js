import { describe, it, expect, vi } from 'vitest'
import { createPartnerAuthService } from '../src/modules/partner-auth/partner-auth.service.js'

const partner = {
  id: 'p1',
  email: 'shop@x.com',
  // a real bcrypt hash of 'correct-horse'
  passwordHash: '$2b$10$7JYOPvEweMMuZ2ocHkDSt.ZqzH5PAFJNMHu01UERN39UwwIT7W5oa',
  status: 'APPROVED',
  name: 'Shop',
  type: 'RETAIL_SHOP',
}

const deps = (over = {}) => ({
  partnerRepository: {
    findByEmail: vi.fn(async (e) => (e === partner.email ? partner : null)),
    findById: vi.fn(async () => partner),
    create: vi.fn(async (d) => ({ id: 'new', status: 'REGISTERED', ...d })),
    ...(over.partnerRepository ?? {}),
  },
  otpRepository: {
    create: vi.fn(async (d) => ({ id: 'o1', attempts: 0, ...d })),
    findActive: vi.fn(async () => null),
    lastIssuedAt: vi.fn(async () => null),
    consume: vi.fn(async () => {}),
    bumpAttempts: vi.fn(async () => {}),
    ...(over.otpRepository ?? {}),
  },
  mailer: over.mailer ?? { send: vi.fn(async () => {}) },
})

describe('requesting an OTP', () => {
  it('never reveals whether the address is registered', async () => {
    const d = deps()
    const svc = createPartnerAuthService(d)
    const known = await svc.requestOtp({ email: partner.email })
    const unknown = await svc.requestOtp({ email: 'nobody@x.com' })
    expect(known).toEqual(unknown)
    expect(known).toEqual({ sent: true })
  })

  it('sends no mail at all for an unknown address', async () => {
    const d = deps()
    await createPartnerAuthService(d).requestOtp({ email: 'nobody@x.com' })
    expect(d.mailer.send).not.toHaveBeenCalled()
    expect(d.otpRepository.create).not.toHaveBeenCalled()
  })

  it('emails a six-digit code to a real partner', async () => {
    const d = deps()
    await createPartnerAuthService(d).requestOtp({ email: partner.email })
    expect(d.mailer.send).toHaveBeenCalledOnce()
    expect(d.mailer.send.mock.calls[0][0].text).toMatch(/\d{6}/)
  })

  it('stores only a hash of the code, never the code itself', async () => {
    const d = deps()
    await createPartnerAuthService(d).requestOtp({ email: partner.email })
    const code = d.mailer.send.mock.calls[0][0].text.match(/(\d{6})/)[1]
    expect(d.otpRepository.create.mock.calls[0][0].codeHash).not.toContain(code)
  })

  it('refuses a resend inside the cooldown, still without revealing anything', async () => {
    const d = deps({ otpRepository: { lastIssuedAt: vi.fn(async () => new Date()) } })
    const out = await createPartnerAuthService(d).requestOtp({ email: partner.email })
    expect(out).toEqual({ sent: true })
    expect(d.mailer.send).not.toHaveBeenCalled()
  })
})

describe('verifying an OTP', () => {
  it('rejects when there is no active challenge', async () => {
    await expect(
      createPartnerAuthService(deps()).verifyOtp({ email: partner.email, code: '123456' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('locks out once the attempt cap is reached, without counting further', async () => {
    const d = deps({
      otpRepository: {
        findActive: vi.fn(async () => ({ id: 'o1', codeHash: 'x', attempts: 5 })),
      },
    })
    await expect(
      createPartnerAuthService(d).verifyOtp({ email: partner.email, code: '000000' }),
    ).rejects.toMatchObject({ status: 401 })
    expect(d.otpRepository.bumpAttempts).not.toHaveBeenCalled()
  })

  it('counts a wrong attempt', async () => {
    const d = deps({
      otpRepository: {
        findActive: vi.fn(async () => ({ id: 'o1', codeHash: 'not-a-match', attempts: 0 })),
      },
    })
    await expect(
      createPartnerAuthService(d).verifyOtp({ email: partner.email, code: '000000' }),
    ).rejects.toMatchObject({ status: 401 })
    expect(d.otpRepository.bumpAttempts).toHaveBeenCalledWith('o1')
  })

  it('gives one identical message for every failure mode', async () => {
    const svc = createPartnerAuthService(deps())
    const noChallenge = await svc
      .verifyOtp({ email: partner.email, code: '111111' })
      .catch((e) => e.message)
    const unknownEmail = await svc
      .verifyOtp({ email: 'nobody@x.com', code: '111111' })
      .catch((e) => e.message)
    expect(noChallenge).toBe(unknownEmail)
  })
})

describe('password login', () => {
  it('signs in with the right password', async () => {
    const out = await createPartnerAuthService(deps()).login({
      email: partner.email,
      password: 'correct-horse',
    })
    expect(out.token).toBeTruthy()
    expect(out.partner.id).toBe('p1')
  })

  it('never returns the password hash', async () => {
    const out = await createPartnerAuthService(deps()).login({
      email: partner.email,
      password: 'correct-horse',
    })
    expect(JSON.stringify(out)).not.toContain('passwordHash')
    expect(out.partner.passwordHash).toBeUndefined()
  })

  it('gives the same error for a wrong password and an unknown address', async () => {
    const svc = createPartnerAuthService(deps())
    const unknown = await svc.login({ email: 'nobody@x.com', password: 'x' }).catch((e) => e.message)
    const wrong = await svc.login({ email: partner.email, password: 'wrong' }).catch((e) => e.message)
    expect(unknown).toBe(wrong)
  })

  it('refuses a suspended partner', async () => {
    const d = deps({
      partnerRepository: { findByEmail: vi.fn(async () => ({ ...partner, status: 'SUSPENDED' })) },
    })
    await expect(
      createPartnerAuthService(d).login({ email: partner.email, password: 'correct-horse' }),
    ).rejects.toMatchObject({ status: 401 })
  })
})
