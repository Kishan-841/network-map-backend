import { describe, it, expect, vi } from 'vitest'
import { createPartnerReferralService } from '../src/modules/partner-referrals/partner-referral.service.js'

/**
 * A partner introducing someone else (partner-network.md §7).
 *
 * §7.1 leaves who follows up, whether the referrer earns anything, and
 * whether chains exist all open. Capture must not wait on any of that —
 * losing the introduction is worse than not yet paying for it.
 */
const REFERRER = { id: 'p1', status: 'APPROVED', onboardedById: 'e1', mobile: '9812300001' }

const build = ({ existingPartner = null, existingReferral = null } = {}) => {
  const repo = {
    create: vi.fn(async (data) => ({ id: 'ref1', status: 'NEW', ...data })),
    findOpenByMobile: vi.fn(async () => existingReferral),
    listForPartner: vi.fn(async () => []),
    listForStaff: vi.fn(async () => []),
    findById: vi.fn(async () => existingReferral),
    update: vi.fn(async (id, data) => ({ id, ...data })),
  }
  const partnerRepository = { findByMobile: vi.fn(async () => existingPartner) }
  return { repo, partnerRepository,
    service: createPartnerReferralService({ partnerReferralRepository: repo, partnerRepository }) }
}

const INPUT = { name: 'Suresh Kale', type: 'RETAIL_SHOP', mobile: '9812399999' }

