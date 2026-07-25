# Phase 2 – Add Building Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Field surveyors can add a building end-to-end: GPS capture → nearby search (Nominatim) → auto-fill → marker adjustment → manual fields → optional uploads → save.

**Architecture:** Frontend gets a `MapProvider` abstraction (Nominatim now, Google later), a `useGeolocation` hook, and a Leaflet-based `LocationPicker`. Backend gets `zones` (read), `buildings` (create/list/get with nested writes), and an `uploads` module behind a `StorageProvider` abstraction (local disk now, S3 later). Files upload first and return URLs; the building POST references those URLs.

**Tech Stack:** Existing stack + `leaflet` (frontend), `multer` (backend). Nominatim public API via `fetch` (no key).

## Global Constraints

- JavaScript only — no TypeScript anywhere (PRD mandate).
- Backend is ESM; imports use `.js` extensions. Layering: routes → controller → service → repository; services take dependencies via factory functions.
- All API routes under `/api/v1`; envelope `{ success: true, data }` / `{ success: false, error: { code, message, details? } }`.
- Photo type enum values, verbatim: `ENTRANCE`, `PERMISSION_LETTER`, `ADDITIONAL`.
- placeId in development = `"<osm_type>:<osm_id>"` (Nominatim `place_id` is unstable).
- GPS coordinates are never typed by hand; marker drag is the only manual adjustment.
- GPS accuracy warning threshold: 20 m (PRD).
- Mobile-first: ≥44px touch targets; components stay small; no business logic in React components (hooks/services only).
- Building types static list until Phase 6: `Residential`, `Commercial`, `Mixed Use`, `Industrial`.
- Commit after every task.

---

### Task 1: Backend — zones read endpoint

**Files:**
- Create: `backend/src/modules/zones/zone.repository.js`
- Create: `backend/src/modules/zones/zone.controller.js`
- Create: `backend/src/modules/zones/zone.routes.js`
- Modify: `backend/src/app.js`
- Test: `backend/tests/zones.route.test.js`

**Interfaces:**
- Consumes: `prisma`, `requireAuth`, `errorHandler`, `env.jwtSecret`.
- Produces: `GET /api/v1/zones` → `{ success: true, data: [{ id, name, city }] }` ordered by name. `zoneRepository.list()`.

- [ ] **Step 1: Write the failing route test** (hits the real dev DB — seeded zones exist)

`backend/tests/zones.route.test.js`:

```js
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const token = jwt.sign({ sub: 'test-user', role: 'SURVEYOR' }, env.jwtSecret, { expiresIn: '1h' })

describe('GET /api/v1/zones', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).get('/api/v1/zones')
    expect(res.status).toBe(401)
  })

  it('returns zones ordered by name', async () => {
    const res = await request(createApp())
      .get('/api/v1/zones')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.length).toBeGreaterThanOrEqual(2)
    const names = res.body.data.map((z) => z.name)
    expect(names).toEqual([...names].sort())
    expect(res.body.data[0]).toHaveProperty('id')
    expect(res.body.data[0]).toHaveProperty('city')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/zones.route.test.js`
Expected: FAIL — 404 (route not mounted)

- [ ] **Step 3: Implement repository, controller, routes**

`backend/src/modules/zones/zone.repository.js`:

```js
import { prisma } from '../../lib/prisma.js'

export const zoneRepository = {
  list: () => prisma.zone.findMany({ orderBy: { name: 'asc' } }),
}
```

`backend/src/modules/zones/zone.controller.js`:

```js
import { zoneRepository } from './zone.repository.js'

export const zoneController = {
  async list(req, res, next) {
    try {
      const zones = await zoneRepository.list()
      res.json({ success: true, data: zones })
    } catch (err) {
      next(err)
    }
  },
}
```

`backend/src/modules/zones/zone.routes.js`:

```js
import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { zoneController } from './zone.controller.js'

export const zoneRoutes = Router()

zoneRoutes.get('/', requireAuth, zoneController.list)
```

In `backend/src/app.js` add the import and mount next to the other routes:

```js
import { zoneRoutes } from './modules/zones/zone.routes.js'
// inside createApp():
app.use('/api/v1/zones', zoneRoutes)
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd backend && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend && git commit -m "feat(backend): zones read endpoint"
```

---

### Task 2: Backend — buildings module (create, list, get)

**Files:**
- Create: `backend/src/modules/buildings/building.repository.js`
- Create: `backend/src/modules/buildings/building.service.js`
- Create: `backend/src/modules/buildings/building.schemas.js`
- Create: `backend/src/modules/buildings/building.controller.js`
- Create: `backend/src/modules/buildings/building.routes.js`
- Modify: `backend/src/middleware/error-handler.js` (Prisma P2002 → 409)
- Modify: `backend/src/app.js`
- Test: `backend/tests/building.service.test.js`

**Interfaces:**
- Consumes: `prisma`, `ApiError`, `requireAuth`, `validateBody`.
- Produces: `createBuildingService({ buildingRepository })` with `createBuilding(input, createdById)`, `listBuildings()`, `getBuilding(id)` (404 when missing). Routes: `POST /api/v1/buildings`, `GET /api/v1/buildings`, `GET /api/v1/buildings/:id`. `createBuildingSchema` shape (nested `details`, `permission`, `photos`).

