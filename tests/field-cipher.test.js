import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { createFieldCipher } from '../src/lib/field-cipher.js'

const key = () => crypto.randomBytes(32).toString('base64')

describe('field cipher', () => {
  it('round-trips a value', () => {
    const c = createFieldCipher(key())
    expect(c.decrypt(c.encrypt('001234567890'))).toBe('001234567890')
  })

  it('never stores the plain value and uses a fresh IV each time', () => {
    const c = createFieldCipher(key())
    const a = c.encrypt('123456789012')
    const b = c.encrypt('123456789012')
    expect(a).not.toContain('123456789012')
    expect(a).not.toBe(b)
    expect(a.split(':')).toHaveLength(4)
    expect(a.startsWith('v1:')).toBe(true)
  })

  it('refuses a key that is not 32 bytes', () => {
    expect(() => createFieldCipher(crypto.randomBytes(16).toString('base64'))).toThrow(/32 bytes/)
    expect(() => createFieldCipher(undefined)).toThrow(/32 bytes/)
  })

  it('fails to decrypt with the wrong key', () => {
    const stored = createFieldCipher(key()).encrypt('123456789012')
    expect(() => createFieldCipher(key()).decrypt(stored)).toThrow()
  })

  it('fails to decrypt a tampered value', () => {
    const c = createFieldCipher(key())
    const [v, iv, tag, data] = c.encrypt('123456789012').split(':')
    const flipped = Buffer.from(data, 'base64')
    flipped[0] ^= 1
    expect(() => c.decrypt([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
    expect(() => c.decrypt('garbage')).toThrow(/Unreadable/)
  })
})
