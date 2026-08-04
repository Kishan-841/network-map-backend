import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createAudit } from '../src/modules/system-logs/audit.js'

function capture() {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, recordLog: (entry) => resolve(entry) }
}

function makeApp(audit) {
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    req.user = { id: 'u1', role: 'ADMIN' }
    next()
  })
  app.patch(
    '/things/:id',
    audit('Building', 'Update', {
      load: async () => ({ id: 'b1', buildingName: 'Tower A' }),
      describe: (req, old) => `Building '${old.buildingName}' updated`,
    }),
    (req, res) => res.json({ success: true, data: { id: req.params.id } }),
  )
  app.post('/things', audit('Building', 'Create'), (req, res) =>
    res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Bad input' } }),
  )
  return app
}

describe('audit middleware', () => {
  it('records a success entry with old value, user, and request info', async () => {
    const cap = capture()
    const app = makeApp(createAudit(cap.recordLog))
    await request(app).patch('/things/b1').send({ status: 'REJECTED' })
    const entry = await cap.promise
    expect(entry).toMatchObject({
      userId: 'u1',
      module: 'Building',
      action: 'Update',
      description: "Building 'Tower A' updated",
      oldValue: { id: 'b1', buildingName: 'Tower A' },
      newValue: { status: 'REJECTED' },
      recordId: 'b1',
      buildingId: 'b1',
      httpMethod: 'PATCH',
      requestUrl: '/things/b1',
      status: 'SUCCESS',
      statusCode: 200,
    })
    expect(entry.device).toBeDefined()
  })

  it('records failures with the response error message', async () => {
    const cap = capture()
    const app = makeApp(createAudit(cap.recordLog))
    await request(app).post('/things').send({ buildingName: 'X' })
    const entry = await cap.promise
    expect(entry).toMatchObject({
      action: 'Create',
      status: 'FAILED',
      statusCode: 400,
      errorMessage: 'Bad input',
    })
    // A failed request changed nothing — no body is persisted.
    expect(entry.newValue).toBeNull()
    expect(entry.oldValue).toBeNull()
  })
})