- [ ] **Step 1: Write the failing service test**

`backend/tests/building.service.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

function fakeBuildingRepository(seed = []) {
  const buildings = [...seed]
  return {
    buildings,
    create: async (data) => {
      const building = { id: `b-${buildings.length + 1}`, ...data }
      buildings.push(building)
      return building
    },
    list: async () => buildings,
    findById: async (id) => buildings.find((b) => b.id === id) ?? null,
  }
}

describe('building service', () => {
  it('creates a building with nested details/permission/photos and the creator id', async () => {
    const repo = fakeBuildingRepository()
    const service = createBuildingService({ buildingRepository: repo })

    await service.createBuilding(
      {
        placeId: 'way:123',
        buildingName: 'Sunrise Apartments',
        formattedAddress: '12 Main St',
        latitude: 19.1,
        longitude: 72.9,
        zoneId: 'zone-1',
        details: { wings: 2, floors: 10 },
        permission: { amountPaid: 5000 },
        photos: [{ type: 'ENTRANCE', url: '/uploads/a.jpg' }],
      },
      'user-9',
    )

    const created = repo.buildings[0]
    expect(created.createdById).toBe('user-9')
    expect(created.details).toEqual({ create: { wings: 2, floors: 10 } })
    expect(created.permission).toEqual({ create: { amountPaid: 5000 } })
    expect(created.photos).toEqual({ create: [{ type: 'ENTRANCE', url: '/uploads/a.jpg' }] })
    expect(created.buildingName).toBe('Sunrise Apartments')
  })

  it('omits nested writes that were not provided', async () => {
    const repo = fakeBuildingRepository()
    const service = createBuildingService({ buildingRepository: repo })

    await service.createBuilding(
      {
        buildingName: 'Lone House',
        formattedAddress: 'Nowhere 1',
        latitude: 1,
        longitude: 2,
        zoneId: 'zone-1',
      },
      'user-1',
    )

    const created = repo.buildings[0]
    expect(created.details).toBeUndefined()
    expect(created.permission).toBeUndefined()
    expect(created.photos).toBeUndefined()
  })

  it('throws 404 for an unknown building id', async () => {
    const service = createBuildingService({ buildingRepository: fakeBuildingRepository() })
    await expect(service.getBuilding('missing')).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/building.service.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement the module**

`backend/src/modules/buildings/building.repository.js`:

```js
import { prisma } from '../../lib/prisma.js'

const fullInclude = {
  zone: true,
  details: true,
  permission: true,
  photos: true,
  createdBy: { select: { id: true, name: true } },
}

