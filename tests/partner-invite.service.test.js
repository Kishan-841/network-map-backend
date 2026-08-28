import { describe, it, expect, vi } from 'vitest'
import { createInviteService } from '../src/modules/partner-invites/invite.service.js'

const future = () => new Date(Date.now() + 60_000)
const past = () => new Date(Date.now() - 60_000)

const deps = (invite) => ({
  inviteRepository: {
    create: vi.fn(async (d) => ({ id: 'i1', ...d })),
    findByTokenHash: vi.fn(async () => invite ?? null),
    markUsed: vi.fn(async () => {}),
    findById: vi.fn(async () => invite ?? null),
  },
})

describe('creating an invite', () => {
  it('returns the raw token once and stores only a hash of it', async () => {
    const d = deps()
    const out = await createInviteService(d).createInvite({ employeeId: 'e1' })
    expect(out.token).toMatch(/^[a-f0-9]{32,}$/)
    const stored = d.inviteRepository.create.mock.calls[0][0].tokenHash
    expect(stored).not.toBe(out.token)
    expect(stored).not.toContain(out.token)
  })

  it('sets an expiry in the future', async () => {
    const out = await createInviteService(deps()).createInvite({ employeeId: 'e1' })
    expect(out.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('does not repeat tokens', async () => {
    const svc = createInviteService(deps())
    const a = await svc.createInvite({ employeeId: 'e1' })
    const b = await svc.createInvite({ employeeId: 'e1' })
    expect(a.token).not.toBe(b.token)
  })
})

describe('consuming an invite', () => {
  it('refuses an unknown token', async () => {
    await expect(createInviteService(deps(null)).peekInvite('nope')).rejects.toMatchObject({
      status: 400,
    })
  })

  it('refuses an expired invite', async () => {
    const svc = createInviteService(deps({ id: 'i1', expiresAt: past(), usedAt: null, revokedAt: null }))
    await expect(svc.peekInvite('tok')).rejects.toMatchObject({ status: 400 })
  })

  it('refuses an invite that was already used', async () => {
    const svc = createInviteService(
      deps({ id: 'i1', expiresAt: future(), usedAt: new Date(), revokedAt: null }),
    )
    await expect(svc.peekInvite('tok')).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a revoked invite', async () => {
    const svc = createInviteService(
      deps({ id: 'i1', expiresAt: future(), usedAt: null, revokedAt: new Date() }),
    )
    await expect(svc.peekInvite('tok')).rejects.toMatchObject({ status: 400 })
  })

  it('gives one identical message for every bad invite', async () => {
    const msg = async (invite) =>
      createInviteService(deps(invite)).peekInvite('tok').catch((e) => e.message)
    const expired = await msg({ id: 'i1', expiresAt: past(), usedAt: null, revokedAt: null })
    const used = await msg({ id: 'i1', expiresAt: future(), usedAt: new Date(), revokedAt: null })
    const revoked = await msg({ id: 'i1', expiresAt: future(), usedAt: null, revokedAt: new Date() })
    const unknown = await msg(null)
    expect(new Set([expired, used, revoked, unknown]).size).toBe(1)
  })

  it('returns the employee to attribute a good invite to', async () => {
    const d = deps({ id: 'i1', employeeId: 'e9', expiresAt: future(), usedAt: null, revokedAt: null })
    const invite = await createInviteService(d).peekInvite('tok')
    expect(invite.employeeId).toBe('e9')
  })

  it('marks the invite used against the new partner', async () => {
    const d = deps({ id: 'i1', employeeId: 'e9', expiresAt: future(), usedAt: null, revokedAt: null })
    await createInviteService(d).markUsed('i1', 'p1')
    expect(d.inviteRepository.markUsed).toHaveBeenCalledWith('i1', 'p1')
  })
})
