import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { z } from 'zod'
import { ApiError } from '../src/lib/api-error.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { validateBody } from '../src/middleware/validate.js'

function testApp() {
  const app = express()
  app.use(express.json())
  app.get('/boom', () => {
    throw ApiError.notFound('Building not found')
  })
  app.post(
    '/validated',
    validateBody(z.object({ name: z.string().min(1) })),
    (req, res) => res.json({ success: true, data: req.body }),
  )
  app.get('/unknown', () => {
    throw new Error('unexpected')
  })
  app.use(errorHandler)
  return app
}

describe('error handling', () => {
  it('maps ApiError to its status and envelope', async () => {
    const res = await request(testApp()).get('/boom')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Building not found' },
    })
  })

  it('maps Zod validation failures to 400 with field details', async () => {
    const res = await request(testApp()).post('/validated').send({ name: '' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toHaveProperty('name')
  })

  it('passes validated body through on success', async () => {
    const res = await request(testApp()).post('/validated').send({ name: 'ok' })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ name: 'ok' })
  })

  it('maps unknown errors to 500 without leaking internals', async () => {
    const res = await request(testApp()).get('/unknown')
    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
    expect(res.body.error.message).not.toContain('unexpected')
  })
})
