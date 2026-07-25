import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

describe('GET /api/v1/health', () => {
  it('returns the success envelope with status ok', async () => {
    const res = await request(createApp()).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } })
  })
})