describe('making an introduction', () => {
  it('records it against the partner who made it', async () => {
    const { repo, service } = build()
    await service.introduce(INPUT, REFERRER)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ referredById: 'p1', name: 'Suresh Kale', mobile: '9812399999' }),
    )
  })

  it('snapshots the referrer’s employee, so follow-up has an owner', async () => {
    const { repo, service } = build()
    await service.introduce(INPUT, REFERRER)
    expect(repo.create.mock.calls[0][0].employeeId).toBe('e1')
  })

  it('works while the referrer is still awaiting approval', async () => {
    // §2: the pitch tools work from minute one; only adding leads waits.
    const { repo, service } = build()
    await service.introduce(INPUT, { ...REFERRER, status: 'PENDING_APPROVAL' })
    expect(repo.create).toHaveBeenCalled()
  })

  it('refuses a suspended partner', async () => {
    const { repo, service } = build()
    await expect(
      service.introduce(INPUT, { ...REFERRER, status: 'SUSPENDED' }),
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('will not let a partner introduce themselves', async () => {
    const { repo, service } = build()
    await expect(
      service.introduce({ ...INPUT, mobile: REFERRER.mobile }, REFERRER),
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('says so plainly when that number is already a partner', async () => {
    const { repo, service } = build({ existingPartner: { id: 'p9' } })
    await expect(service.introduce(INPUT, REFERRER)).rejects.toMatchObject({ status: 409 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('does not leak WHO the existing partner is', async () => {
    const { service } = build({ existingPartner: { id: 'p9', name: 'Rival Reseller' } })
    const message = await service.introduce(INPUT, REFERRER).catch((e) => e.message)
    expect(message).not.toContain('Rival')
    expect(message).not.toContain('p9')
  })

  it('refuses a second introduction of someone already introduced', async () => {
    const { repo, service } = build({ existingReferral: { id: 'ref0', status: 'NEW' } })
    await expect(service.introduce(INPUT, REFERRER)).rejects.toMatchObject({ status: 409 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('allows a fresh introduction after an earlier one was declined', async () => {
    // findOpenByMobile only returns live ones, so a declined introduction is
    // not a permanent block on that person.
    const { repo, service } = build({ existingReferral: null })
    await service.introduce(INPUT, REFERRER)
    expect(repo.create).toHaveBeenCalled()
  })
})

describe('what staff can do with an introduction', () => {
  const OWNER = { id: 'e1', role: 'PARTNER_MANAGER' }
  const OTHER = { id: 'e2', role: 'PARTNER_MANAGER' }
  const ADMIN = { id: 'a1', role: 'ADMIN' }
  const REF = { id: 'ref1', status: 'NEW', employeeId: 'e1' }

  it('a partner manager may move their own', async () => {
    const { repo, service } = build({ existingReferral: REF })
    await service.changeStatus('ref1', 'CONTACTED', OWNER)
    expect(repo.update).toHaveBeenCalledWith('ref1', { status: 'CONTACTED' })
  })

  it('a partner manager may not move someone else’s', async () => {
    const { repo, service } = build({ existingReferral: REF })
    await expect(
      service.changeStatus('ref1', 'CONTACTED', OTHER),
    ).rejects.toMatchObject({ status: 404 })
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('an admin may move any', async () => {
    const { repo, service } = build({ existingReferral: { ...REF, employeeId: 'someone' } })
    await service.changeStatus('ref1', 'JOINED', ADMIN)
    expect(repo.update).toHaveBeenCalled()
  })

  it('rejects a status we do not have', async () => {
    const { service } = build({ existingReferral: REF })
    await expect(service.changeStatus('ref1', 'WIZARD', ADMIN)).rejects.toMatchObject({
      status: 400,
    })
  })
})

/**
 * The wiring, not the logic.
 *
 * The unit tests above pass a fake repository, so they cannot notice that the
 * real one is missing a method — which is exactly what shipped: findByMobile
 * lives on the partner AUTH repository, not the profile one, and the route
 * injected the wrong object. This asserts against the real modules.
 */
describe('the real repositories satisfy what the service calls', () => {
  it('has every method the service depends on', async () => {
    const { partnerReferralRepository } = await import(
      '../src/modules/partner-referrals/partner-referral.repository.js'
    )
    const { partnerAuthRepository } = await import(
      '../src/modules/partner-auth/partner-auth.repository.js'
    )
    for (const fn of ['create', 'findOpenByMobile', 'listForPartner', 'listForStaff', 'findById', 'update']) {
      expect(typeof partnerReferralRepository[fn], `partnerReferralRepository.${fn}`).toBe('function')
    }
    expect(typeof partnerAuthRepository.findByMobile).toBe('function')
  })
})

/**
 * Turning an introduction into a partner.
 *
 * The partner manager calls the person, then sends them a join link. The
 * introduction is "onboarded" only when that link has actually been used —
 * issuing one proves nothing.
 */
describe('inviting someone who was introduced', () => {
  const REF = { id: 'ref1', name: 'Suresh Kale', status: 'NEW', employeeId: 'e1', invites: [] }
  const OWNER = { id: 'e1', role: 'PARTNER_MANAGER' }
  const OTHER = { id: 'e2', role: 'PARTNER_MANAGER' }
  const ADMIN = { id: 'a1', role: 'ADMIN' }

  const withInvites = (referral = REF) => {
    const repo = {
      findById: vi.fn(async () => referral),
      update: vi.fn(async (id, data) => ({ id, ...data })),
      create: vi.fn(),
      findOpenByMobile: vi.fn(),
      listForPartner: vi.fn(),
      listForStaff: vi.fn(),
    }
    const invites = {
      createInvite: vi.fn(async () => ({ id: 'inv1', token: 'tok', expiresAt: new Date('2026-09-08') })),
      revoke: vi.fn(async () => ({})),
    }
    return { repo, invites,
      service: createPartnerReferralService({
        partnerReferralRepository: repo, partnerRepository: { findByMobile: vi.fn() },
        inviteService: invites,
      }) }
  }

  it('raises a link bound to the introduction and the manager', async () => {
    const { invites, service } = withInvites()
    const out = await service.inviteFor('ref1', OWNER)
    expect(invites.createInvite).toHaveBeenCalledWith({ employeeId: 'e1', referralId: 'ref1' })
    expect(out.token).toBe('tok')
  })

  it('moves a new introduction to Contacted — a link means they were reached', async () => {
    const { repo, service } = withInvites()
    await service.inviteFor('ref1', OWNER)
    expect(repo.update).toHaveBeenCalledWith('ref1', { status: 'CONTACTED' })
  })

  it('leaves a status alone once it has moved past New', async () => {
    const { repo, service } = withInvites({ ...REF, status: 'CONTACTED' })
    await service.inviteFor('ref1', OWNER)
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('revokes a live link before issuing another, so only one can be used', async () => {
    const live = { id: 'old', usedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 8.64e7) }
    const { invites, service } = withInvites({ ...REF, invites: [live] })
    await service.inviteFor('ref1', OWNER)
    expect(invites.revoke).toHaveBeenCalledWith('old')
  })

  it('does not revoke a link that was already used', async () => {
    const used = { id: 'old', usedAt: new Date(), revokedAt: null, expiresAt: new Date() }
    const { invites, service } = withInvites({ ...REF, invites: [used] })
    await service.inviteFor('ref1', OWNER)
    expect(invites.revoke).not.toHaveBeenCalled()
  })

  it('refuses to invite someone who has already joined', async () => {
    const { invites, service } = withInvites({ ...REF, status: 'JOINED' })
    await expect(service.inviteFor('ref1', OWNER)).rejects.toMatchObject({ status: 409 })
    expect(invites.createInvite).not.toHaveBeenCalled()
  })

  it('a partner manager cannot invite from another manager’s introduction', async () => {
    const { invites, service } = withInvites()
    await expect(service.inviteFor('ref1', OTHER)).rejects.toMatchObject({ status: 404 })
    expect(invites.createInvite).not.toHaveBeenCalled()
  })

  it('an admin may invite from any', async () => {
    const { invites, service } = withInvites({ ...REF, employeeId: 'someone-else' })
    await service.inviteFor('ref1', ADMIN)
    expect(invites.createInvite).toHaveBeenCalled()
  })
})

describe('when the link is actually used', () => {
  it('marks the introduction joined and records which partner they became', async () => {
    const repo = {
      findById: vi.fn(async () => ({ id: 'ref1', status: 'CONTACTED' })),
      update: vi.fn(async (id, data) => ({ id, ...data })),
    }
    const service = createPartnerReferralService({
      partnerReferralRepository: repo, partnerRepository: {},
    })
    await service.markJoined('ref1', 'p9')
    expect(repo.update).toHaveBeenCalledWith('ref1', {
      status: 'JOINED',
      joinedPartnerId: 'p9',
    })
  })

  it('is a quiet no-op when the introduction has gone', async () => {
    const repo = { findById: vi.fn(async () => null), update: vi.fn() }
    const service = createPartnerReferralService({
      partnerReferralRepository: repo, partnerRepository: {},
    })
    await expect(service.markJoined('gone', 'p9')).resolves.toBeNull()
    expect(repo.update).not.toHaveBeenCalled()
  })
})
