# Phase 1 – Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the monorepo (Express backend + Next.js frontend), Prisma schema with migration and seed, JWT auth with roles, admin user CRUD, and the mobile-first UI shell with login.

**Architecture:** Backend follows routes → controller → service → repository layering with dependency-injected services (factory functions) so business logic is unit-testable without a database. Frontend is Next.js App Router (JavaScript), Zustand for auth state, Axios instance with auth interceptors, Zod validation shared conceptually with the backend.

**Tech Stack:** Node 25, Express 5, Prisma + PostgreSQL 15 (local Homebrew), jsonwebtoken, bcryptjs, Zod, Vitest + Supertest (backend tests), Next.js (App Router, JS), Tailwind CSS, Zustand, React Hook Form, Axios.

## Global Constraints

- JavaScript only — no TypeScript anywhere (PRD mandate).
- Backend is ESM (`"type": "module"`); imports use `.js` extensions.
- All API routes live under `/api/v1`.
- Response envelope, verbatim: success `{ "success": true, "data": ... }`; failure `{ "success": false, "error": { "code", "message", "details?" } }`.
- Roles enum values, verbatim: `ADMIN`, `MANAGER`, `SURVEYOR`.
- No business logic in controllers or React components — services/hooks only.
- Database: `isp_feasibility_dev` on local PostgreSQL 15 (Homebrew, user `gazon`, no password).
- Backend dev port 4000; frontend dev port 3000.
- Mobile-first UI: minimum 44px touch targets, bottom navigation, large buttons.
- Commit after every task (at minimum).

---

### Task 1: Backend scaffold with health endpoint

**Files:**
- Create: `backend/package.json`
- Create: `backend/.env`, `backend/.env.example`
- Create: `backend/src/config/env.js`
- Create: `backend/src/app.js`
- Create: `backend/src/server.js`
- Create: `backend/vitest.config.js`
- Test: `backend/tests/health.test.js`

**Interfaces:**
- Produces: `createApp()` from `src/app.js` — returns a configured Express app (used by every later route/middleware task and all Supertest tests). `env` object from `src/config/env.js` with keys `port`, `databaseUrl`, `jwtSecret`, `jwtExpiresIn`, `nodeEnv`.

- [ ] **Step 1: Initialize the backend package**

```bash
mkdir -p backend/src/config backend/tests
cd backend
npm init -y
npm pkg set type="module" scripts.dev="node --watch src/server.js" scripts.start="node src/server.js" scripts.test="vitest run" scripts.test:watch="vitest"
npm install express@5 cors dotenv zod
npm install -D vitest supertest
```

- [ ] **Step 2: Create env config and dotenv files**

`backend/.env` (and copy to `.env.example` with the secret blanked):

```bash
DATABASE_URL="postgresql://gazon@localhost:5432/isp_feasibility_dev"
JWT_SECRET="dev-only-change-in-production-8f3k2j"
JWT_EXPIRES_IN="7d"
PORT=4000
```

`backend/src/config/env.js`:

```js
import 'dotenv/config'

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  nodeEnv: process.env.NODE_ENV ?? 'development',
}
```

- [ ] **Step 3: Write the failing health-endpoint test**

`backend/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
})
```

`backend/tests/health.test.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/health.test.js`
Expected: FAIL — cannot find module `../src/app.js`

- [ ] **Step 5: Implement app and server**

`backend/src/app.js`:

```js
import express from 'express'
import cors from 'cors'

export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json())

  app.get('/api/v1/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok' } })
  })

  return app
}
```

`backend/src/server.js`:

```js
import { createApp } from './app.js'
import { env } from './config/env.js'

createApp().listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`)
})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/health.test.js`
Expected: PASS (1 test)

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): scaffold Express app with health endpoint"
```

---

### Task 2: Prisma schema, migration, and seed

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/prisma/seed.js`
- Create: `backend/src/lib/prisma.js`
- Modify: `backend/package.json` (prisma seed config)
- Modify: `.gitignore` (backend uploads dir, env files)

**Interfaces:**
- Produces: `prisma` singleton from `src/lib/prisma.js` (used by every repository). Models `User`, `Zone`, `Building`, `BuildingDetails`, `Permission`, `Photo`; enums `Role`, `FeasibleStatus`, `SurveyStatus`, `PhotoType`.

- [ ] **Step 1: Ensure PostgreSQL is running and the database exists**

```bash
brew services start postgresql@15
createdb isp_feasibility_dev 2>/dev/null || echo "db exists"
psql -d isp_feasibility_dev -c "select 1"
```

Expected: `(1 row)` output.

- [ ] **Step 2: Install Prisma and write the schema**

```bash
cd backend
npm install @prisma/client
npm install -D prisma
npm install bcryptjs
```

`backend/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  MANAGER
  SURVEYOR
}

