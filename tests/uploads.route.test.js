import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { rm } from 'node:fs/promises'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const token = jwt.sign({ sub: 'test-user', role: 'SURVEYOR' }, env.jwtSecret, { expiresIn: '1h' })

describe('POST /api/v1/uploads', () => {
  afterAll(() => rm('uploads', { recursive: true, force: true }))

  it('requires authentication', async () => {
    const res = await request(createApp()).post('/api/v1/uploads')
    expect(res.status).toBe(401)
  })

  it('rejects a request with no file', async () => {
    const res = await request(createApp())
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  it('rejects disallowed file types', async () => {
    const res = await request(createApp())
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('#!/bin/sh'), { filename: 'x.sh', contentType: 'text/x-sh' })
    expect(res.status).toBe(400)
  })

  it('stores an allowed file and returns its url', async () => {
    const res = await request(createApp())
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake-image-bytes'), {
        filename: 'entrance.jpg',
        contentType: 'image/jpeg',
      })
    expect(res.status).toBe(201)
    expect(res.body.data.url).toMatch(/^http:\/\/localhost:4000\/uploads\/.+\.jpg$/)
  })
})
