# Phase 3 – Duplicate Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before a surveyor fills the form, the app searches its own database within a configurable radius (default 100 m) and shows a "Possible Existing Building" warning with open-existing / continue-anyway options.

**Architecture:** Geo math (haversine + bounding box) lives in `backend/src/lib/geo.js`; name similarity in `backend/src/lib/name-similarity.js` (user-defined heuristic). The buildings service gains `findNearby`; a new `GET /buildings/nearby` route (declared BEFORE `/:id`) exposes it. The frontend add-flow gains a duplicate-check step after Confirm Location, plus a minimal `/buildings/[id]` detail page as the "open existing" target.

**Tech Stack:** Existing stack; no new dependencies.

## Global Constraints

- JavaScript only; backend ESM with `.js` imports; envelope `{ success, data }` / `{ success, error }`.
- Duplicate radius default **100 m**, configurable via `DUPLICATE_RADIUS_METERS` env (PRD: "configurable radius (default 100 m)").
- Route ordering: `/buildings/nearby` MUST be registered before `/buildings/:id`.
- Express 5: `req.query` is a getter — validated query params go on `req.validatedQuery`, never assigned to `req.query`.
- Nearby result item shape: building fields + `distanceMeters` (integer), `samePlaceId` (boolean), `similarName` (boolean); sorted ascending by `distanceMeters`.
- Commit after every task.

---

### Task 1: Backend — geo utilities

**Files:**
- Create: `backend/src/lib/geo.js`
- Test: `backend/tests/geo.test.js`

**Interfaces:**
- Produces: `haversineMeters(lat1, lon1, lat2, lon2) → number` (meters). `boundingBox(latitude, longitude, radiusMeters) → { minLat, maxLat, minLon, maxLon }`.

- [ ] **Step 1: Write the failing test**

`backend/tests/geo.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { haversineMeters, boundingBox } from '../src/lib/geo.js'

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(19.076, 72.8777, 19.076, 72.8777)).toBe(0)
  })

  it('measures ~111 m for 0.001° latitude difference', () => {
    const d = haversineMeters(19.076, 72.8777, 19.077, 72.8777)
    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(118)
  })

  it('matches a known city-scale distance (Mumbai CST → Gateway ≈ 2.4 km)', () => {
    const d = haversineMeters(18.9398, 72.8355, 18.922, 72.8347)
    expect(d).toBeGreaterThan(1900)
    expect(d).toBeLessThan(2100)
  })
})

describe('boundingBox', () => {
  it('spans ~2×radius vertically', () => {
    const box = boundingBox(19.076, 72.8777, 100)
    const height = haversineMeters(box.minLat, 72.8777, box.maxLat, 72.8777)
    expect(height).toBeGreaterThan(190)
    expect(height).toBeLessThan(210)
  })

  it('contains points inside the radius and excludes far ones', () => {
    const box = boundingBox(19.076, 72.8777, 100)
    expect(19.0765).toBeGreaterThan(box.minLat)
    expect(19.0765).toBeLessThan(box.maxLat)
    expect(box.maxLat).toBeLessThan(19.078) // 100 m ≈ 0.0009°, not 0.002°
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/geo.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement**

`backend/src/lib/geo.js`:

```js
const EARTH_RADIUS_METERS = 6371000
const METERS_PER_DEGREE_LAT = 111320

const toRadians = (degrees) => (degrees * Math.PI) / 180

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a))
}

