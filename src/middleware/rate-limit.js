import rateLimit from 'express-rate-limit'

const json = (res, message) =>
  res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } })

// Brute-force / credential-stuffing guard on login. Keyed by IP; failed and
// successful attempts both count. Disabled under NODE_ENV=test so the suite
// (which logs in repeatedly) isn't throttled.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => json(res, 'Too many login attempts. Try again in a few minutes.'),
})

// Caps upload volume per user/IP so a token can't rack up unbounded R2 storage.
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => json(res, 'Too many uploads. Slow down and try again shortly.'),
})

/**
 * Partner sign-in. Separate bucket from staff login so a busy partner
 * channel cannot lock our own team out.
 */
export const partnerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Tight where it matters; workable locally. A developer fighting their own
  // rate limiter learns nothing about the real one.
  limit: process.env.NODE_ENV === 'production' ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => json(res, 'Too many attempts. Try again in a few minutes.'),
})

/**
 * OTP requests cost us money in production (SMS, email) and are the obvious
 * thing to abuse, so the cap is tight there. In development the same cap
 * makes the flow untestable after a handful of runs, and a developer working
 * around their own rate limiter learns nothing about the real one.
 */
export const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 5 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => json(res, 'Too many code requests. Try again in a few minutes.'),
})

/**
 * A partner asking "can you serve this building?" is legitimate. Asking it
 * across a grid of coordinates is downloading our coverage map, so the
 * feasibility check is capped well above honest use and far below scraping.
 */
export const feasibilityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => json(res, 'Too many checks. Try again in a few minutes.'),
})

/** IFSC lookups: a form types a handful; this stops anyone using us as a free proxy. */
export const ifscLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => json(res, 'Too many lookups. Try again in a few minutes.'),
})