enum FeasibleStatus {
  FEASIBLE
  PERMISSION_PENDING
  REJECTED
  SURVEY_PENDING
}

enum SurveyStatus {
  PENDING
  COMPLETED
}

enum PhotoType {
  ENTRANCE
  PERMISSION_LETTER
  ADDITIONAL
}

model User {
  id           String     @id @default(cuid())
  name         String
  email        String     @unique
  passwordHash String
  role         Role       @default(SURVEYOR)
  isActive     Boolean    @default(true)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  buildings    Building[]
}

model Zone {
  id        String     @id @default(cuid())
  name      String     @unique
  city      String
  createdAt DateTime   @default(now())
  buildings Building[]
}

model Building {
  id               String           @id @default(cuid())
  placeId          String?          @unique
  buildingName     String
  formattedAddress String
  latitude         Float
  longitude        Float
  zoneId           String
  zone             Zone             @relation(fields: [zoneId], references: [id])
  feasibleStatus   FeasibleStatus   @default(SURVEY_PENDING)
  surveyStatus     SurveyStatus     @default(PENDING)
  createdById      String
  createdBy        User             @relation(fields: [createdById], references: [id])
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt
  details          BuildingDetails?
  permission       Permission?
  photos           Photo[]

  @@index([latitude, longitude])
}

model BuildingDetails {
  id           String   @id @default(cuid())
  buildingId   String   @unique
  building     Building @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  wings        Int?
  floors       Int?
  homePass     Int?
  buildingType String?
  remarks      String?
}

model Permission {
  id               String    @id @default(cuid())
  buildingId       String    @unique
  building         Building  @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  amountPaid       Decimal?  @db.Decimal(12, 2)
  permissionStatus String?
  permissionDate   DateTime?
  renewalDate      DateTime?
  ownerName        String?
  ownerMobile      String?
  documentUrl      String?
}

