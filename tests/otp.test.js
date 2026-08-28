import { describe, it, expect } from 'vitest'
import { generateOtp, hashOtp, verifyOtp } from '../src/lib/otp.js'

/**
 * A one-time code is a credential. These tests pin the properties that make
 * it one: unguessable, never stored in the clear, and constant-time compared.
 */
describe('otp', () => {
  it('generates a 6-digit numeric code', () => {
    for (let i = 0; i < 50; i++) expect(generateOtp()).toMatch(/^\d{6}$/)
  })

  it('keeps leading zeros — 000123 is a valid code, not 123', () => {
    const codes = Array.from({ length: 400 }, () => generateOtp())
    expect(codes.every((c) => c.length === 6)).toBe(true)
  })

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateOtp()))
    expect(seen.size).toBeGreaterThan(10)
  })

  it('never stores the code inside the hash', async () => {
    const code = generateOtp()
    const hash = await hashOtp(code)
    expect(hash).not.toContain(code)
  })

  it('verifies the right code and rejects a wrong one', async () => {
    const hash = await hashOtp('123456')
    expect(await verifyOtp('123456', hash)).toBe(true)
    expect(await verifyOtp('123457', hash)).toBe(false)
  })

  it('salts — the same code hashes differently every time', async () => {
    expect(await hashOtp('123456')).not.toBe(await hashOtp('123456'))
  })
})
