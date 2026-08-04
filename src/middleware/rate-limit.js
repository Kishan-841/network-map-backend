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
