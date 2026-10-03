import { describe, it, expect, vi } from 'vitest'
import { createPartnerService } from '../src/modules/partners/partner.service.js'

const base = { id: 'p1', status: 'REGISTERED' }
const doc = (type) => ({ type, url: 'https://cdn/uploads/x.jpg' })

const deps = (partner, docs = []) => ({
  partnerRepository: {
    findById: vi.fn(async () => partner),
    listDocuments: vi.fn(async () => docs),
    update: vi.fn(async (id, data) => ({ ...partner, ...data })),
    upsertDocument: vi.fn(async (d) => d),
  },
  storage: {
    canonicalUrl: (u) => u,
    keyFromUrl: (u) => (u.includes('/uploads/') ? 'k' : null),
    readUrl: async (u) => `${u}?signed=1`,
  },
})

describe('submitting documents for approval', () => {
  it('refuses when Aadhaar is missing', async () => {
    const svc = createPartnerService(deps(base, [doc('PAN')]))
    await expect(svc.submitDocuments('p1')).rejects.toMatchObject({ status: 400 })
  })

  it('refuses when PAN is missing', async () => {
    const svc = createPartnerService(deps(base, [doc('AADHAAR')]))
    await expect(svc.submitDocuments('p1')).rejects.toMatchObject({ status: 400 })
  })

  it('names what is missing rather than just failing', async () => {
    const svc = createPartnerService(deps(base, []))
    const msg = await svc.submitDocuments('p1').catch((e) => e.message)
    expect(msg).toMatch(/Aadhaar/i)
    expect(msg).toMatch(/PAN/i)
  })

  it('accepts Aadhaar + PAN', async () => {
    const d = deps(base, [doc('AADHAAR'), doc('PAN')])
    await createPartnerService(d).submitDocuments('p1')
    expect(d.partnerRepository.update).toHaveBeenCalledWith('p1', { status: 'PENDING_APPROVAL' })
  })

  it('asks for Aadhaar and PAN only — nothing else', async () => {
    const d = deps(base, [doc('AADHAAR'), doc('PAN')])
    const svc = createPartnerService(d)
    expect(svc.requiredDocuments()).toEqual(['AADHAAR', 'PAN'])
    await svc.submitDocuments('p1')
    expect(d.partnerRepository.update).toHaveBeenCalledWith('p1', { status: 'PENDING_APPROVAL' })
  })

  it('refuses a document url that did not come from our uploads API', async () => {
    const svc = createPartnerService(deps(base))
    await expect(
      svc.saveDocument('p1', { type: 'PAN', url: 'https://evil.example/x.jpg' }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('the approval gate', () => {
  it('blocks every state that is not APPROVED', () => {
    const svc = createPartnerService(deps(base))
    for (const status of ['REGISTERED', 'PENDING_APPROVAL', 'REJECTED', 'SUSPENDED']) {
      expect(() => svc.assertApproved({ status })).toThrow()
    }
  })

  it('lets an approved partner through', () => {
    const svc = createPartnerService(deps(base))
    expect(() => svc.assertApproved({ status: 'APPROVED' })).not.toThrow()
  })
})

describe('admin decisions', () => {
  it('records who approved and when', async () => {
    const d = deps({ ...base, status: 'PENDING_APPROVAL' })
    await createPartnerService(d).approve('p1', 'admin1')
    const [, data] = d.partnerRepository.update.mock.calls[0]
    expect(data.status).toBe('APPROVED')
    expect(data.approvedById).toBe('admin1')
    expect(data.approvedAt).toBeInstanceOf(Date)
    expect(data.rejectionReason).toBeNull()
  })

  it('records the reason on rejection so the partner can fix it', async () => {
    const d = deps({ ...base, status: 'PENDING_APPROVAL' })
    await createPartnerService(d).reject('p1', 'Aadhaar unreadable', 'admin1')
    expect(d.partnerRepository.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ status: 'REJECTED', rejectionReason: 'Aadhaar unreadable' }),
    )
  })

  it('will not approve a partner who has not submitted anything', async () => {
    const d = deps({ ...base, status: 'REGISTERED' })
    await expect(createPartnerService(d).approve('p1', 'admin1')).rejects.toMatchObject({
      status: 400,
    })
  })
})

describe('telling the partner the decision (push)', () => {
  const pending = { id: 'p1', status: 'PENDING_APPROVAL' }
  const withNotify = (partner, notifyPartner = vi.fn(async () => ({ sent: 1 }))) => ({ ...deps(partner), notifyPartner })
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('notifies on approval', async () => {
    const d = withNotify(pending)
    await createPartnerService(d).approve('p1', 'admin1')
    await flush()
    expect(d.notifyPartner).toHaveBeenCalledWith('p1', 'partner.approved', {})
  })

  it('notifies on rejection', async () => {
    const d = withNotify(pending)
    await createPartnerService(d).reject('p1', 'Photo is blurred', 'admin1')
    await flush()
    expect(d.notifyPartner).toHaveBeenCalledWith('p1', 'partner.rejected', {})
  })

  it('does not notify when the approval itself is refused', async () => {
    const d = withNotify({ id: 'p1', status: 'REGISTERED' })
    await expect(createPartnerService(d).approve('p1', 'admin1')).rejects.toMatchObject({ status: 400 })
    await flush()
    expect(d.notifyPartner).not.toHaveBeenCalled()
  })

  it('still approves when the notification fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = withNotify(pending, vi.fn(async () => { throw new Error('push down') }))
    await expect(createPartnerService(d).approve('p1', 'admin1')).resolves.toMatchObject({ status: 'APPROVED' })
    await flush()
    err.mockRestore()
  })
})
