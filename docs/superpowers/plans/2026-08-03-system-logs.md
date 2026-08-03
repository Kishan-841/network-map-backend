# System Logs (Audit Trail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-only audit trail that automatically logs every mutating API call and all auth events, viewable in a filterable, searchable, paginated admin table.

**Architecture:** A new `system-logs` backend module (Express 5 + Prisma 6, ESM JS) provides an append-only `SystemLog` table, a fire-and-forget log-writing service, an `audit(module, action, opts)` per-route middleware, and an ADMIN-only read API. The Next.js frontend gets an `admin/system-logs` page reusing the existing DataTable/Modal/Pagination components.

**Tech Stack:** Express 5, Prisma 6 (JS client — do NOT upgrade to Prisma 7), zod 4, vitest + supertest, ua-parser-js (new dep), Next.js app router (JS), axios apiClient, Tailwind/DaisyUI per Design.md.

**Spec:** `docs/superpowers/specs/2026-08-03-system-logs-design.md`

## Global Constraints

- Backend is **plain JavaScript ESM** (`"type": "module"`). No TypeScript anywhere.
- **Prisma stays on v6** (v7 emits a TS-only client — incompatible).
- Response envelope is always `{ success: true, data }` / `{ success: false, error: { code, message } }`.
- Module pattern: `src/modules/<name>/<name>.{routes,controller,service,schemas,repository}.js`; services are DI factories (`createXService({ deps })`).
- `validateQuery` puts parsed params on `req.validatedQuery` (Express 5 — never write to `req.query`).
- Log writing must be **fire-and-forget**: it never throws and never delays a response.
- No update/delete route for `SystemLog` may ever exist (immutability).
- Frontend follows Design.md tokens (emerald/slate/Inter/Lucide); icons only via `@/components/ui/icons` re-exports.
- **Never kill the user's dev server.** Verify against it with curl/Playwright; any temp server goes on an alternate port and is killed by PID.
- Backend git repo: `backend/`. Frontend git repo: `frontend/`. Commit to the right repo per task.
- Route tests run against the real dev database (like `tests/zones.route.test.js`); seed admin is `admin@isp.local` / `ChangeMe123!` (overridable via `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` — read from those envs in tests, with these defaults).

---

### Task 1: SystemLog Prisma model + migration + dependency

**Files:**
- Modify: `prisma/schema.prisma` (append model at end)
- Create: `prisma/migrations/<timestamp>_system_logs/` (generated)
- Modify: `package.json` (ua-parser-js dependency)

**Interfaces:**
- Produces: `prisma.systemLog` client delegate with the fields below. All later tasks depend on these exact field names.

- [ ] **Step 1: Append the model to `prisma/schema.prisma`**

```prisma
model SystemLog {
  id           String   @id @default(cuid())
  userId       String?
  userName     String?
  userEmail    String?
  userRole     String?
  module       String
  action       String
  description  String
  oldValue     Json?
  newValue     Json?
  recordId     String?
  buildingId   String?
  ipAddress    String?
  device       String?
  browser      String?
  os           String?
  requestUrl   String
  httpMethod   String
  status       String
  statusCode   Int?
  errorMessage String?
  createdAt    DateTime @default(now())

  @@index([createdAt])
  @@index([userId])
  @@index([module, action])
}
```

No relation to `User` — user fields are denormalized snapshots so logs survive user deletion.

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name system_logs`
Expected: migration created and applied, client regenerated. (Database must be up — `docker compose up -d` if needed; do not restart anything already running.)

- [ ] **Step 3: Install ua-parser-js**

Run: `npm install ua-parser-js`
Expected: added to `dependencies` in package.json.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations package.json package-lock.json
git commit -m "feat: add SystemLog model and ua-parser-js for audit trail"
```

---

### Task 2: Value sanitizer

**Files:**
- Create: `src/modules/system-logs/sanitize.js`
- Test: `tests/system-log.sanitize.test.js`

**Interfaces:**
- Produces: `sanitizeValue(value) -> JSON-safe value | null` — strips keys matching `/password|token|secret/i` recursively; serializes Dates/Decimals via JSON round-trip; returns `null` for `undefined`/`null` input.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { sanitizeValue } from '../src/modules/system-logs/sanitize.js'

