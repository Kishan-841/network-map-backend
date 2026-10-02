import { describe, it, expect, vi } from 'vitest'
import { createLeadMilestones } from '../src/modules/leads/lead-notify.js'

const lead = { id: 'l1', partnerId: 'p1', customerName: 'Ravi Kumar' }
const setup = () => {
  const notifyPartner = vi.fn(async () => ({ sent: 1 }))
  return { notifyPartner, hook: createLeadMilestones({ notifyPartner }) }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('notifyLeadMilestone', () => {
  it('tells the partner when a lead becomes interested', async () => {
    const { notifyPartner, hook } = setup()
    hook({ lead, fromStatus: 'CONTACTED', toStatus: 'INTERESTED' })
    await flush()
    expect(notifyPartner).toHaveBeenCalledWith('p1', 'lead.interested', { leadId: 'l1', customerName: 'Ravi Kumar' })
  })

  it('tells the partner what they earned when a lead converts', async () => {
    const { notifyPartner, hook } = setup()
    hook({ lead, fromStatus: 'INTERESTED', toStatus: 'CONVERTED', earning: { amount: 750 } })
    await flush()
    expect(notifyPartner).toHaveBeenCalledWith('p1', 'lead.converted', { leadId: 'l1', customerName: 'Ravi Kumar', amount: 750 })
  })

  it('stays quiet when the status did not actually change (repairing a conversion)', async () => {
    const { notifyPartner, hook } = setup()
    hook({ lead, fromStatus: 'CONVERTED', toStatus: 'CONVERTED', earning: { amount: 750 } })
    await flush()
    expect(notifyPartner).not.toHaveBeenCalled()
  })

  it('tells the partner about every status a lead can move to', async () => {
    const { notifyPartner, hook } = setup()
    const expected = {
      NEW: 'lead.requeued',
      CONTACTED: 'lead.contacted',
      NOT_INTERESTED: 'lead.not_interested',
      UNREACHABLE: 'lead.unreachable',
      DUPLICATE: 'lead.duplicate',
    }
    for (const toStatus of Object.keys(expected)) hook({ lead, fromStatus: 'INTERESTED', toStatus })
    await flush()
    expect(notifyPartner.mock.calls.map((c) => c[1])).toEqual(Object.values(expected))
  })

  it('stays quiet for a status it has no words for', async () => {
    const { notifyPartner, hook } = setup()
    hook({ lead, fromStatus: 'NEW', toStatus: 'SOMETHING_NEW' })
    await flush()
    expect(notifyPartner).not.toHaveBeenCalled()
  })

  it('stays quiet for a lead no partner sent us', async () => {
    const { notifyPartner, hook } = setup()
    hook({ lead: { ...lead, partnerId: null }, fromStatus: 'NEW', toStatus: 'INTERESTED' })
    await flush()
    expect(notifyPartner).not.toHaveBeenCalled()
  })

  it('does not throw even if sending rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hook = createLeadMilestones({ notifyPartner: vi.fn(async () => { throw new Error('x') }) })
    expect(() => hook({ lead, fromStatus: 'NEW', toStatus: 'INTERESTED' })).not.toThrow()
    await flush()
    err.mockRestore()
  })
})
