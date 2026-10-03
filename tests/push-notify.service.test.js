import { describe, it, expect, vi } from 'vitest'
import { createNotifier, CHANNEL_ID } from '../src/lib/push/notify.service.js'

const quietLog = () => ({ log: vi.fn(), error: vi.fn() })
const deps = ({ tokens = ['ExponentPushToken[a]', 'ExponentPushToken[b]'], tickets, send } = {}) => ({
  tokenRepository: {
    listForPartner: vi.fn(async () => tokens.map((token) => ({ token }))),
    removeTokens: vi.fn(async () => {}),
  },
  push: { send: send ?? vi.fn(async (msgs) => tickets ?? msgs.map(() => ({ status: 'ok', id: 'x' }))) },
  log: quietLog(),
})

describe('notifyPartner', () => {
  it('sends one message per phone, built from the catalogue, on the lead channel', async () => {
    const d = deps()
    const out = await createNotifier(d).notifyPartner('p1', 'lead.interested', { leadId: 'l1', customerName: 'Ravi' })
    const msgs = d.push.send.mock.calls[0][0]
    expect(msgs.map((m) => m.to)).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]'])
    expect(msgs[0]).toMatchObject({ title: 'Good news: Ravi is interested', channelId: CHANNEL_ID, data: { kind: 'lead.interested', leadId: 'l1' } })
    expect(out).toEqual({ sent: 2 })
  })

  it('does nothing for a partner with no phones registered', async () => {
    const d = deps({ tokens: [] })
    expect(await createNotifier(d).notifyPartner('p1', 'lead.interested', { leadId: 'l1' })).toEqual({ sent: 0 })
    expect(d.push.send).not.toHaveBeenCalled()
  })

  it('forgets phones Expo says no longer have the app, and only those', async () => {
    const d = deps({
      tickets: [
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } },
      ],
    })
    await createNotifier(d).notifyPartner('p1', 'lead.interested', { leadId: 'l1' })
    expect(d.tokenRepository.removeTokens).toHaveBeenCalledWith(['ExponentPushToken[a]'])
  })

  it('never throws — a provider outage is logged, not raised', async () => {
    const d = deps({ send: vi.fn(async () => { throw new Error('Expo down') }) })
    await expect(createNotifier(d).notifyPartner('p1', 'lead.interested', { leadId: 'l1' })).resolves.toEqual({ sent: 0 })
    expect(d.log.error).toHaveBeenCalled()
  })

  it('sends in the partner\'s language', async () => {
    const d = deps()
    d.tokenRepository.listForPartner = vi.fn(async () => [{ token: 'ExponentPushToken[a]', partner: { preferredLanguage: 'HI' } }])
    await createNotifier(d).notifyPartner('p1', 'partner.approved', {})
    expect(d.push.send.mock.calls[0][0][0].title).toMatch(/[\u0900-\u097F]/)
  })

  it('never throws on an unknown kind either', async () => {
    const d = deps()
    await expect(createNotifier(d).notifyPartner('p1', 'nope', {})).resolves.toEqual({ sent: 0 })
    expect(d.push.send).not.toHaveBeenCalled()
  })
})
