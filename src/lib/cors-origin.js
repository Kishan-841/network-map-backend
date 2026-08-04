/**
 * Builds a `cors` origin option from a CORS_ORIGIN config string.
 * - '*' → allow all (dev).
 * - Comma list of exact origins, where any entry may use '*' as a wildcard
 *   (e.g. https://app-*.vercel.app) so Vercel preview URLs are allowed.
 * Requests with no Origin header (curl / server-to-server) are allowed.
 */
export function buildCorsOrigin(corsOrigin) {
  if (corsOrigin === '*') return '*'

  const matchers = corsOrigin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((pattern) =>
      pattern.includes('*')
        ? new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`)
        : pattern,
    )

  return (requestOrigin, callback) => {
    if (!requestOrigin) return callback(null, true)
    const ok = matchers.some((m) =>
      typeof m === 'string' ? m === requestOrigin : m.test(requestOrigin),
    )
    callback(ok ? null : new Error('Not allowed by CORS'), ok)
  }
}
