import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'

// Lighter than a password hash on purpose: the code lives five minutes and
// is attempt-capped, so the cost that matters is the login latency, not
// resistance to an offline crack of a dead credential.
const OTP_ROUNDS = 8

/**
 * A 6-digit code from a CSPRNG. Never Math.random for a credential — it is
 * seeded predictably and its output can be reconstructed from a few samples.
 * Padded so 000123 stays a six-digit code rather than becoming 123.
 */
export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export const hashOtp = (code) => bcrypt.hash(code, OTP_ROUNDS)

/** bcrypt.compare is constant-time, so this leaks nothing through timing. */
export const verifyOtp = (code, hash) => bcrypt.compare(code, hash)
