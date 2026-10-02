import { describe, it, expect, vi } from 'vitest'
import { createLeadService } from '../src/modules/leads/lead.service.js'

const approved = { id: 'p1', status: 'APPROVED', onboardedById: 'e1', name: 'Meena' }
const lead = { customerName: 'Ravi', customerMobile: '9800000000', buildingId: 'b1' }

const deps = (existing = null) => ({
  leadRepository: {
    create: vi.fn(async (d) => ({ id: 'l1', status: 'NEW', ...d })),
    findOpenByMobile: vi.fn(async () => existing),
    listByPartner: vi.fn(async () => []),
    recordEvent: vi.fn(async () => {}),
    findById: vi.fn(async () => ({ id: 'l1', status: 'NEW', partnerId: 'p1' })),
    update: vi.fn(async (id, d) => ({ id, ...d })),
  },
})

describe('creating a lead', () => {
  it('refuses a partner who is not approved', async () => {
    for (const status of ['REGISTERED', 'PENDING_APPROVAL', 'REJECTED']) {
      await expect(
        createLeadService(deps()).createLead(lead, { ...approved, status }),
      ).rejects.toMatchObject({ status: 403 })
    }
  })

  it('snapshots the employee, so re-assignment cannot rewrite history', async () => {
    const d = deps()
    await createLeadService(d).createLead(lead, approved)
    expect(d.leadRepository.create.mock.calls[0][0].employeeId).toBe('e1')
  })

  it('records the opening status event', async () => {
    const d = deps()
    await createLeadService(d).createLead(lead, approved)
    expect(d.leadRepository.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'l1', toStatus: 'NEW' }),
    )
  })

  it('marks a repeat mobile as a duplicate — the first partner keeps it', async () => {
    const d = deps({ id: 'l0', partnerId: 'someone-else' })
    const out = await createLeadService(d).createLead(lead, approved)
    expect(out.status).toBe('DUPLICATE')
    expect(out.duplicateOfId).toBe('l0')
  })

  it('says nothing about the partner who got there first', async () => {
    const d = deps({ id: 'l0', partnerId: 'rival-partner-name' })
    const out = await createLeadService(d).createLead(lead, approved)
    expect(JSON.stringify(out)).not.toContain('rival-partner-name')
  })

  it('lets the SAME partner re-submit without it counting as a duplicate steal', async () => {
    const d = deps({ id: 'l0', partnerId: 'p1' })
    const out = await createLeadService(d).createLead(lead, approved)
    expect(out.status).toBe('DUPLICATE')
    expect(out.duplicateOfId).toBe('l0')
  })
})

describe('a partner only ever sees their own leads', () => {
  it('scopes the list to the caller', async () => {
    const d = deps()
    await createLeadService(d).listForPartner('p1')
    expect(d.leadRepository.listByPartner).toHaveBeenCalledWith('p1')
  })
})

describe('staff moving a lead along', () => {
  it('writes an event with the old and new status', async () => {
    const d = deps()
    await createLeadService(d).changeStatus(
      'l1', 'CONTACTED', { id: 'user9', role: 'ADMIN' }, 'called them',
    )
    expect(d.leadRepository.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'l1', fromStatus: 'NEW', toStatus: 'CONTACTED', byUserId: 'user9',
      }),
    )
  })

  it('rejects a status we do not have', async () => {
    await expect(
      createLeadService(deps()).changeStatus('l1', 'WIZARD', { id: 'user9', role: 'ADMIN' }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('lead milestones (push)', () => {
  const lead = { id: 'l1', status: 'CONTACTED', partnerId: 'p1', customerName: 'Ravi' }
  const withHook = (overrides = {}) => {
    const notifyLeadMilestone = vi.fn()
    const leadRepository = {
      findById: vi.fn(async () => lead),
      update: vi.fn(async (id, d) => ({ ...lead, ...d })),
      recordEvent: vi.fn(async () => {}),
    }
    const earningService = {
      findForLead: vi.fn(async () => null),
      recordConversion: vi.fn(async () => ({ amount: 750 })),
      revokeConversion: vi.fn(async () => {}),
    }
    return { notifyLeadMilestone, leadRepository, earningService, ...overrides }
  }

  it('reports the move, with the new earning, after it is saved', async () => {
    const d = withHook()
    await createLeadService(d).changeStatus('l1', 'CONVERTED', { role: 'ADMIN' }, null, { speedMbps: 100, billingPeriod: 'HALF_YEARLY' })
    expect(d.leadRepository.update).toHaveBeenCalled()
    expect(d.notifyLeadMilestone).toHaveBeenCalledWith({ lead, fromStatus: 'CONTACTED', toStatus: 'CONVERTED', earning: { amount: 750 } })
  })

  it('passes the existing earning when a conversion is re-picked', async () => {
    const d = withHook()
    d.earningService.findForLead = vi.fn(async () => ({ amount: 500 }))
    await createLeadService(d).changeStatus('l1', 'CONVERTED', { role: 'ADMIN' })
    expect(d.notifyLeadMilestone.mock.calls[0][0].earning).toEqual({ amount: 500 })
  })

  it('still saves the status if the notifier throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = withHook({ notifyLeadMilestone: vi.fn(() => { throw new Error('push down') }) })
    await expect(createLeadService(d).changeStatus('l1', 'INTERESTED', { role: 'ADMIN' })).resolves.toBeTruthy()
    expect(d.leadRepository.recordEvent).toHaveBeenCalled()
    err.mockRestore()
  })
})