export const buildingRepository = {
  create: (data) => prisma.building.create({ data, include: fullInclude }),
  list: () =>
    prisma.building.findMany({
      include: { zone: true, details: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  findById: (id) => prisma.building.findUnique({ where: { id }, include: fullInclude }),
}
```

`backend/src/modules/buildings/building.service.js`:

```js
import { ApiError } from '../../lib/api-error.js'

export function createBuildingService({ buildingRepository }) {
  return {
    async createBuilding(input, createdById) {
      const { details, permission, photos, ...building } = input
      return buildingRepository.create({
        ...building,
        createdById,
        details: details ? { create: details } : undefined,
        permission: permission ? { create: permission } : undefined,
        photos: photos?.length ? { create: photos } : undefined,
      })
    },

    async listBuildings() {
      return buildingRepository.list()
    },

    async getBuilding(id) {
      const building = await buildingRepository.findById(id)
      if (!building) throw ApiError.notFound('Building not found')
      return building
    },
  }
}
```

`backend/src/modules/buildings/building.schemas.js`:

```js
import { z } from 'zod'

export const createBuildingSchema = z.object({
  placeId: z.string().min(1).nullish(),
  buildingName: z.string().min(1).max(200),
  formattedAddress: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  zoneId: z.string().min(1),
  details: z
    .object({
      wings: z.number().int().positive().optional(),
      floors: z.number().int().positive().optional(),
      homePass: z.number().int().nonnegative().optional(),
      buildingType: z.string().max(50).optional(),
      remarks: z.string().max(1000).optional(),
    })
    .optional(),
  permission: z
    .object({
      amountPaid: z.number().nonnegative().optional(),
      documentUrl: z.string().max(500).optional(),
    })
    .optional(),
  photos: z
    .array(
      z.object({
        type: z.enum(['ENTRANCE', 'PERMISSION_LETTER', 'ADDITIONAL']),
        url: z.string().min(1).max(500),
      }),
    )
    .max(20)
    .optional(),
})
```

`backend/src/modules/buildings/building.controller.js`:

```js
import { createBuildingService } from './building.service.js'
import { buildingRepository } from './building.repository.js'

const buildingService = createBuildingService({ buildingRepository })

export const buildingController = {
  async create(req, res, next) {
    try {
      const building = await buildingService.createBuilding(req.body, req.user.id)
      res.status(201).json({ success: true, data: building })
    } catch (err) {
      next(err)
    }
  },

  async list(req, res, next) {
    try {
      const buildings = await buildingService.listBuildings()
      res.json({ success: true, data: buildings })
    } catch (err) {
      next(err)
    }
  },

  async get(req, res, next) {
    try {
      const building = await buildingService.getBuilding(req.params.id)
      res.json({ success: true, data: building })
    } catch (err) {
      next(err)
    }
  },
}
```

`backend/src/modules/buildings/building.routes.js`:

```js
import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { createBuildingSchema } from './building.schemas.js'
import { buildingController } from './building.controller.js'

export const buildingRoutes = Router()

buildingRoutes.use(requireAuth)
buildingRoutes.post('/', validateBody(createBuildingSchema), buildingController.create)
buildingRoutes.get('/', buildingController.list)
buildingRoutes.get('/:id', buildingController.get)
```

In `backend/src/middleware/error-handler.js`, add Prisma unique-violation
mapping. Full updated file:

```js
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
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

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'A record with this value already exists',
        details: { fields: err.meta?.target },
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

In `backend/src/app.js` add:

```js
import { buildingRoutes } from './modules/buildings/building.routes.js'
// inside createApp():
app.use('/api/v1/buildings', buildingRoutes)
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd backend && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend && git commit -m "feat(backend): buildings module with nested create"
```

---

### Task 3: Backend — StorageProvider abstraction and uploads endpoint

**Files:**
- Create: `backend/src/lib/storage/local-storage-provider.js`
- Create: `backend/src/lib/storage/index.js`
- Create: `backend/src/modules/uploads/upload.routes.js`
- Create: `backend/src/modules/uploads/upload.controller.js`
- Modify: `backend/src/config/env.js` (add `appUrl`, `uploadsDir`, `storageDriver`)
- Modify: `backend/src/app.js` (mount routes + static /uploads)
- Test: `backend/tests/local-storage-provider.test.js`
- Test: `backend/tests/uploads.route.test.js`

**Interfaces:**
- Consumes: `requireAuth`, `ApiError`, `env`.
- Produces: `StorageProvider` contract: `save({ buffer, extension }) → Promise<{ key, url }>`. `getStorageProvider()` from `lib/storage/index.js` selects by `env.storageDriver` (`'local'` only for now). `POST /api/v1/uploads` (multipart field `file`) → `201 { success, data: { url } }`. Allowed types: jpeg/png/webp/pdf, max 10 MB.

- [ ] **Step 1: Install multer and write the failing provider test**

```bash
cd backend && npm install multer
```

`backend/tests/local-storage-provider.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createLocalStorageProvider } from '../src/lib/storage/local-storage-provider.js'

const TEST_ROOT = path.join(import.meta.dirname, 'tmp-uploads')

describe('local storage provider', () => {
  beforeEach(() => rm(TEST_ROOT, { recursive: true, force: true }))
  afterEach(() => rm(TEST_ROOT, { recursive: true, force: true }))

  it('saves a buffer and returns a key and public url', async () => {
    const provider = createLocalStorageProvider({
      rootDir: TEST_ROOT,
      baseUrl: 'http://localhost:4000/uploads',
    })
    const { key, url } = await provider.save({
      buffer: Buffer.from('hello'),
      extension: 'jpg',
    })

    expect(key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/)
    expect(url).toBe(`http://localhost:4000/uploads/${key}`)
    const written = await readFile(path.join(TEST_ROOT, key), 'utf8')
    expect(written).toBe('hello')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/local-storage-provider.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement provider, selector, env additions**

Add to the exported `env` object in `backend/src/config/env.js` (keep existing keys):

```js
  appUrl: process.env.APP_URL ?? 'http://localhost:4000',
  uploadsDir: process.env.UPLOADS_DIR ?? 'uploads',
  storageDriver: process.env.STORAGE_DRIVER ?? 'local',
```

`backend/src/lib/storage/local-storage-provider.js`:

```js
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function createLocalStorageProvider({ rootDir, baseUrl }) {
  return {
    async save({ buffer, extension }) {
      const now = new Date()
      const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`
      const key = `${dir}/${randomUUID()}.${extension}`

      await mkdir(path.join(rootDir, dir), { recursive: true })
      await writeFile(path.join(rootDir, key), buffer)
      return { key, url: `${baseUrl}/${key}` }
    },
  }
}
```

`backend/src/lib/storage/index.js`:

```js
import path from 'node:path'
import { env } from '../../config/env.js'
import { createLocalStorageProvider } from './local-storage-provider.js'

const providers = {
  local: () =>
    createLocalStorageProvider({
      rootDir: path.resolve(env.uploadsDir),
      baseUrl: `${env.appUrl}/uploads`,
    }),
}

export function getStorageProvider() {
  const factory = providers[env.storageDriver]
  if (!factory) throw new Error(`Unknown storage driver: ${env.storageDriver}`)
  return factory()
}
```

- [ ] **Step 4: Run provider test to verify it passes**

Run: `cd backend && npx vitest run tests/local-storage-provider.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing uploads route test**

