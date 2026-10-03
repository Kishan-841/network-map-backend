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

/**
 * Converting a lead is the moment money comes into existence, so the status
 * change and the earning have to succeed or fail together.
 */
describe('converting a lead', () => {
  const withEarnings = (lead = { id: 'l1', status: 'CONTACTED', partnerId: 'p1', employeeId: 'e1' }) => {
    const d = deps(lead)
    const earnings = {
      // No earning yet: this is a lead about to be converted for the first time.
      findForLead: vi.fn(async () => null),
      recordConversion: vi.fn(async () => ({ id: 'earn1', amount: 750 })),
      revokeConversion: vi.fn(async () => null),
    }
    return { d, earnings, service: createLeadService({ ...d, earningService: earnings }) }
  }

  it('records the earning for the plan that was sold', async () => {
    const { earnings, service } = withEarnings()
    await service.changeStatus('l1', 'CONVERTED', ADMIN, null, {
      speedMbps: 400, billingPeriod: 'YEARLY',
    })
    expect(earnings.recordConversion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'l1' }),
      { speedMbps: 400, billingPeriod: 'YEARLY' },
    )
  })

  it('will not convert without knowing what the customer bought', async () => {
    const { d, earnings, service } = withEarnings()
    await expect(
      service.changeStatus('l1', 'CONVERTED', ADMIN),
    ).rejects.toMatchObject({ status: 400 })
    // The status must not move either — a Converted lead with no earning is
    // exactly the silent gap this whole change exists to close.
    expect(d.leadRepository.update).not.toHaveBeenCalled()
    expect(earnings.recordConversion).not.toHaveBeenCalled()
  })

  it('leaves the lead alone when the earning cannot be created', async () => {
    const { d, earnings, service } = withEarnings()
    earnings.recordConversion.mockRejectedValue(Object.assign(new Error('no rate'), { status: 400 }))
    await expect(
      service.changeStatus('l1', 'CONVERTED', ADMIN, null, { speedMbps: 300, billingPeriod: 'QUARTERLY' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(d.leadRepository.update).not.toHaveBeenCalled()
  })

  it('takes the earning back when the lead moves out of Converted', async () => {
    const { earnings, service } = withEarnings({
      id: 'l1', status: 'CONVERTED', partnerId: 'p1', employeeId: 'e1',
    })
    await service.changeStatus('l1', 'NOT_INTERESTED', ADMIN)
    expect(earnings.revokeConversion).toHaveBeenCalledWith('l1')
  })

  it('does not revoke when the lead was never converted', async () => {
    const { earnings, service } = withEarnings()
    await service.changeStatus('l1', 'INTERESTED', ADMIN)
    expect(earnings.revokeConversion).not.toHaveBeenCalled()
  })

  it('refuses to move a lead whose earning is already paid', async () => {
    const { d, earnings, service } = withEarnings({
      id: 'l1', status: 'CONVERTED', partnerId: 'p1', employeeId: 'e1',
    })
    earnings.revokeConversion.mockRejectedValue(
      Object.assign(new Error('already paid'), { status: 409 }),
    )
    await expect(
      service.changeStatus('l1', 'CONTACTED', ADMIN),
    ).rejects.toMatchObject({ status: 409 })
    expect(d.leadRepository.update).not.toHaveBeenCalled()
  })

  it('ignores a plan on a status that is not Converted', async () => {
    const { earnings, service } = withEarnings()
    await service.changeStatus('l1', 'INTERESTED', ADMIN, null, {
      speedMbps: 400, billingPeriod: 'YEARLY',
    })
    expect(earnings.recordConversion).not.toHaveBeenCalled()
  })

  it('is a no-op on the earning when Converted is re-selected', async () => {
    const { earnings, service } = withEarnings({
      id: 'l1', status: 'CONVERTED', partnerId: 'p1', employeeId: 'e1',
    })
    earnings.findForLead.mockResolvedValue({ id: 'earn1', amount: 750 })
    await service.changeStatus('l1', 'CONVERTED', ADMIN, null, {
      speedMbps: 100, billingPeriod: 'HALF_YEARLY',
    })
    expect(earnings.revokeConversion).not.toHaveBeenCalled()
    expect(earnings.recordConversion).not.toHaveBeenCalled()
  })
})

/**
 * Leads converted before earnings existed sit in CONVERTED with no earning
 * behind them. The money is real and unrecorded, so re-picking Converted has
 * to be the repair path rather than a no-op.
 */
describe('a lead converted before its earning existed', () => {
  const missingEarning = () => {
    const lead = { id: 'l1', status: 'CONVERTED', partnerId: 'p1', employeeId: 'e1' }
    const d = deps(lead)
    const earnings = {
      findForLead: vi.fn(async () => null),
      recordConversion: vi.fn(async () => ({ id: 'earn1', amount: 750 })),
      revokeConversion: vi.fn(async () => null),
    }
    return { d, earnings, service: createLeadService({ ...d, earningService: earnings }) }
  }

  it('records the earning when Converted is picked again', async () => {
    const { earnings, service } = missingEarning()
    await service.changeStatus('l1', 'CONVERTED', ADMIN, null, {
      speedMbps: 100, billingPeriod: 'HALF_YEARLY',
    })
    expect(earnings.recordConversion).toHaveBeenCalled()
  })

  it('still insists on knowing the plan', async () => {
    const { earnings, service } = missingEarning()
    await expect(service.changeStatus('l1', 'CONVERTED', ADMIN)).rejects.toMatchObject({
      status: 400,
    })
    expect(earnings.recordConversion).not.toHaveBeenCalled()
  })

  it('does not ask again once the earning is there', async () => {
    const { earnings, service } = missingEarning()
    earnings.findForLead.mockResolvedValue({ id: 'earn1', amount: 750 })
    await service.changeStatus('l1', 'CONVERTED', ADMIN)
    expect(earnings.recordConversion).not.toHaveBeenCalled()
  })
})
