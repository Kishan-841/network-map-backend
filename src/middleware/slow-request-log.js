/**
 * One log line for any request slower than `thresholdMs`, e.g.
 *   [slow] GET /api/v1/fibers 200 812ms 1907.6 KB role=ADMIN
 * so growth shows up in the VM's `docker logs` before users notice. Registered
 * before compression, so the size is what went over the wire (gzipped when
 * the client accepts it). `thresholdMs` 0 = off.
 * Query values named like secrets (token, otp, password, key) are masked.
 */
const SECRET_PARAM = /^(token|otp|code|password|key|signature|sig)$/i

function safeUrl(url) {
  const [path, query] = String(url).split('?')
  if (!query) return path
  const params = new URLSearchParams(query)
  for (const name of [...params.keys()]) if (SECRET_PARAM.test(name)) params.set(name, '***')
  return `${path}?${params.toString()}`
}

export function slowRequestLog({ thresholdMs = 500, log = (line) => console.warn(line) } = {}) {
  return (req, res, next) => {
    if (!thresholdMs) return next()
    const started = process.hrtime.bigint()
    let bytes = 0
    const write = res.write
    const end = res.end
    // Count body bytes as they leave. compression() wraps write/end after
    // this middleware, and its output passes through these.
    res.write = function (chunk, ...rest) {
      if (chunk) bytes += Buffer.byteLength(chunk)
      return write.call(this, chunk, ...rest)
    }
    res.end = function (chunk, ...rest) {
      if (chunk && typeof chunk !== 'function') bytes += Buffer.byteLength(chunk)
      return end.call(this, chunk, ...rest)
    }
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      if (ms < thresholdMs) return
      const role = req.user?.role ? ` role=${req.user.role}` : ''
      log(`[slow] ${req.method} ${safeUrl(req.originalUrl ?? req.url)} ${res.statusCode} ${Math.round(ms)}ms ${(bytes / 1024).toFixed(1)} KB${role}`)
    })
    next()
  }
}