describe('sanitizeValue', () => {
  it('strips password/token/secret keys at any depth', () => {
    const input = {
      name: 'Tower A',
      password: 'x',
      passwordHash: 'y',
      nested: { accessToken: 'z', keep: 1 },
      list: [{ refresh_token: 'r', ok: true }],
      apiSecret: 's',
    }
    expect(sanitizeValue(input)).toEqual({
      name: 'Tower A',
      nested: { keep: 1 },
      list: [{ ok: true }],
    })
  })

  it('returns null for null/undefined', () => {
    expect(sanitizeValue(null)).toBeNull()
    expect(sanitizeValue(undefined)).toBeNull()
  })

  it('makes Dates and other rich values JSON-safe', () => {
    const out = sanitizeValue({ createdAt: new Date('2026-08-03T00:00:00.000Z') })
    expect(out).toEqual({ createdAt: '2026-08-03T00:00:00.000Z' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/system-log.sanitize.test.js`
Expected: FAIL — cannot find module `sanitize.js`.

- [ ] **Step 3: Implement**

```js
const SENSITIVE_KEY = /password|token|secret/i

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/system-log.sanitize.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/system-logs/sanitize.js tests/system-log.sanitize.test.js
git commit -m "feat: add audit value sanitizer"
```

---

### Task 3: Request info parser (IP / device / browser / OS)

**Files:**
- Create: `src/modules/system-logs/request-info.js`
- Test: `tests/system-log.request-info.test.js`

**Interfaces:**
- Produces: `parseRequestInfo(req) -> { ipAddress, device, browser, os }` where `device` is `'Desktop' | 'Mobile' | 'Tablet'`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { parseRequestInfo } from '../src/modules/system-logs/request-info.js'

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const fakeReq = (ua, ip = '203.0.113.7') => ({ headers: { 'user-agent': ua }, ip })

describe('parseRequestInfo', () => {
  it('parses a desktop Chrome/Windows UA', () => {
    expect(parseRequestInfo(fakeReq(CHROME_WIN))).toEqual({
      ipAddress: '203.0.113.7',
      device: 'Desktop',
      browser: 'Chrome',
      os: 'Windows',
    })
  })

  it('parses an iPhone Safari UA as Mobile/iOS', () => {
    const info = parseRequestInfo(fakeReq(IPHONE_SAFARI))
    expect(info.device).toBe('Mobile')
    expect(info.os).toBe('iOS')
  })

  it('defaults sanely with no user-agent', () => {
    expect(parseRequestInfo({ headers: {}, ip: undefined })).toEqual({
      ipAddress: null,
      device: 'Desktop',
      browser: null,
      os: null,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/system-log.request-info.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
import { UAParser } from 'ua-parser-js'

const DEVICE_LABEL = { mobile: 'Mobile', tablet: 'Tablet' }

export function parseRequestInfo(req) {
  const parsed = new UAParser(req.headers['user-agent'] ?? '').getResult()
  return {
    ipAddress: req.ip ?? null,
    device: DEVICE_LABEL[parsed.device.type] ?? 'Desktop',
    browser: parsed.browser.name ?? null,
    os: parsed.os.name ?? null,
  }
}
```

(If `UAParser` named export fails under this ua-parser-js version, use `import UAParser from 'ua-parser-js'` — check the installed major version's README.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/system-log.request-info.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/system-logs/request-info.js tests/system-log.request-info.test.js
git commit -m "feat: parse ip/device/browser/os from requests for audit logs"
```

---

### Task 4: Repository + service (recordLog, listLogs)

**Files:**
- Create: `src/modules/system-logs/system-log.repository.js`
- Create: `src/modules/system-logs/system-log.service.js`
- Test: `tests/system-log.service.test.js`

**Interfaces:**
- Consumes: `sanitizeValue` (Task 2); `userRepository.findById(id)` (existing).
- Produces:
  - `systemLogRepository = { create(data), findMany({ where, skip, take }), count(where) }`
  - `createSystemLogService({ systemLogRepository, userRepository })` returning:
    - `recordLog(entry) -> Promise<void>` — never rejects; fills `userName/userEmail/userRole` from `userId` when absent; sanitizes `oldValue`/`newValue`.
    - `listLogs(query) -> Promise<{ items, total, page, pageSize, totalPages }>`
  - `systemLogService` — default instance wired to real repositories (used by middleware and auth controller).

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import { createSystemLogService } from '../src/modules/system-logs/system-log.service.js'

function fakeRepos({ user = null, failCreate = false } = {}) {
  const created = []
  const calls = []
  return {
    created,
    calls,
    systemLogRepository: {
      create: async (data) => {
        if (failCreate) throw new Error('db down')
        created.push(data)
        return data
      },
      findMany: async (args) => {
        calls.push(['findMany', args])
        return []
      },
      count: async (where) => {
        calls.push(['count', where])
        return 0
      },
    },
    userRepository: { findById: async () => user },
  }
}

const baseEntry = {
  module: 'Building',
  action: 'Update',
  description: 'Building updated',
  requestUrl: '/api/v1/buildings/b1',
  httpMethod: 'PATCH',
  status: 'SUCCESS',
  statusCode: 200,
}

describe('recordLog', () => {
  it('fills user snapshot from userId and sanitizes values', async () => {
    const deps = fakeRepos({
      user: { id: 'u1', name: 'Amit', email: 'amit@isp.local', role: 'ADMIN' },
    })
    const service = createSystemLogService(deps)
    await service.recordLog({
      ...baseEntry,
      userId: 'u1',
      newValue: { name: 'Tower A', password: 'nope' },
    })
    expect(deps.created).toHaveLength(1)
    const row = deps.created[0]
    expect(row.userName).toBe('Amit')
    expect(row.userEmail).toBe('amit@isp.local')
    expect(row.userRole).toBe('ADMIN')
    expect(row.newValue).toEqual({ name: 'Tower A' })
  })

  it('never rejects even when the write fails', async () => {
    const service = createSystemLogService(fakeRepos({ failCreate: true }))
    await expect(service.recordLog({ ...baseEntry, userId: null })).resolves.toBeUndefined()
  })
})

describe('listLogs', () => {
  it('builds AND filters plus OR search and paginates', async () => {
    const deps = fakeRepos()
    const service = createSystemLogService(deps)
    const result = await service.listLogs({
      page: 2,
      pageSize: 50,
      module: 'Building',
      status: 'FAILED',
      search: 'tower',
    })
    const [, findArgs] = deps.calls.find(([name]) => name === 'findMany')
    expect(findArgs.skip).toBe(50)
    expect(findArgs.take).toBe(50)
    expect(findArgs.where.AND).toContainEqual({ module: 'Building' })
    expect(findArgs.where.AND).toContainEqual({ status: 'FAILED' })
    const orClause = findArgs.where.AND.find((c) => c.OR)
    expect(orClause.OR).toContainEqual({
      description: { contains: 'tower', mode: 'insensitive' },
    })
    expect(result).toEqual({ items: [], total: 0, page: 2, pageSize: 50, totalPages: 0 })
  })

  it('uses an empty where when no filters are set', async () => {
    const deps = fakeRepos()
    const service = createSystemLogService(deps)
    await service.listLogs({ page: 1, pageSize: 50 })
    const [, findArgs] = deps.calls.find(([name]) => name === 'findMany')
    expect(findArgs.where).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/system-log.service.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement repository**

```js
import { prisma } from '../../lib/prisma.js'

export const systemLogRepository = {
  create: (data) => prisma.systemLog.create({ data }),
  findMany: ({ where, skip, take }) =>
    prisma.systemLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
  count: (where) => prisma.systemLog.count({ where }),
}
```

- [ ] **Step 4: Implement service**

```js
import { sanitizeValue } from './sanitize.js'
import { systemLogRepository } from './system-log.repository.js'
import { userRepository } from '../users/user.repository.js'

const SEARCH_FIELDS = ['userName', 'userEmail', 'description', 'recordId', 'ipAddress']

export function createSystemLogService(deps) {
  const { systemLogRepository, userRepository } = deps

  return {
    // Fire-and-forget: audit logging must never break or slow the real request.
    async recordLog(entry) {
      try {
        let { userName = null, userEmail = null, userRole = null } = entry
        if (entry.userId && !userName) {
          const user = await userRepository.findById(entry.userId).catch(() => null)
          if (user) ({ name: userName, email: userEmail, role: userRole } = user)
        }
        await systemLogRepository.create({
          userId: entry.userId ?? null,
          userName,
          userEmail,
          userRole,
          module: entry.module,
          action: entry.action,
          description: entry.description,
          oldValue: sanitizeValue(entry.oldValue) ?? undefined,
          newValue: sanitizeValue(entry.newValue) ?? undefined,
          recordId: entry.recordId ?? null,
          buildingId: entry.buildingId ?? null,
          ipAddress: entry.ipAddress ?? null,
          device: entry.device ?? null,
          browser: entry.browser ?? null,
          os: entry.os ?? null,
          requestUrl: entry.requestUrl,
          httpMethod: entry.httpMethod,
          status: entry.status,
          statusCode: entry.statusCode ?? null,
          errorMessage: entry.errorMessage ?? null,
        })
      } catch (err) {
        console.error('system-log write failed:', err)
      }
    },

    async listLogs(query) {
      const { page, pageSize, dateFrom, dateTo, userId, role, module, action, status, ipAddress, search } = query
      const and = []
      if (dateFrom) and.push({ createdAt: { gte: dateFrom } })
      if (dateTo) and.push({ createdAt: { lte: dateTo } })
      if (userId) and.push({ userId })
      if (role) and.push({ userRole: role })
      if (module) and.push({ module })
      if (action) and.push({ action })
      if (status) and.push({ status })
      if (ipAddress) and.push({ ipAddress })
      if (search) {
        and.push({
          OR: SEARCH_FIELDS.map((field) => ({
            [field]: { contains: search, mode: 'insensitive' },
          })),
        })
      }
      const where = and.length ? { AND: and } : {}
      const [items, total] = await Promise.all([
        systemLogRepository.findMany({ where, skip: (page - 1) * pageSize, take: pageSize }),
        systemLogRepository.count(where),
      ])
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
    },
  }
}

export const systemLogService = createSystemLogService({ systemLogRepository, userRepository })
```

Note the shadowing: the factory destructures its `deps`, while the default instance at the bottom uses the imported real repositories. `sanitizeValue(...) ?? undefined` matters — Prisma `Json?` fields must be omitted (undefined), not set to JS `null`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/system-log.service.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/system-logs/system-log.repository.js src/modules/system-logs/system-log.service.js tests/system-log.service.test.js
git commit -m "feat: system log repository and service with sanitized fire-and-forget writes"
```

---

### Task 5: Audit middleware

**Files:**
- Create: `src/modules/system-logs/audit.js`
- Test: `tests/system-log.audit.test.js`

**Interfaces:**
- Consumes: `parseRequestInfo` (Task 3), `systemLogService.recordLog` (Task 4).
- Produces:
  - `createAudit(recordLog) -> audit` (test seam)
  - `audit(module, action, opts?)` Express middleware. `opts`:
    - `load(req) -> Promise<record|null>` — pre-change snapshot, becomes `oldValue`
    - `describe(req, oldValue, resBody) -> string` — human description override
    - `recordId(req, resBody) -> string|null` — override; default `req.params.id ?? resBody?.data?.id`
    - `buildingId(req, resBody) -> string|null` — override; default: `recordId` when module is `'Building'`, else `req.body?.buildingId ?? null`

- [ ] **Step 1: Write the failing tests**

```js
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
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/system-log.audit.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
import { parseRequestInfo } from './request-info.js'
import { systemLogService } from './system-log.service.js'

export function createAudit(recordLog) {
  return function audit(module, action, opts = {}) {
    return async (req, res, next) => {
      let oldValue = null
      if (opts.load) {
        try {
          oldValue = (await opts.load(req)) ?? null
        } catch {
          oldValue = null
        }
      }

      // Stash the JSON body so the finish handler can read ids and error messages.
      const originalJson = res.json.bind(res)
      res.json = (body) => {
        res.locals.auditBody = body
        return originalJson(body)
      }

      res.on('finish', () => {
        const body = res.locals.auditBody
        const failed = res.statusCode >= 400
        const recordId = opts.recordId?.(req, body) ?? req.params.id ?? body?.data?.id ?? null
        const buildingId =
          opts.buildingId?.(req, body) ??
          (module === 'Building' ? recordId : req.body?.buildingId ?? null)
        recordLog({
          userId: req.user?.id ?? null,
          module,
          action,
          description: opts.describe?.(req, oldValue, body) ?? `${module} ${action.toLowerCase()}`,
          oldValue,
          newValue: req.body && Object.keys(req.body).length ? req.body : null,
          recordId,
          buildingId,
          ...parseRequestInfo(req),
          requestUrl: req.originalUrl,
          httpMethod: req.method,
          status: failed ? 'FAILED' : 'SUCCESS',
          statusCode: res.statusCode,
          errorMessage: failed ? body?.error?.message ?? null : null,
        })
      })

      next()
    }
  }
}

export const audit = createAudit((entry) => systemLogService.recordLog(entry))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/system-log.audit.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/system-logs/audit.js tests/system-log.audit.test.js
git commit -m "feat: audit middleware capturing mutating requests fire-and-forget"
```

---

### Task 6: Read API — schemas, controller, routes, app wiring

**Files:**
- Create: `src/modules/system-logs/system-log.schemas.js`
- Create: `src/modules/system-logs/system-log.controller.js`
- Create: `src/modules/system-logs/system-log.routes.js`
- Modify: `src/app.js` (import + mount)
- Test: `tests/system-logs.route.test.js`

**Interfaces:**
- Consumes: `systemLogService.listLogs` (Task 4), `requireAuth`/`requireRole`, `validateQuery`.
- Produces: `GET /api/v1/system-logs` (ADMIN only) returning `{ success: true, data: { items, total, page, pageSize, totalPages } }`.

- [ ] **Step 1: Write the failing route test**

```js
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('GET /api/v1/system-logs', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).get('/api/v1/system-logs')
    expect(res.status).toBe(401)
  })

  it('rejects MANAGER and SURVEYOR', async () => {
    for (const role of ['MANAGER', 'SURVEYOR']) {
      const res = await request(createApp())
        .get('/api/v1/system-logs')
        .set('Authorization', `Bearer ${tokenFor(role)}`)
      expect(res.status).toBe(403)
    }
  })

  it('returns paginated logs for ADMIN', async () => {
    const res = await request(createApp())
      .get('/api/v1/system-logs?page=1&pageSize=10')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 10 })
    expect(Array.isArray(res.body.data.items)).toBe(true)
    expect(typeof res.body.data.total).toBe('number')
  })

  it('rejects an invalid status filter', async () => {
    const res = await request(createApp())
      .get('/api/v1/system-logs?status=WHATEVER')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/system-logs.route.test.js`
Expected: FAIL — 404s (route not mounted).

- [ ] **Step 3: Implement schemas**

```js
import { z } from 'zod'

export const listLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  userId: z.string().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'SURVEYOR']).optional(),
  module: z.string().optional(),
  action: z.string().optional(),
  status: z.enum(['SUCCESS', 'FAILED']).optional(),
  ipAddress: z.string().optional(),
  search: z.string().optional(),
})
```

- [ ] **Step 4: Implement controller and routes**

`system-log.controller.js`:

```js
import { systemLogService } from './system-log.service.js'

export const systemLogController = {
  async list(req, res, next) {
    try {
      const data = await systemLogService.listLogs(req.validatedQuery)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },
}
```

`system-log.routes.js`:

```js
import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateQuery } from '../../middleware/validate.js'
import { listLogsQuerySchema } from './system-log.schemas.js'
import { systemLogController } from './system-log.controller.js'

// Read-only by design: audit logs are immutable, so no other verbs exist here.
export const systemLogRoutes = Router()

systemLogRoutes.use(requireAuth, requireRole('ADMIN'))
systemLogRoutes.get('/', validateQuery(listLogsQuerySchema), systemLogController.list)
```

- [ ] **Step 5: Mount in `src/app.js`**

Add with the other route imports:

```js
import { systemLogRoutes } from './modules/system-logs/system-log.routes.js'
```

Add after the `statsRoutes` mount:

```js
app.use('/api/v1/system-logs', systemLogRoutes)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/system-logs.route.test.js`
Expected: PASS (4 tests). Requires the dev database to be up.

- [ ] **Step 7: Commit**

```bash
git add src/modules/system-logs/system-log.schemas.js src/modules/system-logs/system-log.controller.js src/modules/system-logs/system-log.routes.js src/app.js tests/system-logs.route.test.js
git commit -m "feat: admin-only system logs read API with filters and pagination"
```

---

### Task 7: Annotate all mutating routes with audit()

**Files:**
- Modify: `src/modules/buildings/building.routes.js`
- Modify: `src/modules/zones/zone.routes.js`
- Modify: `src/modules/building-types/building-type.routes.js`
- Modify: `src/modules/users/user.routes.js`
- Modify: `src/modules/uploads/upload.routes.js`
- Test: extend `tests/system-logs.route.test.js`

**Interfaces:**
- Consumes: `audit` (Task 5); existing `buildingRepository.findById`, `zoneRepository.findById`, `buildingTypeRepository.findById`, `userRepository.findById` (all exist — verified).

Placement rule: `audit(...)` goes **after** any `requireRole` guard but **before** `validateBody`, so validation failures are logged too, while unauthorized probes (which never pass the role guard) are not attributed as module actions.

- [ ] **Step 1: buildings — add imports and annotate 4 routes**

Add imports to `building.routes.js`:

```js
import { audit } from '../system-logs/audit.js'
import { buildingRepository } from './building.repository.js'
```

Replace the four mutating registrations:

```js
buildingRoutes.post(
  '/',
  audit('Building', 'Create', {
    describe: (req) => `Building '${req.body?.buildingName ?? 'unknown'}' added`,
  }),
  validateBody(createBuildingSchema),
  buildingController.create,
)
```

```js
buildingRoutes.patch(
  '/:id/status',
  requireRole('ADMIN', 'MANAGER'),
  audit('Building', 'StatusChange', {
    load: (req) => buildingRepository.findById(req.params.id),
    describe: (req, old) =>
      `Building '${old?.buildingName ?? req.params.id}' status changed`,
  }),
  validateBody(updateStatusSchema),
  buildingController.updateStatus,
)
```

```js
buildingRoutes.post(
  '/:id/photos',
  audit('Building', 'PhotoAdd', {
    describe: (req) => `Photo added to building ${req.params.id}`,
  }),
  validateBody(addPhotoSchema),
  buildingController.addPhoto,
)
```

```js
buildingRoutes.delete(
  '/:id/photos/:photoId',
  requireRole('ADMIN', 'MANAGER'),
  audit('Building', 'PhotoDelete', {
    describe: (req) => `Photo ${req.params.photoId} deleted from building ${req.params.id}`,
    recordId: (req) => req.params.photoId,
    buildingId: (req) => req.params.id,
  }),
  buildingController.removePhoto,
)
```

- [ ] **Step 2: zones — add imports and annotate 3 routes**

Add imports to `zone.routes.js`:

```js
import { audit } from '../system-logs/audit.js'
import { zoneRepository } from './zone.repository.js'
```

```js
zoneRoutes.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  audit('Zone', 'Create', { describe: (req) => `Zone '${req.body?.name ?? 'unknown'}' created` }),
  validateBody(createZoneSchema),
  zoneController.create,
)

zoneRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('Zone', 'Update', {
    load: (req) => zoneRepository.findById(req.params.id),
    describe: (req, old) => `Zone '${old?.name ?? req.params.id}' updated`,
  }),
  validateBody(updateZoneSchema),
  zoneController.update,
)

zoneRoutes.delete(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('Zone', 'Delete', {
    load: (req) => zoneRepository.findById(req.params.id),
    describe: (req, old) => `Zone '${old?.name ?? req.params.id}' deleted`,
  }),
  zoneController.remove,
)
```

- [ ] **Step 3: building-types — add imports and annotate 3 routes**

Add imports to `building-type.routes.js`:

```js
import { audit } from '../system-logs/audit.js'
import { buildingTypeRepository } from './building-type.repository.js'
```

```js
buildingTypeRoutes.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  audit('BuildingType', 'Create', {
    describe: (req) => `Building type '${req.body?.name ?? 'unknown'}' created`,
  }),
  validateBody(buildingTypeSchema),
  buildingTypeController.create,
)

buildingTypeRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('BuildingType', 'Update', {
    load: (req) => buildingTypeRepository.findById(req.params.id),
    describe: (req, old) =>
      `Building type '${old?.name ?? req.params.id}' renamed to '${req.body?.name ?? '?'}'`,
  }),
  validateBody(buildingTypeSchema),
  buildingTypeController.rename,
)

buildingTypeRoutes.delete(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('BuildingType', 'Delete', {
    load: (req) => buildingTypeRepository.findById(req.params.id),
    describe: (req, old) => `Building type '${old?.name ?? req.params.id}' deleted`,
  }),
  buildingTypeController.remove,
)
```

- [ ] **Step 4: users — add imports and annotate 2 routes**

Add imports to `user.routes.js`:

```js
import { audit } from '../system-logs/audit.js'
import { userRepository } from './user.repository.js'
```

```js
userRoutes.post(
  '/',
  requireRole('ADMIN'),
  audit('User', 'Create', {
    describe: (req) => `User '${req.body?.email ?? 'unknown'}' created`,
  }),
  validateBody(createUserSchema),
  userController.create,
)

userRoutes.patch(
  '/:id',
  requireRole('ADMIN'),
  audit('User', 'Update', {
    load: (req) => userRepository.findById(req.params.id),
    describe: (req, old) => `User '${old?.email ?? req.params.id}' updated`,
  }),
  validateBody(updateUserSchema),
  userController.update,
)
```

(The sanitizer strips `password`/`passwordHash` from both old and new values automatically.)

- [ ] **Step 5: uploads — annotate the upload route**

Add import to `upload.routes.js`:

```js
import { audit } from '../system-logs/audit.js'
```

```js
uploadRoutes.post(
  '/',
  requireAuth,
  upload.single('file'),
  audit('Upload', 'FileUpload', {
    describe: (req) => `File '${req.file?.originalname ?? 'unknown'}' uploaded`,
  }),
  uploadController.upload,
)
```

(Here `audit` sits after multer so `req.file` is populated; `describe` runs at response-finish time.)

- [ ] **Step 6: Add an end-to-end capture test**

Append to `tests/system-logs.route.test.js`:

```js
import { vi } from 'vitest'
import { prisma } from '../src/lib/prisma.js'

describe('audit capture on real routes', () => {
  it('logs a failed building-type create (validation error)', async () => {
    const before = await prisma.systemLog.count({ where: { module: 'BuildingType' } })
    await request(createApp())
      .post('/api/v1/building-types')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({}) // fails validation -> 400, still logged
    await vi.waitFor(async () => {
      expect(await prisma.systemLog.count({ where: { module: 'BuildingType' } })).toBe(before + 1)
    })
    const latest = await prisma.systemLog.findFirst({
      where: { module: 'BuildingType' },
      orderBy: { createdAt: 'desc' },
    })
    expect(latest.status).toBe('FAILED')
    expect(latest.httpMethod).toBe('POST')
  })
})
```

(Merge the `vi` import into the existing vitest import line.)

- [ ] **Step 7: Run the full backend suite**

Run: `npm test`
Expected: all suites PASS, including pre-existing ones (route order changes must not break behavior).

- [ ] **Step 8: Commit**

```bash
git add src/modules/buildings/building.routes.js src/modules/zones/zone.routes.js src/modules/building-types/building-type.routes.js src/modules/users/user.routes.js src/modules/uploads/upload.routes.js tests/system-logs.route.test.js
git commit -m "feat: audit all mutating routes"
```

---

### Task 8: Auth events — login, failed login, logout

**Files:**
- Modify: `src/modules/auth/auth.controller.js`
- Modify: `src/modules/auth/auth.routes.js`
- Test: `tests/auth-audit.route.test.js`

**Interfaces:**
- Consumes: `systemLogService.recordLog`, `parseRequestInfo`.
- Produces: `POST /api/v1/auth/logout` (auth required) → `{ success: true, data: { loggedOut: true } }`; log entries with module `'Auth'` and actions `'Login' | 'FailedLogin' | 'Logout'`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@isp.local'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!'

const countAuth = (action) => prisma.systemLog.count({ where: { module: 'Auth', action } })

describe('auth audit events', () => {
  it('logs a successful login with the user snapshot', async () => {
    const before = await countAuth('Login')
    const res = await request(createApp())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    expect(res.status).toBe(200)
    await vi.waitFor(async () => expect(await countAuth('Login')).toBe(before + 1))
    const entry = await prisma.systemLog.findFirst({
      where: { module: 'Auth', action: 'Login' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry.userEmail).toBe(ADMIN_EMAIL)
    expect(entry.status).toBe('SUCCESS')
  })

  it('logs a failed login without a userId', async () => {
    const before = await countAuth('FailedLogin')
    const res = await request(createApp())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@isp.local', password: 'wrong' })
    expect(res.status).toBe(401)
    await vi.waitFor(async () => expect(await countAuth('FailedLogin')).toBe(before + 1))
    const entry = await prisma.systemLog.findFirst({
      where: { module: 'Auth', action: 'FailedLogin' },
      orderBy: { createdAt: 'desc' },
    })
    expect(entry.userId).toBeNull()
    expect(entry.status).toBe('FAILED')
    expect(entry.description).toContain('nobody@isp.local')
  })

  it('logs logout', async () => {
    const token = jwt.sign({ sub: 'test-user', role: 'ADMIN' }, env.jwtSecret, { expiresIn: '1h' })
    const before = await countAuth('Logout')
    const res = await request(createApp())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    await vi.waitFor(async () => expect(await countAuth('Logout')).toBe(before + 1))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/auth-audit.route.test.js`
Expected: FAIL — no log rows written, logout 404.

- [ ] **Step 3: Implement in `auth.controller.js`**

Add imports:

```js
import { systemLogService } from '../system-logs/system-log.service.js'
import { parseRequestInfo } from '../system-logs/request-info.js'
```

Replace `login` and add `logout`:

```js
  async login(req, res, next) {
    const base = {
      module: 'Auth',
      requestUrl: req.originalUrl,
      httpMethod: req.method,
      ...parseRequestInfo(req),
    }
    try {
      const result = await authService.login(req.body)
      systemLogService.recordLog({
        ...base,
        userId: result.user.id,
        userName: result.user.name,
        userEmail: result.user.email,
        userRole: result.user.role,
        action: 'Login',
        description: `${result.user.name} logged in`,
        status: 'SUCCESS',
        statusCode: 200,
      })
      res.json({ success: true, data: result })
    } catch (err) {
      systemLogService.recordLog({
        ...base,
        userId: null,
        action: 'FailedLogin',
        description: `Failed login attempt for '${req.body?.email ?? 'unknown'}'`,
        newValue: { email: req.body?.email ?? null },
        status: 'FAILED',
        statusCode: err.status ?? 500,
        errorMessage: err.message,
      })
      next(err)
    }
  },

  async logout(req, res) {
    systemLogService.recordLog({
      module: 'Auth',
      requestUrl: req.originalUrl,
      httpMethod: req.method,
      ...parseRequestInfo(req),
      userId: req.user.id,
      action: 'Logout',
      description: 'User logged out',
      status: 'SUCCESS',
      statusCode: 200,
    })
    res.json({ success: true, data: { loggedOut: true } })
  },
```

(`recordLog` is deliberately not awaited — fire-and-forget.)

- [ ] **Step 4: Add the route in `auth.routes.js`**

```js
authRoutes.post('/logout', requireAuth, authController.logout)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/auth-audit.route.test.js`
Expected: PASS (3 tests). Requires seeded dev DB.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/auth.controller.js src/modules/auth/auth.routes.js tests/auth-audit.route.test.js
git commit -m "feat: audit login, failed login, and logout events"
```

---

### Task 9: Frontend — logout wiring, nav entry, icon, constants

**Files (frontend repo):**
- Modify: `src/components/ui/icons.js`
- Modify: `src/lib/constants.js`
- Modify: `src/components/layout/Sidebar.js:59-62` (handleLogout)
- Modify: `src/app/(app)/profile/page.js:24-26` (handleLogout)
- Modify: `src/app/(app)/dashboard/page.js:45-47` (Manage nav items)

**Interfaces:**
- Produces: `IconLogs` icon; `SYSTEM_LOG_MODULES`, `SYSTEM_LOG_ACTIONS` constants (Task 10 imports these); logout that records the audit event server-side before clearing the token.

- [ ] **Step 1: Add the icon re-export in `icons.js`**

Inside the existing `export { ... }` block add:

```js
  ScrollText as IconLogs,
```

- [ ] **Step 2: Add filter constants to `src/lib/constants.js`**

```js
// System log filter options — must match backend module/action names
// (see backend src/modules/system-logs + route annotations).
export const SYSTEM_LOG_MODULES = ['Auth', 'User', 'Zone', 'Building', 'BuildingType', 'Upload']
export const SYSTEM_LOG_ACTIONS = [
  'Login',
  'FailedLogin',
  'Logout',
  'Create',
  'Update',
  'Delete',
  'StatusChange',
  'PhotoAdd',
  'PhotoDelete',
  'FileUpload',
]
```

- [ ] **Step 3: Record logout in both logout handlers**

In `Sidebar.js` (add `apiClient` import: `import { apiClient } from '@/lib/api-client'`):

```js
  function handleLogout() {
    apiClient.post('/auth/logout').catch(() => {}) // audit only — never block logout
    clearAuth()
    router.replace('/login')
  }
```

Apply the same one-line addition to `handleLogout` in `src/app/(app)/profile/page.js` (it already imports from `@/lib/api-client` — check; add the import if missing).

- [ ] **Step 4: Add the Manage nav entry in `dashboard/page.js`**

Add `IconLogs` to the icons import, then extend the Manage items array (after the Users entry):

```js
  { href: '/admin/system-logs', label: 'System logs', sub: 'Audit trail', icon: IconLogs, adminOnly: true },
```

- [ ] **Step 5: Verify no lint errors and manual smoke**

Run: `npm run lint`
Expected: clean. Then with the dev servers already running (do not restart them), log in as admin in the browser, confirm the "System logs" card shows on the dashboard for ADMIN (404 on click is expected until Task 10), then log out and confirm `POST /auth/logout` fired (network tab or backend log).

- [ ] **Step 6: Commit (frontend repo)**

```bash
git add src/components/ui/icons.js src/lib/constants.js src/components/layout/Sidebar.js "src/app/(app)/profile/page.js" "src/app/(app)/dashboard/page.js"
git commit -m "feat: logout audit call, system-logs nav entry, log filter constants"
```

---

### Task 10: Frontend — System Logs page

**Files (frontend repo):**
- Create: `src/app/(app)/admin/system-logs/page.js`

**Interfaces:**
- Consumes: `GET /system-logs` via `apiClient` (params: page, pageSize, dateFrom, dateTo, userId, module, action, status, search); `GET /users` for the user filter dropdown; `DataTable`, `PageHeader`, `Input`/`Select`, `Modal`, `SYSTEM_LOG_MODULES`, `SYSTEM_LOG_ACTIONS`.

Notes that shape the implementation:
- The admin layout admits MANAGER too, so this page adds its own ADMIN-only gate.
- `DataTable` needs `renderCard` for mobile and takes `pagination`/`onPageChange` (`pagination = { page, totalPages, total }` — the API returns exactly these) plus `pageSize`/`onPageSizeChange`.
- Row click opens a `Modal` with full details (old/new values, device/browser/OS, URL, method, error) — this is the spec's "detail pane".
- Dates: `dateFrom` sends `new Date(value).toISOString()`; `dateTo` sends `new Date(value + 'T23:59:59.999').toISOString()` so the range is inclusive in local time.
- Search is debounced 400ms; every filter change resets `page` to 1.

- [ ] **Step 1: Implement the page**

```js
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient, getApiErrorMessage } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/ui/PageHeader'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { DataTable } from '@/components/ui/DataTable'
import { SYSTEM_LOG_MODULES, SYSTEM_LOG_ACTIONS } from '@/lib/constants'
import { IconLogs } from '@/components/ui/icons'

const EMPTY_FILTERS = { dateFrom: '', dateTo: '', userId: '', module: '', action: '', status: '' }

const ROLE_CHIP = {
  ADMIN: 'bg-doc-tint text-doc',
  MANAGER: 'bg-fiber-tint text-fiber',
  SURVEYOR: 'bg-scan-tint text-scan',
}

function StatusChip({ status }) {
  return status === 'SUCCESS' ? (
    <span className="inline-flex rounded-full bg-ok-tint px-2.5 py-0.5 text-xs font-medium text-ok">
      Success
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-danger-tint px-2.5 py-0.5 text-xs font-medium text-danger">
      Failed
    </span>
  )
}

function JsonBlock({ label, value }) {
  if (value === null || value === undefined) return null
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <pre className="max-h-56 overflow-auto rounded-btn border border-line bg-base-200/60 p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function DetailRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-4 border-b border-line/50 py-2 text-sm last:border-b-0">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  )
}

function LogDetailModal({ log, onClose }) {
  return (
    <Modal open={Boolean(log)} onClose={onClose} title="Log details">
      {log && (
        <div className="flex flex-col gap-4">
          <div>
            <DetailRow label="Timestamp" value={new Date(log.createdAt).toLocaleString()} />
            <DetailRow label="User" value={log.userName ?? '—'} />
            <DetailRow label="Email" value={log.userEmail} />
            <DetailRow label="Role" value={log.userRole} />
            <DetailRow label="Module / Action" value={`${log.module} · ${log.action}`} />
            <DetailRow label="Description" value={log.description} />
            <DetailRow label="Record ID" value={log.recordId} />
            <DetailRow label="Building ID" value={log.buildingId} />
            <DetailRow label="IP address" value={log.ipAddress} />
            <DetailRow
              label="Client"
              value={[log.device, log.browser, log.os].filter(Boolean).join(' · ')}
            />
            <DetailRow label="Request" value={`${log.httpMethod} ${log.requestUrl}`} />
            <DetailRow label="Status code" value={log.statusCode} />
            <DetailRow label="Error" value={log.errorMessage} />
          </div>
          {(log.oldValue || log.newValue) && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <JsonBlock label="Old value" value={log.oldValue} />
              <JsonBlock label="New value" value={log.newValue} />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

export default function SystemLogsPage() {
  const router = useRouter()
  const role = useAuthStore((s) => s.user?.role)

  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState(null)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)

  // The admin layout admits MANAGER too; logs are strictly ADMIN.
  useEffect(() => {
    if (role && role !== 'ADMIN') router.replace('/dashboard')
  }, [role, router])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    apiClient
      .get('/users')
      .then((res) => setUsers(res.data.data))
      .catch(() => setUsers([]))
  }, [])

  const params = useMemo(() => {
    const p = { page, pageSize }
    if (filters.dateFrom) p.dateFrom = new Date(filters.dateFrom).toISOString()
    if (filters.dateTo) p.dateTo = new Date(`${filters.dateTo}T23:59:59.999`).toISOString()
    for (const key of ['userId', 'module', 'action', 'status']) {
      if (filters[key]) p[key] = filters[key]
    }
    if (debouncedSearch.trim()) p.search = debouncedSearch.trim()
    return p
  }, [filters, debouncedSearch, page, pageSize])

  useEffect(() => {
    if (role !== 'ADMIN') return
    let cancelled = false
    setLoading(true)
    apiClient
      .get('/system-logs', { params })
      .then((res) => {
        if (cancelled) return
        setData(res.data.data)
        setError(null)
      })
      .catch((err) => !cancelled && setError(getApiErrorMessage(err, 'Could not load logs')))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [params, role])

  const setFilter = (key) => (e) => {
    setFilters((prev) => ({ ...prev, [key]: e.target.value }))
    setPage(1)
  }

  if (role !== 'ADMIN') return null

  const columns = [
    {
      key: 'createdAt',
      header: 'Timestamp',
      render: (log) => (
        <span className="whitespace-nowrap tabular-nums">
          {new Date(log.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'userName',
      header: 'User',
      render: (log) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{log.userName ?? '—'}</span>
          {log.userRole && (
            <span
              className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_CHIP[log.userRole] ?? 'bg-line/60 text-muted'}`}
            >
              {log.userRole}
            </span>
          )}
        </div>
      ),
    },
    { key: 'module', header: 'Module' },
    { key: 'action', header: 'Action' },
    { key: 'description', header: 'Description', className: 'max-w-[360px] truncate' },
    { key: 'ipAddress', header: 'IP address', render: (log) => log.ipAddress ?? '—' },
    { key: 'status', header: 'Status', render: (log) => <StatusChip status={log.status} /> },
  ]

  return (
    <>
      <PageHeader
        title="System logs"
        subtitle="Immutable audit trail of every action in the system"
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <Input
          id="log-from"
          label="From"
          type="date"
          value={filters.dateFrom}
          onChange={setFilter('dateFrom')}
        />
        <Input
          id="log-to"
          label="To"
          type="date"
          value={filters.dateTo}
          onChange={setFilter('dateTo')}
        />
        <Select id="log-user" label="User" value={filters.userId} onChange={setFilter('userId')}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select id="log-module" label="Module" value={filters.module} onChange={setFilter('module')}>
          <option value="">All modules</option>
          {SYSTEM_LOG_MODULES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Select id="log-action" label="Action" value={filters.action} onChange={setFilter('action')}>
          <option value="">All actions</option>
          {SYSTEM_LOG_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select id="log-status" label="Status" value={filters.status} onChange={setFilter('status')}>
          <option value="">Any status</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
        </Select>
        <Input
          id="log-search"
          label="Search"
          placeholder="User, email, IP, record…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
      </div>

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      <DataTable
        columns={columns}
        rows={data?.items}
        loading={loading}
        onRowClick={setSelected}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(1)
        }}
        pagination={data && { page: data.page, totalPages: data.totalPages, total: data.total }}
        onPageChange={setPage}
        emptyState={
          <div className="flex flex-col items-center gap-2 rounded-card border border-line bg-card p-10 text-center">
            <IconLogs className="h-8 w-8 text-muted" />
            <p className="font-medium">No log entries match</p>
            <p className="text-sm text-muted">Try widening the date range or clearing filters.</p>
          </div>
        }
        renderCard={(log) => (
          <button
            onClick={() => setSelected(log)}
            className="w-full rounded-card border border-line bg-card p-4 text-left shadow-soft"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {log.module} · {log.action}
              </span>
              <StatusChip status={log.status} />
            </div>
            <p className="mt-1 truncate text-sm text-muted">{log.description}</p>
            <p className="mt-2 text-xs text-muted">
              {log.userName ?? '—'} · {log.ipAddress ?? '—'} ·{' '}
              {new Date(log.createdAt).toLocaleString()}
            </p>
          </button>
        )}
      />

      <LogDetailModal log={selected} onClose={() => setSelected(null)} />
    </>
  )
}
```

Adjust to reality while implementing: check `Input`/`Select`/`PageHeader`/`Modal` prop signatures in `src/components/ui/` and the exact danger/ok tint class names used by sibling pages (e.g. `admin/users/page.js`) — match them exactly rather than inventing new ones. `GET /users` returns 200 for ADMIN (route allows ADMIN and MANAGER).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean (fix any react-hooks warnings — no setState loops in effects; the `params` memo pattern above avoids cascading fetches).

- [ ] **Step 3: Manual verification against the running dev servers**

Do NOT restart the user's dev servers. In the browser (or via Playwright):
1. Log in as admin → dashboard → System logs card → page loads with entries (login events from Task 8 should already appear).
2. Create/edit a zone or building type → new entries appear on refresh.
3. Filter by module, action, status, and date; type in search; confirm the table narrows and page resets to 1.
4. Click a row → detail modal shows old/new values for an update.
5. Check the mobile viewport (390×844) renders cards.
6. As a MANAGER/SURVEYOR user (or by editing the store), confirm redirect away from the page.

- [ ] **Step 4: Commit (frontend repo)**

```bash
git add "src/app/(app)/admin/system-logs/page.js"
git commit -m "feat: admin system logs page with filters, search, pagination, detail modal"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: all tests PASS.

- [ ] **Step 2: Frontend production build**

Run: `cd frontend && npm run build`
Expected: build succeeds with no errors. (Build output is throwaway; the user's dev server keeps running untouched.)

- [ ] **Step 3: Acceptance sweep against the spec**

Verify each item from the design doc, live in the app:
- Login, failed login, and logout events recorded with IP, browser, device, OS.
- Building/zone/building-type/user create/update/delete logged with old/new values; passwords never appear in any log row (spot-check a user update).
- Failed operations (validation error) appear with status Failed and an error message.
- MANAGER/SURVEYOR get 403 from the API and are redirected from the page.
- No API route exists to modify or delete a log (grep: `grep -rn "systemLog" backend/src | grep -iv "create\|findMany\|count"` shows no update/delete).
- Timestamps display in local time; DB stores UTC.

- [ ] **Step 4: Report results honestly** — list anything that failed or was skipped.
