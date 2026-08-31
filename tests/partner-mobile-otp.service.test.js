import { describe, it, expect, vi } from 'vitest'
import { createPartnerAuthService } from '../src/modules/partner-auth/partner-auth.service.js'

/**
 * v2 login: the mobile number is the identity and there is no password at all.
 * The partner is not a technical user — nothing to remember, nothing to type
 * but the number they already know.
 */
const partner = {
  id: 'p1', mobile: '9822011234', email: 'shop@x.com',
  status: 'APPROVED', name: 'Shop', type: 'RETAIL_SHOP',
}

const deps = (over = {}) => ({
  partnerRepository: {
    findByMobile: vi.fn(async (m) => (m === partner.mobile ? partner : null)),
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
  showOtp: over.showOtp ?? false,
})

describe('asking for a code', () => {
  it('is keyed on the mobile number', async () => {
    const d = deps()
    await createPartnerAuthService(d).requestOtp({ mobile: partner.mobile })
    expect(d.otpRepository.create.mock.calls[0][0].identifier).toBe(partner.mobile)
  })

  it('tells an existing partner apart from a new one, so signup can follow', async () => {
    const svc = createPartnerAuthService(deps())
    expect((await svc.requestOtp({ mobile: partner.mobile })).registered).toBe(true)
    expect((await svc.requestOtp({ mobile: '9000000000' })).registered).toBe(false)
  })

  it('still issues a code for an UNKNOWN number, so signup can verify it', async () => {
    const d = deps()
    await createPartnerAuthService(d).requestOtp({ mobile: '9000000000' })
    expect(d.otpRepository.create).toHaveBeenCalled()
  })

  it('refuses anything that is not an Indian mobile number', async () => {
    const svc = createPartnerAuthService(deps())
    for (const bad of ['123', '1234567890', 'abcdefghij', '98220112345']) {
      await expect(svc.requestOtp({ mobile: bad })).rejects.toMatchObject({ status: 400 })
    }
  })
})

describe('the testing-only on-screen code', () => {
  it('is withheld by default', async () => {
    const out = await createPartnerAuthService(deps()).requestOtp({ mobile: partner.mobile })
    expect(out.devCode).toBeUndefined()
    expect(JSON.stringify(out)).not.toMatch(/\d{6}/)
  })

  it('is returned only when the flag is on', async () => {
    const out = await createPartnerAuthService(deps({ showOtp: true })).requestOtp({
      mobile: partner.mobile,
    })
    expect(out.devCode).toMatch(/^\d{6}$/)
  })
})

describe('verifying the code', () => {
  it('signs an existing partner in', async () => {
    const d = deps({
      otpRepository: { findActive: vi.fn(async () => ({ id: 'o1', codeHash: 'h', attempts: 0 })) },
    })
    const svc = createPartnerAuthService({ ...d, verifyCode: async () => true })
    const out = await svc.verifyOtp({ mobile: partner.mobile, code: '123456' })
    expect(out.token).toBeTruthy()
    expect(out.partner.id).toBe('p1')
  })

  it('reports a verified NEW number as needing signup rather than failing', async () => {
    const d = deps({
      partnerRepository: { findByMobile: vi.fn(async () => null) },
      otpRepository: { findActive: vi.fn(async () => ({ id: 'o1', codeHash: 'h', attempts: 0 })) },
    })
    const svc = createPartnerAuthService({ ...d, verifyCode: async () => true })
    const out = await svc.verifyOtp({ mobile: '9000000000', code: '123456' })
    expect(out.needsSignup).toBe(true)
    expect(out.signupToken).toBeTruthy()
    expect(out.token).toBeUndefined()
  })

  it('gives one message for every failure', async () => {
    const svc = createPartnerAuthService(deps())
    const a = await svc.verifyOtp({ mobile: partner.mobile, code: '111111' }).catch((e) => e.message)
    const b = await svc.verifyOtp({ mobile: '9000000000', code: '111111' }).catch((e) => e.message)
    expect(a).toBe(b)
  })
})

describe('signing up', () => {
  it('refuses without a signup token from a verified code', async () => {
    await expect(
      createPartnerAuthService(deps()).register({
        name: 'New', type: 'DSA', mobile: '9000000000',
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('needs no password — there is no such thing any more', async () => {
    const d = deps({
      partnerRepository: { findByMobile: vi.fn(async () => null) },
      otpRepository: { findActive: vi.fn(async () => ({ id: 'o1', codeHash: 'h', attempts: 0 })) },
    })
    const svc = createPartnerAuthService({ ...d, verifyCode: async () => true })
    const { signupToken } = await svc.verifyOtp({ mobile: '9000000000', code: '123456' })
    const out = await svc.register({
      name: 'New Shop', type: 'RETAIL_SHOP', mobile: '9000000000', signupToken,
    })
    expect(out.token).toBeTruthy()
    expect(d.partnerRepository.create.mock.calls[0][0].passwordHash).toBeUndefined()
  })

  it('will not let a signup token mint an account for a DIFFERENT number', async () => {
    const d = deps({
      partnerRepository: { findByMobile: vi.fn(async () => null) },
      otpRepository: { findActive: vi.fn(async () => ({ id: 'o1', codeHash: 'h', attempts: 0 })) },
    })
    const svc = createPartnerAuthService({ ...d, verifyCode: async () => true })
    const { signupToken } = await svc.verifyOtp({ mobile: '9000000000', code: '123456' })
    await expect(
      svc.register({ name: 'Hijack', type: 'DSA', mobile: '9811111111', signupToken }),
    ).rejects.toMatchObject({ status: 400 })
  })
})
