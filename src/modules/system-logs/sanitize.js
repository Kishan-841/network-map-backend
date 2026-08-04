const SENSITIVE_KEY = /password|token|secret|authorization|credential|apikey|api_key/i

function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue
      out[key] = stripSensitive(val)
    }
    return out
  }
  return value
}

/**
 * Audit-safe snapshot: JSON round-trip makes Dates/Decimals serializable,
 * then credential-shaped keys are stripped recursively.
 */
export function sanitizeValue(value) {
  if (value === null || value === undefined) return null
  return stripSensitive(JSON.parse(JSON.stringify(value)))
}
