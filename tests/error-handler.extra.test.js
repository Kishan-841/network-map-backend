import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import multer from 'multer'
import { Prisma } from '@prisma/client'
import { errorHandler } from '../src/middleware/error-handler.js'

function appThatThrows(err) {
  const app = express()
  app.get('/boom', (req, res, next) => next(err))
  app.use(errorHandler)
  return app
}

const knownError = (code, meta) => {
  const err = new Prisma.PrismaClientKnownRequestError('msg', { code, clientVersion: 'x', meta })
  return err
}

describe('errorHandler Prisma + multer mapping', () => {
  it('maps P2025 (record not found) to 404', async () => {
    const res = await request(appThatThrows(knownError('P2025'))).get('/boom')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('maps P2003 (FK violation) to 400', async () => {
    const res = await request(appThatThrows(knownError('P2003'))).get('/boom')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BAD_REQUEST')
  })

  it('maps a Prisma validation error to 400', async () => {
    const res = await request(appThatThrows(new Prisma.PrismaClientValidationError('bad', { clientVersion: 'x' }))).get('/boom')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BAD_REQUEST')
  })

  it('maps multer LIMIT_FILE_SIZE to 413', async () => {
    const err = new multer.MulterError('LIMIT_FILE_SIZE')
    const res = await request(appThatThrows(err)).get('/boom')
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('FILE_TOO_LARGE')
  })

  it('maps other multer errors to 400', async () => {
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE')
    const res = await request(appThatThrows(err)).get('/boom')
    expect(res.status).toBe(400)
  })

  it('still maps P2002 to 409 and unknown errors to 500', async () => {
    expect((await request(appThatThrows(knownError('P2002', { target: ['email'] }))).get('/boom')).status).toBe(409)
    expect((await request(appThatThrows(new Error('unexpected'))).get('/boom')).status).toBe(500)
  })
})