model Photo {
  id         String    @id @default(cuid())
  buildingId String
  building   Building  @relation(fields: [buildingId], references: [id], onDelete: Cascade)
  type       PhotoType
  url        String
  createdAt  DateTime  @default(now())
}
```

- [ ] **Step 3: Run the initial migration**

Run: `cd backend && npx prisma migrate dev --name init`
Expected: "Your database is now in sync with your schema" and generated client.

- [ ] **Step 4: Create the Prisma singleton and seed script**

`backend/src/lib/prisma.js`:

```js
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
```

`backend/prisma/seed.js`:

```js
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma.js'

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@isp.local'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!'

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10)

  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      name: 'System Admin',
      email: ADMIN_EMAIL,
      passwordHash,
      role: 'ADMIN',
    },
  })

  const zones = [
    { name: 'Zone A', city: 'Default City' },
    { name: 'Zone B', city: 'Default City' },
  ]
  for (const zone of zones) {
    await prisma.zone.upsert({
      where: { name: zone.name },
      update: {},
      create: zone,
    })
  }

  console.log(`Seeded admin ${ADMIN_EMAIL} and ${zones.length} zones`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
```

Register the seed command:

```bash
cd backend && npm pkg set prisma.seed="node prisma/seed.js"
```

- [ ] **Step 5: Run the seed and verify**

Run: `cd backend && npx prisma db seed`
Expected: `Seeded admin admin@isp.local and 2 zones`

Verify: `psql -d isp_feasibility_dev -c 'select email, role from "User"'`
Expected: one row, `admin@isp.local | ADMIN`

- [ ] **Step 6: Update .gitignore and commit**

Append to root `.gitignore`:

```
backend/uploads/
*.env
!*.env.example
```

```bash
git add backend .gitignore
git commit -m "feat(backend): add Prisma schema, initial migration, and seed"
```

---

### Task 3: Error handling, response envelope, and validation middleware

**Files:**
- Create: `backend/src/lib/api-error.js`
- Create: `backend/src/middleware/error-handler.js`
- Create: `backend/src/middleware/validate.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/error-handler.test.js`

**Interfaces:**
- Produces: `ApiError` class with static helpers `badRequest(message, details?)`, `unauthorized(message?)`, `forbidden(message?)`, `notFound(message?)`, `conflict(message, details?)`; each instance has `status`, `code`, `message`, `details`. `errorHandler(err, req, res, next)` Express error middleware. `validateBody(zodSchema)` middleware that replaces `req.body` with the parsed result or forwards a `ZodError`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/error-handler.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/error-handler.test.js`
Expected: FAIL — cannot find module `../src/lib/api-error.js`

- [ ] **Step 3: Implement ApiError, errorHandler, validateBody**

`backend/src/lib/api-error.js`:

```js
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(message, details) {
    return new ApiError(400, 'BAD_REQUEST', message, details)
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message)
  }

  static forbidden(message = 'Insufficient permissions') {
    return new ApiError(403, 'FORBIDDEN', message)
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'NOT_FOUND', message)
  }

  static conflict(message, details) {
    return new ApiError(409, 'CONFLICT', message, details)
  }
}
```

`backend/src/middleware/error-handler.js`:

```js
import { ZodError } from 'zod'
import { ApiError } from '../lib/api-error.js'

export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    const error = { code: err.code, message: err.message }
    if (err.details !== undefined) error.details = err.details
    return res.status(err.status).json({ success: false, error })
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.flatten().fieldErrors,
      },
    })
  }

  console.error(err)
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  })
}
```

`backend/src/middleware/validate.js`:

```js
export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body)
  if (!result.success) return next(result.error)
  req.body = result.data
  next()
}
```

Wire the error handler into `backend/src/app.js` (add import, and `app.use(errorHandler)` as the LAST middleware before `return app`):

```js
import express from 'express'
import cors from 'cors'
import { errorHandler } from './middleware/error-handler.js'

export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json())

  app.get('/api/v1/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok' } })
  })

  app.use(errorHandler)
  return app
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run`
Expected: PASS (all tests, including Task 1's health test)

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/tests
git commit -m "feat(backend): centralized error handling and Zod body validation"
```

---

### Task 4: Auth module — login service and endpoint

**Files:**
- Create: `backend/src/modules/users/user.repository.js`
- Create: `backend/src/modules/auth/auth.service.js`
- Create: `backend/src/modules/auth/auth.schemas.js`
- Create: `backend/src/modules/auth/auth.controller.js`
- Create: `backend/src/modules/auth/auth.routes.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/auth.service.test.js`

**Interfaces:**
- Consumes: `ApiError`, `validateBody`, `env` from earlier tasks.
- Produces: `userRepository` with `findByEmail(email)`, `findById(id)`, `create(data)`, `list()`, `update(id, data)` (all return Prisma User promises). `createAuthService({ userRepository })` returning `{ login({ email, password }) → { token, user } }`. `toPublicUser(user)` strips `passwordHash`. Route `POST /api/v1/auth/login`.

- [ ] **Step 1: Install jsonwebtoken and write the failing service test**

```bash
cd backend && npm install jsonwebtoken
```

`backend/tests/auth.service.test.js`:

```js
import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createAuthService } from '../src/modules/auth/auth.service.js'
import { env } from '../src/config/env.js'

function fakeUserRepository(users) {
  return {
    findByEmail: async (email) => users.find((u) => u.email === email) ?? null,
  }
}

const surveyor = {
  id: 'user-1',
  name: 'Field One',
  email: 'field@isp.local',
  passwordHash: bcrypt.hashSync('correct-password', 4),
  role: 'SURVEYOR',
  isActive: true,
}

describe('auth service login', () => {
  it('returns a signed JWT and public user for valid credentials', async () => {
    const service = createAuthService({ userRepository: fakeUserRepository([surveyor]) })
    const { token, user } = await service.login({
      email: 'field@isp.local',
      password: 'correct-password',
    })

    const payload = jwt.verify(token, env.jwtSecret)
    expect(payload.sub).toBe('user-1')
    expect(payload.role).toBe('SURVEYOR')
    expect(user).not.toHaveProperty('passwordHash')
    expect(user.email).toBe('field@isp.local')
  })

  it('rejects a wrong password with 401', async () => {
    const service = createAuthService({ userRepository: fakeUserRepository([surveyor]) })
    await expect(
      service.login({ email: 'field@isp.local', password: 'wrong' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an unknown email with 401', async () => {
    const service = createAuthService({ userRepository: fakeUserRepository([]) })
    await expect(
      service.login({ email: 'nobody@isp.local', password: 'x' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects a deactivated user with 401', async () => {
    const inactive = { ...surveyor, isActive: false }
    const service = createAuthService({ userRepository: fakeUserRepository([inactive]) })
    await expect(
      service.login({ email: 'field@isp.local', password: 'correct-password' }),
    ).rejects.toMatchObject({ status: 401 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/auth.service.test.js`
Expected: FAIL — cannot find module `../src/modules/auth/auth.service.js`

- [ ] **Step 3: Implement repository, service, schemas, controller, routes**

`backend/src/modules/users/user.repository.js`:

```js
import { prisma } from '../../lib/prisma.js'

export const userRepository = {
  findByEmail: (email) => prisma.user.findUnique({ where: { email } }),
  findById: (id) => prisma.user.findUnique({ where: { id } }),
  create: (data) => prisma.user.create({ data }),
  list: () => prisma.user.findMany({ orderBy: { createdAt: 'desc' } }),
  update: (id, data) => prisma.user.update({ where: { id }, data }),
}
```

`backend/src/modules/auth/auth.service.js`:

```js
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import { ApiError } from '../../lib/api-error.js'

export function toPublicUser(user) {
  const { passwordHash, ...publicUser } = user
  return publicUser
}

export function createAuthService({ userRepository }) {
  return {
    async login({ email, password }) {
      const user = await userRepository.findByEmail(email)
      if (!user || !user.isActive) {
        throw ApiError.unauthorized('Invalid email or password')
      }

      const passwordMatches = await bcrypt.compare(password, user.passwordHash)
      if (!passwordMatches) {
        throw ApiError.unauthorized('Invalid email or password')
      }

      const token = jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
        expiresIn: env.jwtExpiresIn,
      })
      return { token, user: toPublicUser(user) }
    },
  }
}
```

`backend/src/modules/auth/auth.schemas.js`:

```js
import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
```

`backend/src/modules/auth/auth.controller.js`:

```js
import { createAuthService } from './auth.service.js'
import { userRepository } from '../users/user.repository.js'

const authService = createAuthService({ userRepository })

export const authController = {
  async login(req, res, next) {
    try {
      const result = await authService.login(req.body)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
}
```

`backend/src/modules/auth/auth.routes.js`:

```js
import { Router } from 'express'
import { validateBody } from '../../middleware/validate.js'
import { loginSchema } from './auth.schemas.js'
import { authController } from './auth.controller.js'

export const authRoutes = Router()

authRoutes.post('/login', validateBody(loginSchema), authController.login)
```

Mount in `backend/src/app.js` (add import and `app.use` line above the error handler):

```js
import { authRoutes } from './modules/auth/auth.routes.js'
// inside createApp(), before errorHandler:
app.use('/api/v1/auth', authRoutes)
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd backend && npx vitest run`
Expected: PASS (all tests)

- [ ] **Step 5: Smoke-test login against the seeded admin**

```bash
cd backend && (node src/server.js &) && sleep 1 && \
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@isp.local","password":"ChangeMe123!"}'; \
kill %1
```

Expected: JSON with `"success":true` and a `token`.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): JWT login with layered auth module"
```

---

### Task 5: Auth middleware — requireAuth and requireRole, plus GET /auth/me

**Files:**
- Create: `backend/src/middleware/auth.js`
- Modify: `backend/src/modules/auth/auth.controller.js`
- Modify: `backend/src/modules/auth/auth.routes.js`
- Test: `backend/tests/auth.middleware.test.js`

**Interfaces:**
- Consumes: `env.jwtSecret`, `ApiError`.
- Produces: `requireAuth(req, res, next)` — verifies Bearer token, sets `req.user = { id, role }`. `requireRole(...roles)` — 403 unless `req.user.role` is included. Route `GET /api/v1/auth/me` returning the current public user.

- [ ] **Step 1: Write the failing middleware test**

`backend/tests/auth.middleware.test.js`:

```js
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'
import { requireAuth, requireRole } from '../src/middleware/auth.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { env } from '../src/config/env.js'

function testApp() {
  const app = express()
  app.get('/me', requireAuth, (req, res) => res.json({ success: true, data: req.user }))
  app.get('/admin-only', requireAuth, requireRole('ADMIN'), (req, res) =>
    res.json({ success: true, data: 'secret' }),
  )
  app.use(errorHandler)
  return app
}

const tokenFor = (role) =>
  jwt.sign({ sub: 'user-1', role }, env.jwtSecret, { expiresIn: '1h' })

describe('auth middleware', () => {
  it('rejects requests with no token', async () => {
    const res = await request(testApp()).get('/me')
    expect(res.status).toBe(401)
  })

  it('rejects a malformed token', async () => {
    const res = await request(testApp()).get('/me').set('Authorization', 'Bearer garbage')
    expect(res.status).toBe(401)
  })

  it('sets req.user from a valid token', async () => {
    const res = await request(testApp())
      .get('/me')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ id: 'user-1', role: 'SURVEYOR' })
  })

  it('blocks a surveyor from an admin route', async () => {
    const res = await request(testApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(res.status).toBe(403)
  })

  it('allows an admin through requireRole("ADMIN")', async () => {
    const res = await request(testApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/auth.middleware.test.js`
Expected: FAIL — cannot find module `../src/middleware/auth.js`

- [ ] **Step 3: Implement the middleware and /auth/me**

`backend/src/middleware/auth.js`:

```js
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { ApiError } from '../lib/api-error.js'

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized())

  try {
    const payload = jwt.verify(token, env.jwtSecret)
    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    next(ApiError.unauthorized('Invalid or expired token'))
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized())
  if (!roles.includes(req.user.role)) return next(ApiError.forbidden())
  next()
}
```

Add `me` to `backend/src/modules/auth/auth.controller.js`:

```js
import { createAuthService, toPublicUser } from './auth.service.js'
import { userRepository } from '../users/user.repository.js'
import { ApiError } from '../../lib/api-error.js'

const authService = createAuthService({ userRepository })

export const authController = {
  async login(req, res, next) {
    try {
      const result = await authService.login(req.body)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },

  async me(req, res, next) {
    try {
      const user = await userRepository.findById(req.user.id)
      if (!user || !user.isActive) throw ApiError.unauthorized()
      res.json({ success: true, data: toPublicUser(user) })
    } catch (err) {
      next(err)
    }
  },
}
```

Add the route in `backend/src/modules/auth/auth.routes.js`:

```js
import { Router } from 'express'
import { validateBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { loginSchema } from './auth.schemas.js'
import { authController } from './auth.controller.js'

export const authRoutes = Router()

authRoutes.post('/login', validateBody(loginSchema), authController.login)
authRoutes.get('/me', requireAuth, authController.me)
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd backend && npx vitest run`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat(backend): requireAuth/requireRole middleware and GET /auth/me"
```

---

### Task 6: Users module — admin-managed user CRUD

**Files:**
- Create: `backend/src/modules/users/user.service.js`
- Create: `backend/src/modules/users/user.schemas.js`
- Create: `backend/src/modules/users/user.controller.js`
- Create: `backend/src/modules/users/user.routes.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/user.service.test.js`

**Interfaces:**
- Consumes: `userRepository`, `toPublicUser`, `ApiError`, `requireAuth`, `requireRole`, `validateBody`.
- Produces: `createUserService({ userRepository })` with `createUser(data)` (hashes password, 409 on duplicate email), `listUsers()`, `updateUser(id, data)` (role/isActive/name changes). Routes: `POST /api/v1/users` (ADMIN), `GET /api/v1/users` (ADMIN, MANAGER), `PATCH /api/v1/users/:id` (ADMIN). `createUserSchema` requires a password policy (see Step 3 note).

- [ ] **Step 1: Write the failing service test**

`backend/tests/user.service.test.js`:

```js
import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { createUserService } from '../src/modules/users/user.service.js'

function fakeUserRepository(seed = []) {
  const users = [...seed]
  return {
    users,
    findByEmail: async (email) => users.find((u) => u.email === email) ?? null,
    create: async (data) => {
      const user = { id: `user-${users.length + 1}`, isActive: true, ...data }
      users.push(user)
      return user
    },
    list: async () => users,
    update: async (id, data) => {
      const user = users.find((u) => u.id === id)
      Object.assign(user, data)
      return user
    },
  }
}

describe('user service', () => {
  it('creates a user with a bcrypt-hashed password and no passwordHash in the result', async () => {
    const repo = fakeUserRepository()
    const service = createUserService({ userRepository: repo })
    const user = await service.createUser({
      name: 'New Surveyor',
      email: 'new@isp.local',
      password: 'StrongPass1',
      role: 'SURVEYOR',
    })

    expect(user).not.toHaveProperty('passwordHash')
    expect(user.email).toBe('new@isp.local')
    expect(bcrypt.compareSync('StrongPass1', repo.users[0].passwordHash)).toBe(true)
  })

  it('rejects a duplicate email with 409', async () => {
    const repo = fakeUserRepository([{ id: 'u1', email: 'dup@isp.local' }])
    const service = createUserService({ userRepository: repo })
    await expect(
      service.createUser({
        name: 'Dup',
        email: 'dup@isp.local',
        password: 'StrongPass1',
        role: 'SURVEYOR',
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('lists users without password hashes', async () => {
    const repo = fakeUserRepository([
      { id: 'u1', email: 'a@isp.local', passwordHash: 'x', role: 'ADMIN' },
    ])
    const service = createUserService({ userRepository: repo })
    const users = await service.listUsers()
    expect(users[0]).not.toHaveProperty('passwordHash')
  })

  it('updates role and isActive', async () => {
    const repo = fakeUserRepository([
      { id: 'u1', email: 'a@isp.local', passwordHash: 'x', role: 'SURVEYOR', isActive: true },
    ])
    const service = createUserService({ userRepository: repo })
    const updated = await service.updateUser('u1', { role: 'MANAGER', isActive: false })
    expect(updated.role).toBe('MANAGER')
    expect(updated.isActive).toBe(false)
    expect(updated).not.toHaveProperty('passwordHash')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/user.service.test.js`
Expected: FAIL — cannot find module `../src/modules/users/user.service.js`

- [ ] **Step 3: Implement service, schemas, controller, routes**

`backend/src/modules/users/user.service.js`:

```js
import bcrypt from 'bcryptjs'
import { ApiError } from '../../lib/api-error.js'
import { toPublicUser } from '../auth/auth.service.js'

const BCRYPT_ROUNDS = 10

export function createUserService({ userRepository }) {
  return {
    async createUser({ password, ...data }) {
      const existing = await userRepository.findByEmail(data.email)
      if (existing) throw ApiError.conflict('A user with this email already exists')

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
      const user = await userRepository.create({ ...data, passwordHash })
      return toPublicUser(user)
    },

    async listUsers() {
      const users = await userRepository.list()
      return users.map(toPublicUser)
    },

    async updateUser(id, data) {
      const user = await userRepository.update(id, data)
      return toPublicUser(user)
    },
  }
}
```

`backend/src/modules/users/user.schemas.js` — **NOTE FOR IMPLEMENTER:** the
password policy inside `createUserSchema` is a USER CONTRIBUTION point
(learning mode). Scaffold the file with a `TODO` password rule of
`z.string().min(1)` and ask the user to define the real policy before the
commit step. Everything else is fixed:

```js
import { z } from 'zod'

const roleSchema = z.enum(['ADMIN', 'MANAGER', 'SURVEYOR'])

// USER CONTRIBUTION: define the password policy for field-team accounts.
// Trade-off: surveyors type this on phones in the field — length vs typability.
const passwordSchema = z.string().min(1)

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: passwordSchema,
  role: roleSchema,
})

export const updateUserSchema = z
  .object({
    name: z.string().min(1),
    role: roleSchema,
    isActive: z.boolean(),
  })
  .partial()
```

`backend/src/modules/users/user.controller.js`:

```js
import { createUserService } from './user.service.js'
import { userRepository } from './user.repository.js'

const userService = createUserService({ userRepository })

export const userController = {
  async create(req, res, next) {
    try {
      const user = await userService.createUser(req.body)
      res.status(201).json({ success: true, data: user })
    } catch (err) {
      next(err)
    }
  },

  async list(req, res, next) {
    try {
      const users = await userService.listUsers()
      res.json({ success: true, data: users })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      const user = await userService.updateUser(req.params.id, req.body)
      res.json({ success: true, data: user })
    } catch (err) {
      next(err)
    }
  },
}
```

`backend/src/modules/users/user.routes.js`:

```js
import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { createUserSchema, updateUserSchema } from './user.schemas.js'
import { userController } from './user.controller.js'

export const userRoutes = Router()

userRoutes.use(requireAuth)
userRoutes.post('/', requireRole('ADMIN'), validateBody(createUserSchema), userController.create)
userRoutes.get('/', requireRole('ADMIN', 'MANAGER'), userController.list)
userRoutes.patch('/:id', requireRole('ADMIN'), validateBody(updateUserSchema), userController.update)
```

Mount in `backend/src/app.js` next to authRoutes:

```js
import { userRoutes } from './modules/users/user.routes.js'
// inside createApp(), before errorHandler:
app.use('/api/v1/users', userRoutes)
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd backend && npx vitest run`
Expected: PASS (all tests)

- [ ] **Step 5: Pause for user contribution — password policy**

Ask the user to write the `passwordSchema` in `user.schemas.js` (5-ish lines).
Do not proceed to commit until they have provided it or explicitly deferred.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): admin-managed user CRUD with role guards"
```

---

### Task 7: Frontend scaffold — Next.js, Tailwind, API client, auth store

**Files:**
- Create: `frontend/` via create-next-app (JS, Tailwind, App Router, src dir)
- Create: `frontend/.env.local`
- Create: `frontend/src/lib/api-client.js`
- Create: `frontend/src/stores/auth-store.js`
- Create: `frontend/src/schemas/auth.js`

**Interfaces:**
- Produces: `apiClient` (Axios instance, baseURL `http://localhost:4000/api/v1`, attaches `Authorization: Bearer <token>`, clears auth + redirects to `/login` on 401). `useAuthStore` (Zustand, persisted key `isp-auth`) with state `{ token, user }` and actions `setAuth({ token, user })`, `clearAuth()`. `loginSchema` Zod object `{ email, password }`.

- [ ] **Step 1: Scaffold the app**

```bash
cd "/Users/gazon/Documents/Network graph map"
npx create-next-app@latest frontend --js --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack
cd frontend
npm install zustand react-hook-form @hookform/resolvers zod axios
```

`frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
```

- [ ] **Step 2: Create the auth store**

`frontend/src/stores/auth-store.js`:

```js
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: ({ token, user }) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
    }),
    { name: 'isp-auth' },
  ),
)
```

- [ ] **Step 3: Create the API client**

`frontend/src/lib/api-client.js`:

```js
import axios from 'axios'
import { useAuthStore } from '@/stores/auth-store'

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
})

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/login')
    if (error.response?.status === 401 && !isLoginRequest) {
      useAuthStore.getState().clearAuth()
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export function getApiErrorMessage(error, fallback = 'Something went wrong') {
  return error.response?.data?.error?.message ?? fallback
}
```

- [ ] **Step 4: Create the login schema**

`frontend/src/schemas/auth.js`:

```js
import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})
```

- [ ] **Step 5: Verify the dev server boots**

Run: `cd frontend && npm run dev &` then `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` and kill the server.
Expected: `200`

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(frontend): scaffold Next.js app with auth store and API client"
```

---

### Task 8: Login page — mobile-first with RHF + Zod

**Files:**
- Create: `frontend/src/components/ui/Button.js`
- Create: `frontend/src/components/ui/Input.js`
- Create: `frontend/src/app/login/page.js`
- Modify: `frontend/src/app/layout.js` (app metadata title)
- Modify: `frontend/src/app/globals.css` (keep Tailwind import only)

**Interfaces:**
- Consumes: `apiClient`, `getApiErrorMessage`, `useAuthStore`, `loginSchema`.
- Produces: `<Button variant size fullWidth loading>` and `<Input label error ...props>` reusable components (used by every later form). `/login` route that stores `{ token, user }` and redirects to `/map`.

- [ ] **Step 1: Create the reusable UI components**

`frontend/src/components/ui/Button.js`:

```js
'use client'

const VARIANTS = {
  primary: 'bg-blue-600 text-white active:bg-blue-700 disabled:bg-blue-300',
  secondary: 'bg-gray-100 text-gray-900 active:bg-gray-200 disabled:text-gray-400',
  danger: 'bg-red-600 text-white active:bg-red-700 disabled:bg-red-300',
}

export function Button({
  variant = 'primary',
  fullWidth = false,
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`min-h-12 rounded-xl px-6 text-base font-semibold transition-colors ${VARIANTS[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {loading ? 'Please wait…' : children}
    </button>
  )
}
```

`frontend/src/components/ui/Input.js`:

```js
'use client'

import { forwardRef } from 'react'

export const Input = forwardRef(function Input({ label, error, id, ...props }, ref) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={`min-h-12 rounded-xl border px-4 text-base outline-none focus:ring-2 ${
          error ? 'border-red-400 focus:ring-red-200' : 'border-gray-300 focus:ring-blue-200'
        }`}
        {...props}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
})
```

- [ ] **Step 2: Build the login page**

`frontend/src/app/login/page.js`:

```js
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiClient, getApiErrorMessage } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { loginSchema } from '@/schemas/auth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [serverError, setServerError] = useState(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema) })

  async function onSubmit(values) {
    setServerError(null)
    try {
      const res = await apiClient.post('/auth/login', values)
      setAuth(res.data.data)
      router.replace('/map')
    } catch (err) {
      setServerError(getApiErrorMessage(err, 'Login failed'))
    }
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center bg-gray-50 px-6">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">ISP Coverage</h1>
        <p className="mb-8 text-gray-500">Sign in to start surveying</p>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Input
            id="email"
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />

          {serverError && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{serverError}</p>
          )}

          <Button type="submit" fullWidth loading={isSubmitting}>
            Sign In
          </Button>
        </form>
      </div>
    </main>
  )
}
```

Update the `metadata` export in `frontend/src/app/layout.js`:

```js
export const metadata = {
  title: 'ISP Coverage',
  description: 'Building feasibility and coverage management',
}
```

- [ ] **Step 3: Verify login flow end-to-end**

Start both servers (`backend: npm run dev`, `frontend: npm run dev`), open
`http://localhost:3000/login`, sign in with `admin@isp.local` /
`ChangeMe123!`. Expected: redirect to `/map` (404 for now — the shell comes in
Task 9). Verify `localStorage` key `isp-auth` contains the token.

- [ ] **Step 4: Commit**

```bash
git add frontend
git commit -m "feat(frontend): mobile-first login page with RHF + Zod"
```

---

### Task 9: Authenticated app shell — protected layout and bottom navigation

**Files:**
- Create: `frontend/src/components/layout/BottomNav.js`
- Create: `frontend/src/components/layout/AuthGuard.js`
- Create: `frontend/src/app/(app)/layout.js`
- Create: `frontend/src/app/(app)/map/page.js`
- Create: `frontend/src/app/(app)/buildings/page.js`
- Create: `frontend/src/app/(app)/profile/page.js`
- Modify: `frontend/src/app/page.js` (root redirect)

**Interfaces:**
- Consumes: `useAuthStore`, `Button`.
- Produces: route group `(app)` whose layout enforces auth and renders `<BottomNav />`. Placeholder pages `/map`, `/buildings`, `/profile` for later phases to fill in.

- [ ] **Step 1: Create the auth guard**

`frontend/src/components/layout/AuthGuard.js`:

```js
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

export function AuthGuard({ children }) {
  const router = useRouter()
  const token = useAuthStore((s) => s.token)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated && !token) router.replace('/login')
  }, [hydrated, token, router])

  if (!hydrated || !token) return null
  return children
}
```

- [ ] **Step 2: Create the bottom navigation**

`frontend/src/components/layout/BottomNav.js`:

```js
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/map', label: 'Map', icon: '🗺️' },
  { href: '/buildings', label: 'Buildings', icon: '🏢' },
  { href: '/profile', label: 'Profile', icon: '👤' },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-lg">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                active ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
```

- [ ] **Step 3: Create the protected layout and placeholder pages**

`frontend/src/app/(app)/layout.js`:

```js
import { AuthGuard } from '@/components/layout/AuthGuard'
import { BottomNav } from '@/components/layout/BottomNav'

export default function AppLayout({ children }) {
  return (
    <AuthGuard>
      <div className="min-h-dvh bg-gray-50 pb-20">
        {children}
        <BottomNav />
      </div>
    </AuthGuard>
  )
}
```

`frontend/src/app/(app)/map/page.js`:

```js
export default function MapPage() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-bold text-gray-900">Map</h1>
      <p className="mt-2 text-gray-500">Map dashboard arrives in Phase 4.</p>
    </main>
  )
}
```

`frontend/src/app/(app)/buildings/page.js`:

```js
export default function BuildingsPage() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-bold text-gray-900">Buildings</h1>
      <p className="mt-2 text-gray-500">Building list arrives in Phase 2.</p>
    </main>
  )
}
```

`frontend/src/app/(app)/profile/page.js`:

```js
'use client'

import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/Button'

export default function ProfilePage() {
  const router = useRouter()
  const { user, clearAuth } = useAuthStore()

  function handleLogout() {
    clearAuth()
    router.replace('/login')
  }

  return (
    <main className="p-6">
      <h1 className="text-xl font-bold text-gray-900">Profile</h1>
      {user && (
        <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <p className="font-semibold text-gray-900">{user.name}</p>
          <p className="text-sm text-gray-500">{user.email}</p>
          <p className="mt-1 inline-block rounded-full bg-blue-50 px-3 py-0.5 text-xs font-medium text-blue-700">
            {user.role}
          </p>
        </div>
      )}
      <div className="mt-6">
        <Button variant="danger" fullWidth onClick={handleLogout}>
          Log Out
        </Button>
      </div>
    </main>
  )
}
```

Replace `frontend/src/app/page.js` with a root redirect:

```js
import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/map')
}
```

- [ ] **Step 4: Verify the shell end-to-end**

With both servers running: visiting `/` while logged out redirects to
`/login`; after login you land on `/map` with the bottom nav; tapping
Buildings/Profile navigates; Log Out returns to `/login` and `/map` is no
longer accessible.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): protected app shell with bottom navigation"
```

---

### Task 10: Full-suite verification and root README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npx vitest run`
Expected: all tests PASS.

- [ ] **Step 2: Boot both apps and smoke-test the login flow once more**

Backend `npm run dev`, frontend `npm run dev`, log in at
`http://localhost:3000/login` with the seeded admin. Expected: `/map` shell renders.

- [ ] **Step 3: Write the README**

`README.md`:

```markdown
# ISP Building Feasibility & Coverage System

Mobile-first GIS platform for ISP field survey teams. See `PRD.md` for the
full specification and `docs/superpowers/specs/` for architecture decisions.

## Stack

- **Backend:** Express 5 + Prisma + PostgreSQL (`backend/`)
- **Frontend:** Next.js App Router + Tailwind + Zustand (`frontend/`)

## Development setup

1. Start PostgreSQL: `brew services start postgresql@15`
2. Create the database: `createdb isp_feasibility_dev`
3. Backend:
   ```bash
   cd backend
   cp .env.example .env   # fill in values
   npm install
   npx prisma migrate dev
   npx prisma db seed     # creates admin@isp.local
   npm run dev            # http://localhost:4000
   ```
4. Frontend:
   ```bash
   cd frontend
   npm install
   npm run dev            # http://localhost:3000
   ```

## Tests

- Backend: `cd backend && npm test`
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: development setup README"
```
