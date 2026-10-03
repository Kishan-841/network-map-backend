import { describe, it, expect, vi } from 'vitest'
import { createConsolePush } from '../src/lib/push/console-push.js'
import { createExpoPush, EXPO_PUSH_URL } from '../src/lib/push/expo-push.js'

const msg = (i) => ({ to: `ExponentPushToken[t${i}]`, title: 'T', body: 'B', data: { kind: 'k' }, channelId: 'lead-updates' })
const reply = (data, ok = true, status = 200) => ({ ok, status, json: async () => ({ data }) })

describe('console push driver', () => {
  it('prints instead of sending and reports every message as ok', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const tickets = await createConsolePush().send([msg(1)])
    expect(log.mock.calls.flat().join(' ')).toContain('T')
    log.mockRestore()
    expect(tickets).toEqual([{ status: 'ok', id: 'console' }])
  })
})

describe('expo push driver', () => {
  it('posts the messages to Expo with sound and high priority', async () => {
    const fetchImpl = vi.fn(async () => reply([{ status: 'ok', id: 'a' }]))
    const tickets = await createExpoPush({ fetchImpl }).send([msg(1)])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(EXPO_PUSH_URL)
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual([{ ...msg(1), sound: 'default', priority: 'high' }])
    expect(tickets).toEqual([{ status: 'ok', id: 'a' }])
  })

  it('sends the access token only when one is configured', async () => {
    const fetchImpl = vi.fn(async () => reply([{ status: 'ok', id: 'a' }]))
    await createExpoPush({ fetchImpl, accessToken: 'secret' }).send([msg(1)])
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer secret')
    const bare = vi.fn(async () => reply([{ status: 'ok', id: 'a' }]))
    await createExpoPush({ fetchImpl: bare }).send([msg(1)])
    expect(bare.mock.calls[0][1].headers.authorization).toBeUndefined()
  })

  it('splits more than 100 messages into batches and keeps ticket order', async () => {
    const fetchImpl = vi.fn(async (_u, init) =>
      reply(JSON.parse(init.body).map((m) => ({ status: 'ok', id: m.to }))),
    )
    const many = Array.from({ length: 150 }, (_, i) => msg(i))
    const tickets = await createExpoPush({ fetchImpl }).send(many)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(tickets.map((t) => t.id)).toEqual(many.map((m) => m.to))
  })

  it('throws on a non-2xx answer', async () => {
    const fetchImpl = vi.fn(async () => reply(null, false, 500))
    await expect(createExpoPush({ fetchImpl }).send([msg(1)])).rejects.toThrow(/500/)
  })

  it('sends nothing for an empty list', async () => {
    const fetchImpl = vi.fn()
    expect(await createExpoPush({ fetchImpl }).send([])).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('both drivers', () => {
  it('offer the same methods', () => {
    const keys = (o) => Object.keys(o).sort()
    expect(keys(createExpoPush({}))).toEqual(keys(createConsolePush()))
  })
})