export function boundingBox(latitude, longitude, radiusMeters) {
  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT
  const lonDelta = radiusMeters / (METERS_PER_DEGREE_LAT * Math.cos(toRadians(latitude)))
  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLon: longitude - lonDelta,
    maxLon: longitude + lonDelta,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/geo.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend && git commit -m "feat(backend): haversine and bounding-box geo utilities"
```

---

### Task 2: Backend — name similarity heuristic (user contribution)

**Files:**
- Create: `backend/src/lib/name-similarity.js`
- Test: `backend/tests/name-similarity.test.js`

**Interfaces:**
- Produces: `isSimilarName(a, b) → boolean`. Case/punctuation-insensitive; catches abbreviation and typo variants per the tests.

- [ ] **Step 1: Write the contract test first**

`backend/tests/name-similarity.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { isSimilarName } from '../src/lib/name-similarity.js'

describe('isSimilarName', () => {
  it.each([
    ['Sunrise Apartments', 'Sunrise Apartments'],
    ['Sunrise Apartments', 'sunrise apartments'],
    ['Sunrise Apartments', 'Sunrise Apartment'],
    ['Sunrise Apartments', 'Apartments Sunrise'],
    ['Sea View Tower', 'Sea-View Tower'],
    ['Sunrise Apartments', 'Sunrize Apartments'],
  ])('flags "%s" vs "%s" as similar', (a, b) => {
    expect(isSimilarName(a, b)).toBe(true)
  })

  it.each([
    ['Sunrise Apartments', 'Moonlight Residency'],
    ['Sea View Tower', 'Hill Crest Villa'],
    ['Block A', 'Sunrise Apartments'],
  ])('does NOT flag "%s" vs "%s"', (a, b) => {
    expect(isSimilarName(a, b)).toBe(false)
  })
})
```

- [ ] **Step 2: PAUSE — user chooses the heuristic** (learning mode). Options: token-overlap (Jaccard), Levenshtein ratio on normalized strings, or hybrid (token-sort + Levenshtein). Implement whichever they pick, run the contract tests, iterate until green.

- [ ] **Step 3: Run tests until they pass**

Run: `cd backend && npx vitest run tests/name-similarity.test.js`
Expected: PASS (all pairs)

- [ ] **Step 4: Commit**

```bash
git add backend && git commit -m "feat(backend): name-similarity heuristic for duplicate detection"
```

---

### Task 3: Backend — nearby endpoint

**Files:**
- Create: `backend/src/middleware/validate.js` (add `validateQuery`)
- Modify: `backend/src/config/env.js` (add `duplicateRadiusMeters`)
- Modify: `backend/src/modules/buildings/building.repository.js`
- Modify: `backend/src/modules/buildings/building.service.js`
- Modify: `backend/src/modules/buildings/building.schemas.js`
- Modify: `backend/src/modules/buildings/building.controller.js`
- Modify: `backend/src/modules/buildings/building.routes.js`
- Test: `backend/tests/building-nearby.service.test.js`

**Interfaces:**
- Consumes: `haversineMeters`, `boundingBox`, `isSimilarName`, `env`.
- Produces: service `findNearby({ latitude, longitude, radiusMeters, name?, placeId? }) → [{ …building, distanceMeters, samePlaceId, similarName }]` sorted by distance. Repository `findWithinBounds(box)`, `findByPlaceId(placeId)`. Route `GET /api/v1/buildings/nearby?latitude&longitude&radius&name&placeId` (before `/:id`). `validateQuery(schema)` → `req.validatedQuery`.

- [ ] **Step 1: Write the failing service test**

`backend/tests/building-nearby.service.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

const near = { id: 'b1', placeId: 'way:1', buildingName: 'Sunrise Apartments', latitude: 19.0761, longitude: 72.8777 }
const far = { id: 'b2', placeId: 'way:2', buildingName: 'Distant Tower', latitude: 19.09, longitude: 72.9 }

function fakeRepo(buildings) {
  return {
    findWithinBounds: async (box) =>
      buildings.filter(
        (b) =>
          b.latitude >= box.minLat &&
          b.latitude <= box.maxLat &&
          b.longitude >= box.minLon &&
          b.longitude <= box.maxLon,
      ),
    findByPlaceId: async (placeId) => buildings.find((b) => b.placeId === placeId) ?? null,
  }
}

describe('building service findNearby', () => {
  it('returns buildings within radius with integer distance, sorted ascending', async () => {
    const service = createBuildingService({ buildingRepository: fakeRepo([near, far]) })
    const results = await service.findNearby({ latitude: 19.076, longitude: 72.8777, radiusMeters: 100 })
    expect(results.map((r) => r.id)).toEqual(['b1'])
    expect(results[0].distanceMeters).toBeGreaterThan(0)
    expect(results[0].distanceMeters).toBeLessThan(50)
    expect(Number.isInteger(results[0].distanceMeters)).toBe(true)
  })

  it('flags similar names', async () => {
    const service = createBuildingService({ buildingRepository: fakeRepo([near]) })
    const results = await service.findNearby({
      latitude: 19.076,
      longitude: 72.8777,
      radiusMeters: 100,
      name: 'Sunrise Apartment',
    })
    expect(results[0].similarName).toBe(true)
  })

  it('flags an exact placeId match even outside the radius', async () => {
    const service = createBuildingService({ buildingRepository: fakeRepo([far]) })
    const results = await service.findNearby({
      latitude: 19.076,
      longitude: 72.8777,
      radiusMeters: 100,
      placeId: 'way:2',
    })
    expect(results).toHaveLength(1)
    expect(results[0].samePlaceId).toBe(true)
  })

  it('returns empty array when nothing is close', async () => {
    const service = createBuildingService({ buildingRepository: fakeRepo([far]) })
    const results = await service.findNearby({ latitude: 19.076, longitude: 72.8777, radiusMeters: 100 })
    expect(results).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/building-nearby.service.test.js`
Expected: FAIL — `findNearby` is not a function

- [ ] **Step 3: Implement**

Append to `backend/src/middleware/validate.js`:

```js
export const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query)
  if (!result.success) return next(result.error)
  req.validatedQuery = result.data
  next()
}
```

Add to `env` in `backend/src/config/env.js`:

```js
  duplicateRadiusMeters: Number(process.env.DUPLICATE_RADIUS_METERS ?? 100),
```

Add to `buildingRepository` in `building.repository.js`:

```js
  findWithinBounds: ({ minLat, maxLat, minLon, maxLon }) =>
    prisma.building.findMany({
      where: {
        latitude: { gte: minLat, lte: maxLat },
        longitude: { gte: minLon, lte: maxLon },
      },
      include: { zone: true, details: true },
    }),
  findByPlaceId: (placeId) =>
    prisma.building.findUnique({ where: { placeId }, include: { zone: true, details: true } }),
```

Add to the service object in `building.service.js` (import `haversineMeters`, `boundingBox` from `../../lib/geo.js` and `isSimilarName` from `../../lib/name-similarity.js`):

```js
    async findNearby({ latitude, longitude, radiusMeters, name, placeId }) {
      const box = boundingBox(latitude, longitude, radiusMeters)
      const candidates = await buildingRepository.findWithinBounds(box)

      const withinRadius = candidates
        .map((building) => ({
          ...building,
          distanceMeters: Math.round(
            haversineMeters(latitude, longitude, building.latitude, building.longitude),
          ),
        }))
        .filter((building) => building.distanceMeters <= radiusMeters)

      if (placeId && !withinRadius.some((b) => b.placeId === placeId)) {
        const exact = await buildingRepository.findByPlaceId(placeId)
        if (exact) {
          withinRadius.push({
            ...exact,
            distanceMeters: Math.round(
              haversineMeters(latitude, longitude, exact.latitude, exact.longitude),
            ),
          })
        }
      }

      return withinRadius
        .map((building) => ({
          ...building,
          samePlaceId: Boolean(placeId) && building.placeId === placeId,
          similarName: name ? isSimilarName(name, building.buildingName) : false,
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
    },
```

Add to `building.schemas.js`:

```js
export const nearbyQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().positive().max(5000).optional(),
  name: z.string().optional(),
  placeId: z.string().optional(),
})
```

Add to `building.controller.js` (import `env`):

```js
  async nearby(req, res, next) {
    try {
      const { latitude, longitude, radius, name, placeId } = req.validatedQuery
      const buildings = await buildingService.findNearby({
        latitude,
        longitude,
        radiusMeters: radius ?? env.duplicateRadiusMeters,
        name,
        placeId,
      })
      res.json({ success: true, data: buildings })
    } catch (err) {
      next(err)
    }
  },
```

In `building.routes.js` add BEFORE the `/:id` route (import `validateQuery`, `nearbyQuerySchema`):

```js
buildingRoutes.get('/nearby', validateQuery(nearbyQuerySchema), buildingController.nearby)
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd backend && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend && git commit -m "feat(backend): nearby-buildings duplicate search endpoint"
```

---

### Task 4: Frontend — duplicate warning step in the add flow

**Files:**
- Create: `frontend/src/components/buildings/DuplicateWarningStep.js`
- Modify: `frontend/src/app/(app)/buildings/add/page.js`

**Interfaces:**
- Consumes: `GET /buildings/nearby` response items `{ id, buildingName, formattedAddress, feasibleStatus, distanceMeters, samePlaceId, similarName, zone }`, `apiClient`, `Button`.
- Produces: flow step `duplicate` between `confirm` and `details`; skipped when no candidates.

- [ ] **Step 1: Duplicate warning component**

`frontend/src/components/buildings/DuplicateWarningStep.js`:

```js
'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

export function DuplicateWarningStep({ candidates, onContinue, onBack }) {
  const router = useRouter()
  const hasExactMatch = candidates.some((c) => c.samePlaceId)

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-yellow-50 px-4 py-3">
        <p className="font-semibold text-yellow-800">Possible existing building</p>
        <p className="mt-1 text-sm text-yellow-700">
          {hasExactMatch
            ? 'This exact place is already registered.'
            : `Found ${candidates.length} building(s) nearby. Check before creating a duplicate.`}
        </p>
      </div>

      {candidates.map((candidate) => (
        <button
          key={candidate.id}
          onClick={() => router.push(`/buildings/${candidate.id}`)}
          className="rounded-xl border border-gray-200 bg-white p-4 text-left active:bg-gray-50"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-gray-900">{candidate.buildingName}</p>
            <span className="shrink-0 text-xs font-medium text-gray-500">
              {candidate.distanceMeters} m away
            </span>
          </div>
          <p className="mt-0.5 text-sm text-gray-500">{candidate.formattedAddress}</p>
          <div className="mt-2 flex gap-2">
            {candidate.samePlaceId && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                Same place ID
              </span>
            )}
            {candidate.similarName && (
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                Similar name
              </span>
            )}
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              Open existing →
            </span>
          </div>
        </button>
      ))}

      {!hasExactMatch && (
        <Button variant="secondary" fullWidth onClick={onContinue}>
          This is a different building — continue
        </Button>
      )}
      <Button variant="danger" fullWidth onClick={onBack}>
        Go back
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Wire the check into the flow page**

In `frontend/src/app/(app)/buildings/add/page.js`: add state
`const [duplicates, setDuplicates] = useState([])` and `checkingDuplicates`;
add `'duplicate'` to `STEP_TITLES` as `'Possible Duplicate'`. Replace the
`ConfirmLocationStep` `onContinue` with:

```js
  async function handleLocationConfirmed() {
    setCheckingDuplicates(true)
    try {
      const params = {
        latitude: draft.latitude,
        longitude: draft.longitude,
        name: draft.buildingName,
      }
      if (draft.placeId) params.placeId = draft.placeId
      const res = await apiClient.get('/buildings/nearby', { params })
      const found = res.data.data
      if (found.length > 0) {
        setDuplicates(found)
        setStep('duplicate')
      } else {
        setStep('details')
      }
    } catch {
      // Duplicate check is best-effort: server placeId constraint still protects.
      setStep('details')
    } finally {
      setCheckingDuplicates(false)
    }
  }
```

and render the step:

```js
        {step === 'duplicate' && (
          <DuplicateWarningStep
            candidates={duplicates}
            onContinue={() => setStep('details')}
            onBack={() => setStep('search')}
          />
        )}
```

Pass `onContinue={handleLocationConfirmed}` to `ConfirmLocationStep` and its
button `loading={checkingDuplicates}` via a new `busy` prop.

- [ ] **Step 3: Commit**

```bash
git add frontend && git commit -m "feat(frontend): duplicate warning step in add-building flow"
```

---

### Task 5: Frontend — building detail page

**Files:**
- Create: `frontend/src/app/(app)/buildings/[id]/page.js`

**Interfaces:**
- Consumes: `GET /buildings/:id` full include (zone, details, permission, photos, createdBy).
- Produces: `/buildings/[id]` detail view — the "Open existing" target.

- [ ] **Step 1: Implement the page**

`frontend/src/app/(app)/buildings/[id]/page.js`:

```js
'use client'

import { use, useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'

function Row({ label, value }) {
  if (value == null || value === '') return null
  return (
    <div className="flex justify-between gap-4 py-2">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}

const STATUS_LABELS = {
  FEASIBLE: 'Feasible',
  PERMISSION_PENDING: 'Permission Pending',
  REJECTED: 'Rejected',
  SURVEY_PENDING: 'Survey Pending',
}

export default function BuildingDetailPage({ params }) {
  const { id } = use(params)
  const [building, setBuilding] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiClient
      .get(`/buildings/${id}`)
      .then((res) => setBuilding(res.data.data))
      .catch(() => setError('Building not found'))
  }, [id])

  if (error) return <main className="p-6 text-gray-500">{error}</main>
  if (!building) return <main className="p-6 text-gray-500">Loading…</main>

  return (
    <main className="p-6">
      <h1 className="text-xl font-bold text-gray-900">{building.buildingName}</h1>
      <p className="mt-1 text-sm text-gray-500">{building.formattedAddress}</p>

      <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <Row label="Status" value={STATUS_LABELS[building.feasibleStatus]} />
        <Row label="Zone" value={building.zone?.name} />
        <Row label="Wings" value={building.details?.wings} />
        <Row label="Floors" value={building.details?.floors} />
        <Row label="Home Pass" value={building.details?.homePass} />
        <Row label="Type" value={building.details?.buildingType} />
        <Row label="Amount Paid" value={building.permission?.amountPaid} />
        <Row label="Added by" value={building.createdBy?.name} />
      </div>

      {building.photos?.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {building.photos.map((photo) => (
            <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer">
              {photo.url.endsWith('.pdf') ? (
                <span className="flex h-32 items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-600">
                  📄 {photo.type === 'PERMISSION_LETTER' ? 'Permission Letter' : 'Document'}
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt={photo.type} className="h-32 w-full rounded-xl object-cover" />
              )}
            </a>
          ))}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend && git commit -m "feat(frontend): building detail page"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npx vitest run` — Expected: PASS.

- [ ] **Step 2: API-level duplicate scenarios** (servers running)

```bash
# near Test Towers (19.076, 72.8777) → expect the building with distance + flags
curl -s "http://localhost:4000/api/v1/buildings/nearby?latitude=19.0761&longitude=72.8777&name=Test%20Tower" -H "Authorization: Bearer $TOKEN"
# 200 m away → expect []
curl -s "http://localhost:4000/api/v1/buildings/nearby?latitude=19.078&longitude=72.8777" -H "Authorization: Bearer $TOKEN"
# same placeId from far away → expect samePlaceId: true
curl -s "http://localhost:4000/api/v1/buildings/nearby?latitude=19.2&longitude=72.9&placeId=way:42" -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 3: Frontend routes compile** — `/buildings/add`, `/buildings/<id>` return 200.

- [ ] **Step 4: Commit any fixes, then finish the branch**
