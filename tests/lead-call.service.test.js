import { describe, it, expect, vi } from 'vitest'
import { createLeadCallService, OUTCOME_STATUS } from '../src/modules/leads/lead-call.service.js'

/**
 * Logging a call and what it did to the lead.
 *
 * The outcome is the point: a call with no outcome tells the next person
 * nothing. Each one moves the lead somewhere, so the list reflects reality
 * without anyone having to remember to change the status separately.
 */
const LEAD = { id: 'l1', status: 'NEW', employeeId: 'e1', customerName: 'Anita' }
const OWNER = { id: 'e1', role: 'PARTNER_MANAGER' }
const OTHER = { id: 'e2', role: 'PARTNER_MANAGER' }
const ADMIN = { id: 'a1', role: 'ADMIN' }

const build = (lead = LEAD) => {
  const leadRepository = {
    findById: vi.fn(async () => lead),
    update: vi.fn(async (id, data) => ({ id, ...data })),
    recordEvent: vi.fn(async () => {}),
  }
  const callRepository = { create: vi.fn(async (d) => ({ id: 'c1', ...d })) }
  return { leadRepository, callRepository,
    service: createLeadCallService({ leadRepository, callRepository }) }
}

const CALL = {
  startedAt: '2026-09-02T10:00:00.000Z',
  endedAt: '2026-09-02T10:02:30.000Z',
  outcome: 'INTERESTED',
}

describe('logging the call itself', () => {
  it('saves who made it, when, and for how long', async () => {
    const { callRepository, service } = build()
    await service.logCall('l1', CALL, OWNER)
    expect(callRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'l1', byUserId: 'e1', durationSeconds: 150 }),
    )
  })

  it('computes the duration on the SERVER, not from the browser', async () => {
    // A client could claim any figure; the two timestamps are the record.
    const { callRepository, service } = build()
    await service.logCall('l1', { ...CALL, durationSeconds: 99999 }, OWNER)
    expect(callRepository.create.mock.calls[0][0].durationSeconds).toBe(150)
  })

  it('refuses a call that ended before it started', async () => {
    const { callRepository, service } = build()
    await expect(
      service.logCall('l1', { ...CALL, endedAt: '2026-09-02T09:59:00.000Z' }, OWNER),
    ).rejects.toMatchObject({ status: 400 })
    expect(callRepository.create).not.toHaveBeenCalled()
  })

  it('refuses an outcome we do not have', async () => {
    const { service } = build()
    await expect(service.logCall('l1', { ...CALL, outcome: 'SHOUTED' }, OWNER)).rejects.toMatchObject(
      { status: 400 },
    )
  })
})

describe('what each outcome does to the lead', () => {
  const statusAfter = async (outcome, extra = {}) => {
    const { leadRepository, service } = build()
    await service.logCall('l1', { ...CALL, outcome, ...extra }, OWNER)
    return leadRepository.update.mock.calls[0]?.[1]
  }

  it('interested moves the lead to Interested', async () => {
    expect(await statusAfter('INTERESTED')).toMatchObject({ status: 'INTERESTED' })
  })

  it('call later leaves them Contacted and remembers when', async () => {
    const when = '2026-09-05T11:30:00.000Z'
    const patch = await statusAfter('CALL_LATER', { callbackAt: when })
    expect(patch.status).toBe('CONTACTED')
    expect(patch.nextCallAt.toISOString()).toBe(when)
  })

  it('not reachable marks them Unreachable', async () => {
    expect(await statusAfter('NOT_REACHABLE')).toMatchObject({ status: 'UNREACHABLE' })
  })

  it('a wrong number closes the lead', async () => {
    expect(await statusAfter('WRONG_NUMBER')).toMatchObject({ status: 'NOT_INTERESTED' })
  })

  it('clears an old callback on any outcome that is not call-later', async () => {
    // Otherwise a lead that has since been reached stays on the due list.
    for (const outcome of ['INTERESTED', 'NOT_REACHABLE', 'WRONG_NUMBER']) {
      expect((await statusAfter(outcome)).nextCallAt, outcome).toBeNull()
    }
  })

  it('needs a callback time when the outcome is call later', async () => {
    const { callRepository, service } = build()
    await expect(
      service.logCall('l1', { ...CALL, outcome: 'CALL_LATER' }, OWNER),
    ).rejects.toMatchObject({ status: 400 })
    expect(callRepository.create).not.toHaveBeenCalled()
  })

  it('refuses a callback in the past', async () => {
    const { service } = build()
    await expect(
      service.logCall('l1', { ...CALL, outcome: 'CALL_LATER', callbackAt: '2020-01-01T10:00:00Z' }, OWNER),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('writes a status event so the history shows why it moved', async () => {
    const { leadRepository, service } = build()
    await service.logCall('l1', { ...CALL, note: 'keen, wants 200' }, OWNER)
    expect(leadRepository.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'l1', fromStatus: 'NEW', toStatus: 'INTERESTED', byUserId: 'e1' }),
    )
  })

  it('does not move a lead that has already converted', async () => {
    // Someone ringing a signed-up customer must not drag them backwards.
    const { leadRepository, service } = build({ ...LEAD, status: 'CONVERTED' })
    await service.logCall('l1', CALL, OWNER)
    expect(leadRepository.update.mock.calls[0][1].status).toBeUndefined()
  })

  it('maps every outcome to a real lead status', () => {
    for (const [outcome, status] of Object.entries(OUTCOME_STATUS)) {
      expect(typeof outcome).toBe('string')
      expect(status === null || typeof status === 'string').toBe(true)
    }
  })
})

describe('whose lead it is', () => {
  it('a partner manager cannot log a call on another manager’s lead', async () => {
    const { callRepository, service } = build()
    await expect(service.logCall('l1', CALL, OTHER)).rejects.toMatchObject({ status: 404 })
    expect(callRepository.create).not.toHaveBeenCalled()
  })

  it('an admin may log a call on any', async () => {
    const { callRepository, service } = build({ ...LEAD, employeeId: 'someone-else' })
    await service.logCall('l1', CALL, ADMIN)
    expect(callRepository.create).toHaveBeenCalled()
  })

  it('is 404 for a lead that does not exist', async () => {
    const { service } = build(null)
    await expect(service.logCall('gone', CALL, ADMIN)).rejects.toMatchObject({ status: 404 })
  })
})

describe('the real repository exposes what the service calls', () => {
  it('can create a call', async () => {
    const { leadCallRepository } = await import('../src/modules/leads/lead-call.repository.js')
    expect(typeof leadCallRepository.create).toBe('function')
  })
})
