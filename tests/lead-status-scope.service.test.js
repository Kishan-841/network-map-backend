import { describe, it, expect, vi } from 'vitest'
import { createLeadService } from '../src/modules/leads/lead.service.js'

/**
 * Who may move a lead along.
 *
 * A partner manager works their own partners' leads and nobody else's — the
 * same boundary the list already enforces, applied to the write side too.
 * Without it, any employee could reach any lead by id.
 */
const lead = { id: 'l1', status: 'NEW', partnerId: 'p1', employeeId: 'e1' }

const deps = (found = lead) => ({
  leadRepository: {
    findById: vi.fn(async () => found),
    update: vi.fn(async (id, d) => ({ id, ...d })),
    recordEvent: vi.fn(async () => {}),
    create: vi.fn(),
    findOpenByMobile: vi.fn(),
    listByPartner: vi.fn(),
  },
})

const ADMIN = { id: 'a1', role: 'ADMIN' }
const OWNER = { id: 'e1', role: 'PARTNER_MANAGER' }
const OTHER = { id: 'e2', role: 'PARTNER_MANAGER' }

describe('a partner manager moving a lead', () => {
  it('may update a lead from their own partner', async () => {
    const d = deps()
    const out = await createLeadService(d).changeStatus('l1', 'CONTACTED', OWNER)
    expect(out.status).toBe('CONTACTED')
  })

  it('may NOT update a lead belonging to another employee', async () => {
    const d = deps()
    await expect(
      createLeadService(d).changeStatus('l1', 'CONTACTED', OTHER),
    ).rejects.toMatchObject({ status: 404 })
    expect(d.leadRepository.update).not.toHaveBeenCalled()
  })

  it('is told 404, not 403 — someone else’s lead should not be confirmed to exist', async () => {
    const msg = await createLeadService(deps())
      .changeStatus('l1', 'CONTACTED', OTHER)
      .catch((e) => e.message)
    const missing = await createLeadService(deps(null))
      .changeStatus('l1', 'CONTACTED', OWNER)
      .catch((e) => e.message)
    expect(msg).toBe(missing)
  })

  it('may not touch an unattributed lead', async () => {
    const d = deps({ ...lead, employeeId: null })
    await expect(
      createLeadService(d).changeStatus('l1', 'CONTACTED', OWNER),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('an admin moving a lead', () => {
  it('may update anyone’s', async () => {
    const d = deps({ ...lead, employeeId: 'someone-else' })
    const out = await createLeadService(d).changeStatus('l1', 'CONVERTED', ADMIN)
    expect(out.status).toBe('CONVERTED')
  })
})

describe('the record of the change', () => {
  it('says who changed it and from what', async () => {
    const d = deps()
    await createLeadService(d).changeStatus('l1', 'INTERESTED', OWNER, 'spoke to them')
    expect(d.leadRepository.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'l1', fromStatus: 'NEW', toStatus: 'INTERESTED',
        byUserId: 'e1', note: 'spoke to them',
      }),
    )
  })

  it('rejects a status we do not have', async () => {
    await expect(
      createLeadService(deps()).changeStatus('l1', 'WIZARD', ADMIN),
    ).rejects.toMatchObject({ status: 400 })
  })
})
