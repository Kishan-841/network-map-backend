import { describe, it, expect, vi } from 'vitest'
import { createDirectPartnerService } from '../src/modules/partners/direct-add.service.js'

/**
 * A partner manager adding someone they already know, with no invite link.
 *
 * The account exists from that moment, so the person can sign in with their
 * mobile straight away — the OTP flow finds them like any other partner. What
 * they CANNOT do is skip the document check: adding someone you trust is not
 * the same as having seen their Aadhaar.
 */
const build = ({ byMobile = null, byEmail = null } = {}) => {
  const repo = {
    findByMobile: vi.fn(async () => byMobile),
    findByEmail: vi.fn(async () => byEmail),
    create: vi.fn(async (data) => ({ id: 'p1', ...data })),
  }
  return { repo, service: createDirectPartnerService({ partnerAuthRepository: repo }) }
}
const PM = { id: 'e1', role: 'PARTNER_MANAGER' }
const INPUT = { name: 'Suresh Kale', type: 'RETAIL_SHOP', mobile: '9812399999' }

describe('adding a partner directly', () => {
  it('creates them against the manager who added them', async () => {
    const { repo, service } = build()
    await service.addPartner(INPUT, PM)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Suresh Kale', type: 'RETAIL_SHOP', mobile: '9812399999', onboardedById: 'e1',
      }),
    )
  })

  it('starts them at REGISTERED, not APPROVED', async () => {
    // Being added by someone you trust is not the same as having shown us a
    // document. They sign in, then upload; the lead gate stays where it is.
    const { repo, service } = build()
    await service.addPartner(INPUT, PM)
    expect(repo.create.mock.calls[0][0].status).toBe('REGISTERED')
  })

  it('stores no email when none was given, rather than an empty string', async () => {
    // email is UNIQUE — a second '' would collide with the first.
    const { repo, service } = build()
    await service.addPartner({ ...INPUT, email: '' }, PM)
    expect(repo.create.mock.calls[0][0].email).toBeNull()
  })

  it('keeps an email when one is given', async () => {
    const { repo, service } = build()
    await service.addPartner({ ...INPUT, email: 'a@b.com' }, PM)
    expect(repo.create.mock.calls[0][0].email).toBe('a@b.com')
  })

  it('refuses a mobile that is already a partner', async () => {
    const { repo, service } = build({ byMobile: { id: 'p9' } })
    await expect(service.addPartner(INPUT, PM)).rejects.toMatchObject({ status: 409 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('refuses an email that is already a partner', async () => {
    const { repo, service } = build({ byEmail: { id: 'p9' } })
    await expect(
      service.addPartner({ ...INPUT, email: 'taken@b.com' }, PM),
    ).rejects.toMatchObject({ status: 409 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('does not look up an email that was not given', async () => {
    const { repo, service } = build()
    await service.addPartner(INPUT, PM)
    expect(repo.findByEmail).not.toHaveBeenCalled()
  })

  it('says which field clashed, so the manager can fix it', async () => {
    const mobile = await build({ byMobile: { id: 'p9' } })
      .service.addPartner(INPUT, PM)
      .catch((e) => e.message)
    const email = await build({ byEmail: { id: 'p9' } })
      .service.addPartner({ ...INPUT, email: 'a@b.com' }, PM)
      .catch((e) => e.message)
    expect(mobile).toMatch(/number/i)
    expect(email).toMatch(/email/i)
    expect(mobile).not.toBe(email)
  })

  it('trims the name, so a stray space does not become part of it', async () => {
    const { repo, service } = build()
    await service.addPartner({ ...INPUT, name: '  Suresh Kale  ' }, PM)
    expect(repo.create.mock.calls[0][0].name).toBe('Suresh Kale')
  })
})

describe('the real repository exposes what the service calls', () => {
  it('can look a partner up by email', async () => {
    const { partnerAuthRepository } = await import(
      '../src/modules/partner-auth/partner-auth.repository.js'
    )
    for (const fn of ['findByMobile', 'findByEmail', 'create']) {
      expect(typeof partnerAuthRepository[fn], fn).toBe('function')
    }
  })
})
