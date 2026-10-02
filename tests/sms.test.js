import { describe, it, expect, vi } from 'vitest'
import { createConsoleSms } from '../src/lib/sms/console-sms.js'
import { createMsg91Sms } from '../src/lib/sms/msg91-sms.js'

/**
 * The SMS drivers only DELIVER a code — generating, hashing and checking it
 * stays in partner-auth.service. So each driver has one job: get
 * `{ mobile, code }` onto the phone, or throw.
 */

const reply = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
})

const msg91 = (fetchImpl, over = {}) =>
  createMsg91Sms({ authKey: 'test-key', templateId: 'tpl-1', otpVar: 'otp', fetchImpl, ...over })

describe('console SMS driver', () => {
  it('prints the code instead of sending it, so dev costs nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await createConsoleSms().sendOtp({ mobile: '9822011234', code: '123456' })
    const printed = log.mock.calls.flat().join('\n')
    expect(printed).toContain('9822011234')
    expect(printed).toContain('123456')
    log.mockRestore()
  })
})

describe('MSG91 SMS driver', () => {
  it('posts the DLT template with the code as its variable', async () => {
    const fetchImpl = vi.fn(async () => reply({ type: 'success', message: 'req-1' }))
    await msg91(fetchImpl).sendOtp({ mobile: '9822011234', code: '123456' })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://control.msg91.com/api/v5/flow')
    expect(init.method).toBe('POST')
    expect(init.headers.authkey).toBe('test-key')
    expect(JSON.parse(init.body)).toEqual({
      template_id: 'tpl-1',
      short_url: '0',
      // MSG91 wants the country code; our numbers are stored as 10 digits.
      recipients: [{ mobiles: '919822011234', otp: '123456' }],
    })
  })

  it('logs the request id MSG91 returns, with the number masked', async () => {
    // MSG91 answers "success" before it has tried to deliver anything, so the
    // request id is the only handle for finding a lost SMS in its logs.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchImpl = vi.fn(async () => reply({ type: 'success', message: '3669abc' }))
    const out = await msg91(fetchImpl).sendOtp({ mobile: '9822011234', code: '123456' })
    const printed = log.mock.calls.flat().join(' ')
    log.mockRestore()
    expect(out).toEqual({ requestId: '3669abc' })
    expect(printed).toContain('3669abc')
    expect(printed).toContain('1234') // last four digits, to tell numbers apart
    expect(printed).not.toContain('9822011234')
    expect(printed).not.toContain('123456') // never log the code itself
  })

  it('uses whatever variable name the template was registered with', async () => {
    const fetchImpl = vi.fn(async () => reply({ type: 'success', message: 'req-1' }))
    await msg91(fetchImpl, { otpVar: 'VAR1' }).sendOtp({ mobile: '9822011234', code: '654321' })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).recipients[0]).toEqual({
      mobiles: '919822011234',
      VAR1: '654321',
    })
  })

  it('throws when MSG91 answers with an error, even on HTTP 200', async () => {
    const fetchImpl = vi.fn(async () => reply({ type: 'error', message: 'Invalid template' }))
    await expect(msg91(fetchImpl).sendOtp({ mobile: '9822011234', code: '1' })).rejects.toThrow(
      /Invalid template/,
    )
  })

  it('throws on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => reply({}, false, 401))
    await expect(msg91(fetchImpl).sendOtp({ mobile: '9822011234', code: '1' })).rejects.toThrow(
      /401/,
    )
  })

  it('throws when the network call itself fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    await expect(msg91(fetchImpl).sendOtp({ mobile: '9822011234', code: '1' })).rejects.toThrow()
  })
})

describe('both drivers', () => {
  it('offer the same methods, so swapping SMS_DRIVER never breaks a caller', () => {
    const keys = (o) => Object.keys(o).sort()
    expect(keys(createMsg91Sms({ authKey: 'k', templateId: 't' }))).toEqual(
      keys(createConsoleSms()),
    )
  })
})