`backend/tests/uploads.route.test.js`:

```js
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/uploads.route.test.js`
Expected: FAIL — 404 (route not mounted)

- [ ] **Step 7: Implement upload controller/routes and static serving**

`backend/src/modules/uploads/upload.controller.js`:

```js
import { ApiError } from '../../lib/api-error.js'
import { getStorageProvider } from '../../lib/storage/index.js'

export const ALLOWED_MIME_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

const storage = getStorageProvider()

export const uploadController = {
  async upload(req, res, next) {
    try {
      if (!req.file) throw ApiError.badRequest('No file provided (field name: file)')
      const extension = ALLOWED_MIME_TYPES[req.file.mimetype]
      const { url } = await storage.save({ buffer: req.file.buffer, extension })
      res.status(201).json({ success: true, data: { url } })
    } catch (err) {
      next(err)
    }
  },
}
```

`backend/src/modules/uploads/upload.routes.js`:

```js
import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../../middleware/auth.js'
import { ApiError } from '../../lib/api-error.js'
import { uploadController, ALLOWED_MIME_TYPES } from './upload.controller.js'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES[file.mimetype]) return cb(null, true)
    cb(ApiError.badRequest('Only JPEG, PNG, WebP images or PDF files are allowed'))
  },
})

export const uploadRoutes = Router()

uploadRoutes.post('/', requireAuth, upload.single('file'), uploadController.upload)
```

In `backend/src/app.js` add imports and mounts (static serving BEFORE the API routes):

```js
import path from 'node:path'
import { env } from './config/env.js'
import { uploadRoutes } from './modules/uploads/upload.routes.js'
// inside createApp():
app.use('/uploads', express.static(path.resolve(env.uploadsDir)))
app.use('/api/v1/uploads', uploadRoutes)
```

- [ ] **Step 8: Run all tests to verify they pass**

Run: `cd backend && npx vitest run`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend && git commit -m "feat(backend): StorageProvider abstraction and uploads endpoint"
```

---

### Task 4: Frontend — MapProvider abstraction and useGeolocation hook

**Files:**
- Create: `frontend/src/lib/map-providers/nominatim-provider.js`
- Create: `frontend/src/lib/map-providers/index.js`
- Create: `frontend/src/lib/constants.js`
- Create: `frontend/src/hooks/useGeolocation.js`

**Interfaces:**
- Produces: `getMapProvider()` returning `{ reverseGeocode({ latitude, longitude }) → Promise<Candidate>, searchNearby({ latitude, longitude, query }) → Promise<Candidate[]> }` where `Candidate = { placeId, name, formattedAddress, latitude, longitude }`. `useGeolocation()` → `{ loading, position: { latitude, longitude } | null, accuracy, error, locate(), accuracyLevel }`. `classifyAccuracy(meters)` → `'good' | 'fair' | 'poor' | null`. Constants: `BUILDING_TYPES`, `GPS_ACCURACY_WARN_METERS = 20`.

- [ ] **Step 1: Create constants**

`frontend/src/lib/constants.js`:

```js
export const BUILDING_TYPES = ['Residential', 'Commercial', 'Mixed Use', 'Industrial']

export const GPS_ACCURACY_WARN_METERS = 20
```

- [ ] **Step 2: Create the Nominatim provider**

`frontend/src/lib/map-providers/nominatim-provider.js`:

```js
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org'
// ≈500 m half-width viewbox — keeps results to the surveyor's surroundings.
const SEARCH_RADIUS_DEG = 0.005

