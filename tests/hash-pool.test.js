import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { hashPasswords } from '../src/lib/hash-pool.js'

// Bulk imports hash hundreds of passwords; doing it on the main thread froze
// the whole API for ~32 s per 500 users (13 Oct measurement). The pool hashes
// on worker threads and must produce ordinary bcrypt hashes logins can verify.
describe('hashPasswords (worker threads)', () => {
  it('returns one bcrypt hash per password, in order, that bcrypt.compare accepts', async () => {
    const passwords = ['Alpha123', 'Bravo456', 'Charlie789', 'Alpha123']
    const hashes = await hashPasswords(passwords, 4)
    expect(hashes).toHaveLength(4)
    for (const [i, hash] of hashes.entries()) {
      expect(hash).toMatch(/^\$2[aby]\$04\$/)
      expect(await bcrypt.compare(passwords[i], hash)).toBe(true)
    }
    // Same password, different salt.
    expect(hashes[0]).not.toBe(hashes[3])
  })

  it('handles an empty list without starting workers', async () => {
    expect(await hashPasswords([], 4)).toEqual([])
  })

  it('keeps the event loop free while hashing', async () => {
    let worst = 0
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      worst = Math.max(worst, now - last - 10)
      last = now
    }, 10)
    await hashPasswords(Array.from({ length: 24 }, (_, i) => `Passw0rd${i}`), 10)
    clearInterval(timer)
    expect(worst).toBeLessThan(200)
  })
})
