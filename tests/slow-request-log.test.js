import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { slowRequestLog } from '../src/middleware/slow-request-log.js'

// One log line for any API call slower than the threshold, so growth shows up
// in the VM's docker logs before users complain.
function appWith(opts, delayMs) {
  const lines = []
  const app = express()
  app.use(slowRequestLog({ ...opts, log: (line) => lines.push(line) }))
  app.get('/api/v1/thing', (req, res) => {
    req.user = { role: 'ADMIN' }
    setTimeout(() => res.json({ data: 'x'.repeat(2048) }), delayMs)
  })
  return { app, lines }
}

describe('slowRequestLog', () => {
  it('logs a request slower than the threshold with method, path, status, time and size', async () => {
    const { app, lines } = appWith({ thresholdMs: 30 }, 60)
    await request(app).get('/api/v1/thing?page=2')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[slow\] GET \/api\/v1\/thing\?page=2 200 \d+ms /)
    expect(lines[0]).toContain('role=ADMIN')
    expect(lines[0]).toMatch(/\d+(\.\d+)? KB/)
  })

  it('stays quiet for a fast request', async () => {
    const { app, lines } = appWith({ thresholdMs: 200 }, 0)
    await request(app).get('/api/v1/thing')
    expect(lines).toHaveLength(0)
  })

  it('is off when the threshold is 0', async () => {
    const { app, lines } = appWith({ thresholdMs: 0 }, 40)
    await request(app).get('/api/v1/thing')
    expect(lines).toHaveLength(0)
  })

  it('never logs the query of a token-bearing URL', async () => {
    const { app, lines } = appWith({ thresholdMs: 10 }, 30)
    await request(app).get('/api/v1/thing?token=secret123&q=a')
    expect(lines[0]).not.toContain('secret123')
  })
})