function toCandidate(item) {
  return {
    placeId: `${item.osm_type}:${item.osm_id}`,
    name: item.name || item.display_name.split(',')[0],
    formattedAddress: item.display_name,
    latitude: Number(item.lat),
    longitude: Number(item.lon),
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Map provider request failed (${res.status})`)
  return res.json()
}

export const nominatimProvider = {
  async reverseGeocode({ latitude, longitude }) {
    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      format: 'jsonv2',
    })
    const data = await fetchJson(`${NOMINATIM_BASE_URL}/reverse?${params}`)
    return toCandidate(data)
  },

  async searchNearby({ latitude, longitude, query }) {
    const r = SEARCH_RADIUS_DEG
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '8',
      viewbox: `${longitude - r},${latitude + r},${longitude + r},${latitude - r}`,
      bounded: '1',
    })
    const data = await fetchJson(`${NOMINATIM_BASE_URL}/search?${params}`)
    return data.map(toCandidate)
  },
}
```

- [ ] **Step 3: Create the provider selector**

`frontend/src/lib/map-providers/index.js`:

```js
import { nominatimProvider } from './nominatim-provider.js'

const providers = {
  nominatim: nominatimProvider,
  // google: googlePlacesProvider — added in production (PRD Map Strategy)
}

export function getMapProvider() {
  const name = process.env.NEXT_PUBLIC_MAP_PROVIDER ?? 'nominatim'
  const provider = providers[name]
  if (!provider) throw new Error(`Unknown map provider: ${name}`)
  return provider
}
```

- [ ] **Step 4: Create useGeolocation — PAUSE for user contribution**

`frontend/src/hooks/useGeolocation.js` — scaffold everything, but
`classifyAccuracy` is a USER CONTRIBUTION (learning mode): the thresholds and
whether "poor" blocks the flow are a field-operations decision. Scaffold with
a placeholder returning `'good'` and ask before commit:

```js
'use client'

import { useCallback, useState } from 'react'

// USER CONTRIBUTION: classify GPS accuracy for the field workflow.
// Returns 'good' | 'fair' | 'poor' (null when accuracy unknown).
// PRD: warn above 20 m. Decide the tiers and cutoffs.
export function classifyAccuracy(meters) {
  if (meters == null) return null
  return 'good'
}

export function useGeolocation() {
  const [state, setState] = useState({
    loading: false,
    position: null,
    accuracy: null,
    error: null,
  })

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setState({ loading: false, position: null, accuracy: null, error: 'GPS is not supported on this device' })
      return
    }
    setState({ loading: true, position: null, accuracy: null, error: null })
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setState({
          loading: false,
          position: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          accuracy: pos.coords.accuracy,
          error: null,
        }),
      (err) =>
        setState({
          loading: false,
          position: null,
          accuracy: null,
          error: err.code === err.PERMISSION_DENIED ? 'Location permission denied. Enable GPS to add buildings.' : 'Could not get your location. Try again.',
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }, [])

  return { ...state, locate, accuracyLevel: classifyAccuracy(state.accuracy) }
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib frontend/src/hooks && git commit -m "feat(frontend): MapProvider abstraction and geolocation hook"
```

---

### Task 5: Frontend — Leaflet LocationPicker

**Files:**
- Create: `frontend/src/components/map/LocationPicker.js`

**Interfaces:**
- Consumes: `leaflet` package.
- Produces: default-export client component `<LocationPicker latitude longitude onChange />` — renders OSM tiles with one draggable marker; `onChange({ latitude, longitude })` fires on drag end. Consumers MUST load it with `next/dynamic` and `ssr: false`.

- [ ] **Step 1: Install leaflet**

```bash
cd frontend && npm install leaflet
```

- [ ] **Step 2: Implement the picker**

`frontend/src/components/map/LocationPicker.js`:

```js
'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const markerIcon = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;border-radius:9999px;background:#2563eb;border:4px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

export default function LocationPicker({ latitude, longitude, onChange }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)

  useEffect(() => {
    if (mapRef.current) return

    const map = L.map(containerRef.current).setView([latitude, longitude], 18)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    const marker = L.marker([latitude, longitude], { draggable: true, icon: markerIcon }).addTo(map)
    marker.on('dragend', () => {
      const point = marker.getLatLng()
      onChange({ latitude: point.lat, longitude: point.lng })
    })

    mapRef.current = map
    markerRef.current = marker

    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (markerRef.current) markerRef.current.setLatLng([latitude, longitude])
  }, [latitude, longitude])

  return <div ref={containerRef} className="h-64 w-full rounded-xl" />
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend && git commit -m "feat(frontend): Leaflet LocationPicker with draggable marker"
```

---

### Task 6: Frontend — Add Building flow

**Files:**
- Create: `frontend/src/schemas/building.js`
- Create: `frontend/src/hooks/useZones.js`
- Create: `frontend/src/lib/upload.js`
- Create: `frontend/src/components/buildings/LocateStep.js`
- Create: `frontend/src/components/buildings/SearchStep.js`
- Create: `frontend/src/components/buildings/ConfirmLocationStep.js`
- Create: `frontend/src/components/buildings/DetailsForm.js`
- Create: `frontend/src/app/(app)/buildings/add/page.js`

**Interfaces:**
- Consumes: `getMapProvider`, `useGeolocation`, `classifyAccuracy` semantics, `LocationPicker`, `apiClient`, `BUILDING_TYPES`, `Button`, `Input`.
- Produces: `/buildings/add` route implementing the PRD flow. `uploadFile(file) → Promise<url>` in `lib/upload.js`. `buildingDetailsSchema` (Zod) for the form step.

- [ ] **Step 1: Building form schema**

`frontend/src/schemas/building.js`:

```js
import { z } from 'zod'

const optionalPositiveInt = z
  .union([z.literal(''), z.coerce.number().int().positive()])
  .transform((v) => (v === '' ? undefined : v))
  .optional()

const optionalNonNegative = z
  .union([z.literal(''), z.coerce.number().nonnegative()])
  .transform((v) => (v === '' ? undefined : v))
  .optional()

export const buildingDetailsSchema = z.object({
  zoneId: z.string().min(1, 'Select a zone'),
  wings: optionalPositiveInt,
  floors: optionalPositiveInt,
  homePass: optionalNonNegative,
  buildingType: z.string().optional(),
  remarks: z.string().max(1000).optional(),
  amountPaid: optionalNonNegative,
})
```

- [ ] **Step 2: Zones hook and upload helper**

`frontend/src/hooks/useZones.js`:

```js
'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'

export function useZones() {
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    apiClient
      .get('/zones')
      .then((res) => {
        if (!cancelled) setZones(res.data.data)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { zones, loading }
}
```

`frontend/src/lib/upload.js`:

```js
import { apiClient } from '@/lib/api-client'

export async function uploadFile(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await apiClient.post('/uploads', formData)
  return res.data.data.url
}
```

- [ ] **Step 3: Step components**

`frontend/src/components/buildings/LocateStep.js`:

```js
'use client'

import { Button } from '@/components/ui/Button'
import { GPS_ACCURACY_WARN_METERS } from '@/lib/constants'

const LEVEL_STYLES = {
  good: 'bg-green-50 text-green-700',
  fair: 'bg-yellow-50 text-yellow-700',
  poor: 'bg-red-50 text-red-700',
}

export function LocateStep({ geo, onContinue }) {
  const { loading, position, accuracy, accuracyLevel, error, locate } = geo

  return (
    <div className="flex flex-col gap-4">
      <p className="text-gray-600">
        Stand at the building entrance, then capture your GPS location.
      </p>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {position && (
        <div className={`rounded-xl px-4 py-3 text-sm ${LEVEL_STYLES[accuracyLevel] ?? ''}`}>
          <p className="font-medium">GPS accuracy: ±{Math.round(accuracy)} m</p>
          {accuracy > GPS_ACCURACY_WARN_METERS && (
            <p className="mt-1">
              Accuracy is low. Move outdoors or near a window and re-capture if possible.
            </p>
          )}
        </div>
      )}

      <Button onClick={locate} loading={loading} fullWidth variant={position ? 'secondary' : 'primary'}>
        {position ? 'Re-capture Location' : 'Capture My Location'}
      </Button>

      {position && (
        <Button onClick={onContinue} fullWidth>
          Continue
        </Button>
      )}
    </div>
  )
}
```

`frontend/src/components/buildings/SearchStep.js`:

```js
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { getMapProvider } from '@/lib/map-providers'

export function SearchStep({ position, onSelect, onManual }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    try {
      const found = await getMapProvider().searchNearby({ ...position, query: query.trim() })
      setResults(found)
    } catch {
      setError('Search failed. Check your connection and try again.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1">
          <Input
            id="building-search"
            placeholder="Building name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit" loading={searching}>
          Search
        </Button>
      </form>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {results?.length === 0 && (
        <p className="rounded-xl bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          No nearby buildings matched. You can create it manually below.
        </p>
      )}

      {results?.map((candidate) => (
        <button
          key={candidate.placeId}
          onClick={() => onSelect(candidate)}
          className="rounded-xl border border-gray-200 bg-white p-4 text-left active:bg-gray-50"
        >
          <p className="font-semibold text-gray-900">{candidate.name}</p>
          <p className="mt-0.5 text-sm text-gray-500">{candidate.formattedAddress}</p>
        </button>
      ))}

      <Button variant="secondary" fullWidth onClick={onManual}>
        Building not listed — enter manually
      </Button>
    </div>
  )
}
```

`frontend/src/components/buildings/ConfirmLocationStep.js`:

```js
'use client'

import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

const LocationPicker = dynamic(() => import('@/components/map/LocationPicker'), { ssr: false })

export function ConfirmLocationStep({ draft, onDraftChange, onContinue, manual }) {
  return (
    <div className="flex flex-col gap-4">
      {manual && (
        <Input
          id="buildingName"
          label="Building Name"
          value={draft.buildingName}
          onChange={(e) => onDraftChange({ ...draft, buildingName: e.target.value })}
        />
      )}
      {!manual && (
        <div>
          <p className="font-semibold text-gray-900">{draft.buildingName}</p>
          <p className="text-sm text-gray-500">{draft.formattedAddress}</p>
        </div>
      )}

      <p className="text-sm text-gray-600">
        Drag the pin if it is not exactly on the building entrance.
      </p>
      <LocationPicker
        latitude={draft.latitude}
        longitude={draft.longitude}
        onChange={({ latitude, longitude }) => onDraftChange({ ...draft, latitude, longitude })}
      />

      <Button fullWidth onClick={onContinue} disabled={!draft.buildingName}>
        Confirm Location
      </Button>
    </div>
  )
}
```

`frontend/src/components/buildings/DetailsForm.js`:

```js
'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useZones } from '@/hooks/useZones'
import { buildingDetailsSchema } from '@/schemas/building'
import { BUILDING_TYPES } from '@/lib/constants'

function FileField({ id, label, accept, multiple = false, onChange }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => onChange(multiple ? [...e.target.files] : e.target.files[0] ?? null)}
        className="rounded-xl border border-gray-300 bg-white p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:font-medium file:text-blue-700"
      />
    </div>
  )
}

export function DetailsForm({ onSubmit, submitting, serverError }) {
  const { zones, loading: zonesLoading } = useZones()
  const [files, setFiles] = useState({ permissionLetter: null, entrancePhoto: null, additionalPhotos: [] })
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(buildingDetailsSchema) })

  const selectClass =
    'min-h-12 rounded-xl border border-gray-300 bg-white px-4 text-base outline-none focus:ring-2 focus:ring-blue-200'

  return (
    <form onSubmit={handleSubmit((values) => onSubmit(values, files))} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="zoneId" className="text-sm font-medium text-gray-700">Zone</label>
        <select id="zoneId" className={selectClass} {...register('zoneId')} disabled={zonesLoading}>
          <option value="">{zonesLoading ? 'Loading zones…' : 'Select zone'}</option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>{zone.name} — {zone.city}</option>
          ))}
        </select>
        {errors.zoneId && <p className="text-sm text-red-600">{errors.zoneId.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input id="wings" label="Wings" type="number" inputMode="numeric" error={errors.wings?.message} {...register('wings')} />
        <Input id="floors" label="Floors" type="number" inputMode="numeric" error={errors.floors?.message} {...register('floors')} />
      </div>
      <Input id="homePass" label="Home Pass (flats passed)" type="number" inputMode="numeric" error={errors.homePass?.message} {...register('homePass')} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="buildingType" className="text-sm font-medium text-gray-700">Building Type</label>
        <select id="buildingType" className={selectClass} {...register('buildingType')}>
          <option value="">Select type</option>
          {BUILDING_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </div>

      <Input id="amountPaid" label="Amount Paid (permission)" type="number" inputMode="decimal" error={errors.amountPaid?.message} {...register('amountPaid')} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="remarks" className="text-sm font-medium text-gray-700">Remarks</label>
        <textarea id="remarks" rows={3} className="rounded-xl border border-gray-300 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-blue-200" {...register('remarks')} />
      </div>

      <FileField id="permissionLetter" label="Permission Letter (PDF/Image)" accept="application/pdf,image/*" onChange={(f) => setFiles((s) => ({ ...s, permissionLetter: f }))} />
      <FileField id="entrancePhoto" label="Entrance Photo" accept="image/*" onChange={(f) => setFiles((s) => ({ ...s, entrancePhoto: f }))} />
      <FileField id="additionalPhotos" label="Additional Photos" accept="image/*" multiple onChange={(f) => setFiles((s) => ({ ...s, additionalPhotos: f }))} />

      {serverError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{serverError}</p>}

      <Button type="submit" fullWidth loading={submitting}>
        Save Building
      </Button>
    </form>
  )
}
```

- [ ] **Step 4: The flow page**

`frontend/src/app/(app)/buildings/add/page.js`:

```js
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useGeolocation } from '@/hooks/useGeolocation'
import { getMapProvider } from '@/lib/map-providers'
import { apiClient, getApiErrorMessage } from '@/lib/api-client'
import { uploadFile } from '@/lib/upload'
import { LocateStep } from '@/components/buildings/LocateStep'
import { SearchStep } from '@/components/buildings/SearchStep'
import { ConfirmLocationStep } from '@/components/buildings/ConfirmLocationStep'
import { DetailsForm } from '@/components/buildings/DetailsForm'

const STEP_TITLES = {
  locate: 'Capture Location',
  search: 'Find Building',
  confirm: 'Confirm Location',
  details: 'Building Details',
}

export default function AddBuildingPage() {
  const router = useRouter()
  const geo = useGeolocation()
  const [step, setStep] = useState('locate')
  const [manual, setManual] = useState(false)
  const [draft, setDraft] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState(null)

  function handleCandidateSelect(candidate) {
    setManual(false)
    setDraft(candidate)
    setStep('confirm')
  }

  async function handleManual() {
    setManual(true)
    let formattedAddress = ''
    try {
      const reverse = await getMapProvider().reverseGeocode(geo.position)
      formattedAddress = reverse.formattedAddress
    } catch {
      formattedAddress = `${geo.position.latitude.toFixed(6)}, ${geo.position.longitude.toFixed(6)}`
    }
    setDraft({
      placeId: null,
      buildingName: '',
      formattedAddress,
      latitude: geo.position.latitude,
      longitude: geo.position.longitude,
    })
    setStep('confirm')
  }

  async function handleSubmit(values, files) {
    setSubmitting(true)
    setServerError(null)
    try {
      const photos = []
      let documentUrl
      if (files.permissionLetter) {
        documentUrl = await uploadFile(files.permissionLetter)
        photos.push({ type: 'PERMISSION_LETTER', url: documentUrl })
      }
      if (files.entrancePhoto) {
        photos.push({ type: 'ENTRANCE', url: await uploadFile(files.entrancePhoto) })
      }
      for (const file of files.additionalPhotos) {
        photos.push({ type: 'ADDITIONAL', url: await uploadFile(file) })
      }

      const { zoneId, amountPaid, ...details } = values
      const payload = {
        placeId: draft.placeId,
        buildingName: draft.buildingName,
        formattedAddress: draft.formattedAddress,
        latitude: draft.latitude,
        longitude: draft.longitude,
        zoneId,
        details: Object.values(details).some((v) => v !== undefined && v !== '') ? details : undefined,
        permission:
          amountPaid !== undefined || documentUrl ? { amountPaid, documentUrl } : undefined,
        photos: photos.length ? photos : undefined,
      }

      await apiClient.post('/buildings', payload)
      router.replace('/buildings')
    } catch (err) {
      setServerError(getApiErrorMessage(err, 'Could not save the building'))
      setSubmitting(false)
    }
  }

  return (
    <main className="p-6">
      <h1 className="text-xl font-bold text-gray-900">{STEP_TITLES[step]}</h1>
      <div className="mt-6">
        {step === 'locate' && <LocateStep geo={geo} onContinue={() => setStep('search')} />}
        {step === 'search' && (
          <SearchStep position={geo.position} onSelect={handleCandidateSelect} onManual={handleManual} />
        )}
        {step === 'confirm' && (
          <ConfirmLocationStep
            draft={draft}
            onDraftChange={setDraft}
            manual={manual}
            onContinue={() => setStep('details')}
          />
        )}
        {step === 'details' && (
          <DetailsForm onSubmit={handleSubmit} submitting={submitting} serverError={serverError} />
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 5: Verify the flow compiles and renders**

Run both dev servers; open `http://localhost:3000/buildings/add` after login.
Expected: Capture Location screen renders; capturing (requires browser GPS
permission) advances the flow.

- [ ] **Step 6: Commit**

```bash
git add frontend && git commit -m "feat(frontend): four-step Add Building flow"
```

---

### Task 7: Frontend — buildings list with FAB, end-to-end verification

**Files:**
- Modify: `frontend/src/app/(app)/buildings/page.js`
- Create: `frontend/src/components/buildings/BuildingCard.js`
- Create: `frontend/src/components/ui/Fab.js`

**Interfaces:**
- Consumes: `apiClient`, list response `{ id, buildingName, formattedAddress, feasibleStatus, zone: { name }, details?: { homePass } }`.
- Produces: `/buildings` page listing saved buildings with an Add FAB.

- [ ] **Step 1: FAB and card components**

`frontend/src/components/ui/Fab.js`:

```js
'use client'

import Link from 'next/link'

export function Fab({ href, label = 'Add' }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="fixed bottom-24 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-3xl font-light text-white shadow-lg active:bg-blue-700"
    >
      +
    </Link>
  )
}
```

`frontend/src/components/buildings/BuildingCard.js`:

```js
const STATUS_STYLES = {
  FEASIBLE: 'bg-green-50 text-green-700',
  PERMISSION_PENDING: 'bg-yellow-50 text-yellow-700',
  REJECTED: 'bg-red-50 text-red-700',
  SURVEY_PENDING: 'bg-blue-50 text-blue-700',
}

const STATUS_LABELS = {
  FEASIBLE: 'Feasible',
  PERMISSION_PENDING: 'Permission Pending',
  REJECTED: 'Rejected',
  SURVEY_PENDING: 'Survey Pending',
}

export function BuildingCard({ building }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{building.buildingName}</p>
          <p className="mt-0.5 truncate text-sm text-gray-500">{building.formattedAddress}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-0.5 text-xs font-medium ${STATUS_STYLES[building.feasibleStatus]}`}
        >
          {STATUS_LABELS[building.feasibleStatus]}
        </span>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-gray-500">
        <span>{building.zone?.name}</span>
        {building.details?.homePass != null && <span>{building.details.homePass} home pass</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Buildings list page**

Replace `frontend/src/app/(app)/buildings/page.js`:

```js
'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { BuildingCard } from '@/components/buildings/BuildingCard'
import { Fab } from '@/components/ui/Fab'

export default function BuildingsPage() {
  const [buildings, setBuildings] = useState(null)

  useEffect(() => {
    apiClient.get('/buildings').then((res) => setBuildings(res.data.data))
  }, [])

  return (
    <main className="p-6">
      <h1 className="text-xl font-bold text-gray-900">Buildings</h1>

      <div className="mt-4 flex flex-col gap-3">
        {buildings === null && <p className="text-gray-500">Loading…</p>}
        {buildings?.length === 0 && (
          <p className="text-gray-500">No buildings yet. Tap + to add the first one.</p>
        )}
        {buildings?.map((building) => (
          <BuildingCard key={building.id} building={building} />
        ))}
      </div>

      <Fab href="/buildings/add" label="Add Building" />
    </main>
  )
}
```

- [ ] **Step 3: End-to-end verification**

1. `cd backend && npx vitest run` — all tests pass.
2. Both dev servers up; create a building via curl (simulating the flow):

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@isp.local","password":"ChangeMe123!"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.token))")
ZONE=$(curl -s http://localhost:4000/api/v1/zones -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data[0].id))")
curl -s -X POST http://localhost:4000/api/v1/buildings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"placeId\":\"way:42\",\"buildingName\":\"Test Towers\",\"formattedAddress\":\"1 Test Rd\",\"latitude\":19.076,\"longitude\":72.8777,\"zoneId\":\"$ZONE\",\"details\":{\"floors\":12,\"homePass\":48}}"
```

Expected: `201` with nested `details`, `zone`, `createdBy`. Duplicate placeId retry → `409`.
3. `http://localhost:3000/buildings` shows the card; FAB opens `/buildings/add`.

- [ ] **Step 4: Commit**

```bash
git add frontend && git commit -m "feat(frontend): buildings list with add FAB"
```
