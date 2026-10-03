import { describe, it, expect, vi } from 'vitest'
import { createIfscLookup } from '../src/lib/ifsc.js'

const ok = (json) => vi.fn(async () => ({ ok: true, status: 200, json: async () => json }))

describe('IFSC lookup', () => {
  it('returns bank and branch, upper-casing the code', async () => {
    const fetchImpl = ok({ IFSC: 'HDFC0001234', BANK: 'HDFC Bank', BRANCH: 'CIDCO', CITY: 'AURANGABAD' })
    const lookup = createIfscLookup({ fetchImpl })
    expect(await lookup(' hdfc0001234 ')).toEqual({ ifsc: 'HDFC0001234', bank: 'HDFC Bank', branch: 'CIDCO', city: 'AURANGABAD' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://ifsc.razorpay.com/HDFC0001234')
  })

  it('caches a found code', async () => {
    const fetchImpl = ok({ IFSC: 'HDFC0001234', BANK: 'HDFC Bank', BRANCH: 'CIDCO', CITY: 'X' })
    const lookup = createIfscLookup({ fetchImpl })
    await lookup('HDFC0001234')
    await lookup('HDFC0001234')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('400s a bad format without calling out', async () => {
    const fetchImpl = vi.fn()
    await expect(createIfscLookup({ fetchImpl })('HDFC1')).rejects.toMatchObject({ status: 400 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('404s an unknown code', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }))
    await expect(createIfscLookup({ fetchImpl })('ABCD0123456')).rejects.toMatchObject({ status: 404 })
  })

  it('503s when the service fails or hangs', async () => {
    const boom = vi.fn(async () => { throw new Error('ECONNRESET') })
    await expect(createIfscLookup({ fetchImpl: boom })('ABCD0123456')).rejects.toMatchObject({ status: 503 })
    const hang = vi.fn((url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
    await expect(createIfscLookup({ fetchImpl: hang, timeoutMs: 50 })('ABCD0123456')).rejects.toMatchObject({ status: 503 })
  })
})
