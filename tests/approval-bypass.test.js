import { describe, it, expect, vi } from 'vitest'
import { createApprovalBypassService } from '../src/modules/partners/approval-bypass.service.js'

/**
 * The testing shortcut that skips document upload.
 *
 * This is a partner approving themselves. The ONLY thing standing between it
 * and a catastrophe is that it cannot exist in production, so that is what
 * most of these assert.
 */
const build = (allowed) => {
  const repo = { update: vi.fn(async (id, data) => ({ id, ...data })) }
  return { repo, service: createApprovalBypassService({ partnerAuthRepository: repo, allowed }) }
}
const PARTNER = { id: 'p1', status: 'REGISTERED' }

describe('when the bypass is switched on', () => {
  it('approves the partner without any documents', async () => {
    const { repo, service } = build(true)
    await service.approveSelf(PARTNER)
    expect(repo.update).toHaveBeenCalledWith('p1', {
      status: 'APPROVED',
      rejectionReason: null,
    })
  })

  it('works from every state a partner can be stuck in', async () => {
    for (const status of ['REGISTERED', 'PENDING_APPROVAL', 'REJECTED']) {
      const { repo, service } = build(true)
      await service.approveSelf({ ...PARTNER, status })
      expect(repo.update).toHaveBeenCalled()
    }
  })

  it('clears a rejection reason, so the old refusal does not linger', async () => {
    const { repo, service } = build(true)
    await service.approveSelf({ ...PARTNER, status: 'REJECTED', rejectionReason: 'blurry' })
    expect(repo.update.mock.calls[0][1].rejectionReason).toBeNull()
  })

  it('still refuses a suspended account', async () => {
    // Suspension is a deliberate act by an admin. A testing shortcut must not
    // be a way around it, or the flag becomes a way to un-ban yourself.
    const { repo, service } = build(true)
    await expect(
      service.approveSelf({ ...PARTNER, status: 'SUSPENDED' }),
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.update).not.toHaveBeenCalled()
  })
})

describe('when the bypass is switched off', () => {
  it('refuses, and does not admit the route exists', async () => {
    const { repo, service } = build(false)
    await expect(service.approveSelf(PARTNER)).rejects.toMatchObject({ status: 404 })
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('is off unless explicitly switched on', async () => {
    const { service } = build(undefined)
    await expect(service.approveSelf(PARTNER)).rejects.toMatchObject({ status: 404 })
  })
})

/**
 * The guard that matters most: this flag must be impossible to leave on in
 * production. Asserted against the real env module, not a fake.
 */
describe('the production guard', () => {
  // Production trips its own earlier checks first, so give it a valid secret;
  // otherwise these assert on the JWT guard rather than the bypass one.
  // The dev .env sets SHOW_OTP_IN_RESPONSE, and that guard fires first — so
  // clear it, or these assert on the wrong one.
  const PROD_OK = {
    JWT_SECRET: 'a-long-enough-production-secret-value',
    SHOW_OTP_IN_RESPONSE: '',
  }

  const load = async (vars) => {
    vi.resetModules()
    const before = { ...process.env }
    Object.assign(process.env, PROD_OK, vars)
    try {
      // vi.resetModules() clears the registry, so a plain specifier
      // re-evaluates the module. A templated one Vite cannot resolve at all.
      return await import('../src/config/env.js')
    } finally {
      process.env = before
    }
  }

  it('refuses to boot with the bypass on in production', async () => {
    await expect(
      load({ NODE_ENV: 'production', ALLOW_APPROVAL_BYPASS: 'true' }),
    ).rejects.toThrow(/not permitted in production/i)
  })

  it('boots fine with it on outside production', async () => {
    const mod = await load({ NODE_ENV: 'development', ALLOW_APPROVAL_BYPASS: 'true' })
    expect(mod.env.allowApprovalBypass).toBe(true)
  })

  it('boots fine in production with it off', async () => {
    const mod = await load({ NODE_ENV: 'production', ALLOW_APPROVAL_BYPASS: '' })
    expect(mod.env.allowApprovalBypass).toBe(false)
  })

  it('is off when the value is anything other than the exact string "true"', async () => {
    for (const value of ['1', 'yes', 'TRUE', 'on']) {
      const mod = await load({ NODE_ENV: 'development', ALLOW_APPROVAL_BYPASS: value })
      expect(mod.env.allowApprovalBypass, value).toBe(false)
    }
  })

  it('also still refuses the OTP flag in production — both guards hold', async () => {
    await expect(
      load({ NODE_ENV: 'production', SHOW_OTP_IN_RESPONSE: 'true' }),
    ).rejects.toThrow(/SHOW_OTP_IN_RESPONSE/)
  })
})

/**
 * The wiring, again. The unit tests above inject a fake repository, so they
 * cannot notice that the real one has no `update` — which is exactly what
 * shipped, as a 500 on the button.
 */
describe('the real repository satisfies what the service calls', () => {
  it('can update a partner', async () => {
    const { partnerAuthRepository } = await import(
      '../src/modules/partner-auth/partner-auth.repository.js'
    )
    expect(typeof partnerAuthRepository.update).toBe('function')
  })
})
