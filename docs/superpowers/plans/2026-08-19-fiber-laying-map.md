# Fiber Laying Map (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw branching fiber routes point-by-point on the map (trunk + splits), save them as named colored routes, manage them in Admin → Fiber routes, and show them on `/map` behind a "Fiber" legend toggle.

**Architecture:** New `FiberRoute` model (`name`, `color`, `segments` JSON = array of polylines; a branch is a segment starting at another segment's vertex) with a zones-style CRUD module (ADMIN+MANAGER writes, audit-logged). `GoogleFiberEditor` clones the boundary editor's proven machinery (Pan/Draw modes, DOM-click + projection, MVCArray paths, save panel, lazy overlays) but manages **multiple editable Polylines** with a "New line" action whose first point snaps (~12 px) to any existing vertex. `/map` gains a lazy fiber layer + legend row.

**Tech Stack:** Prisma 6 / Express 5 (plain JS), zod, vitest + supertest; Google Maps JS Polylines, Next.js client components.

**Spec:** `fiber-laying-map.md` (repo root; decisions confirmed 2026-08-19)

## Global Constraints

- Backend plain JavaScript; no new npm dependencies anywhere.
- Writes gated ADMIN + MANAGER (same as zones); reads all authenticated roles.
- Validation: 1–50 segments per route, 2–200 points per segment; route names unique (409).
- Maps JS v3.65 gotchas apply: never use the map `click` event (DOM clicks + projection); polylines get explicit `MVCArray` paths.
- `/map` fiber layer is lazy: no fetch until the legend toggle is on; default off.
- Frontend verification = lint + build + Playwright against `npx next start -p 3477` (never the user's dev server). Pre-existing lint errors in `SearchStep.js`, `AuthGuard.js`, `useBuildings.js` are not ours.

---

### Task 1: Backend — FiberRoute model + CRUD module

**Files:**
- Modify: `backend/prisma/schema.prisma` (add model after `Zone`)
- Create: migration via `prisma migrate dev --name fiber_routes` (generated SQL is fine as-is — new table only)
- Create: `backend/src/modules/fiber-routes/fiber-route.repository.js`, `fiber-route.schemas.js`, `fiber-route.service.js`, `fiber-route.controller.js`, `fiber-route.routes.js`
- Modify: `backend/src/app.js` (mount)
- Test: `backend/tests/fiber-route.service.test.js`, `backend/tests/fiber-routes.route.test.js`

**Interfaces:**
- Produces: `GET/POST /api/v1/fiber-routes`, `PATCH/DELETE /api/v1/fiber-routes/:id`; route shape `{ id, name, color, segments: [[{latitude, longitude}, …], …] }`; list returns an array ordered by name. Tasks 2–4 consume this API.

- [ ] **Step 1: Schema + migration**

Append to `schema.prisma` after the `Zone` model:

```prisma
model FiberRoute {
  id        String   @id @default(cuid())
  name      String   @unique
  /// Hex render color; a typed palette maps onto this later (phase 2).
  color     String   @default("#f59e0b")
  /// Ordered polylines: [ [ {latitude, longitude}, ... ], ... ].
  /// A branch is a segment whose first point sits on another segment's vertex.
  segments  Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Run: `cd backend && npx prisma migrate dev --name fiber_routes` (new table only — no data concerns).

- [ ] **Step 2: Failing service tests**

`backend/tests/fiber-route.service.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { createFiberRouteService } from '../src/modules/fiber-routes/fiber-route.service.js'
import { createFiberRouteSchema } from '../src/modules/fiber-routes/fiber-route.schemas.js'

const SEGMENTS = [
  [
    { latitude: 18.59, longitude: 73.74 },
    { latitude: 18.6, longitude: 73.75 },
  ],
  [
    { latitude: 18.6, longitude: 73.75 },
    { latitude: 18.61, longitude: 73.74 },
  ],
]

describe('fiber route schema', () => {
  it('accepts trunk + branch segments and defaults color', () => {
    const parsed = createFiberRouteSchema.safeParse({ name: 'Wakad trunk', segments: SEGMENTS })
    expect(parsed.success).toBe(true)
  })

  it('rejects a 1-point segment, empty segments, and bad colors', () => {
    expect(
      createFiberRouteSchema.safeParse({
        name: 'X',
        segments: [[{ latitude: 1, longitude: 1 }]],
      }).success,
    ).toBe(false)
    expect(createFiberRouteSchema.safeParse({ name: 'X', segments: [] }).success).toBe(false)
    expect(
      createFiberRouteSchema.safeParse({ name: 'X', segments: SEGMENTS, color: 'red' }).success,
    ).toBe(false)
  })
})

function fakeRepo({ existing = null, route = { id: 'f1', name: 'Trunk' } } = {}) {
  return {
    list: vi.fn(async () => [route]),
    findById: vi.fn(async (id) => (id === route.id ? route : null)),
    findByName: vi.fn(async () => existing),
    create: vi.fn(async (data) => ({ id: 'new', ...data })),
    update: vi.fn(async (id, data) => ({ ...route, ...data })),
    delete: vi.fn(async () => {}),
  }
}

describe('fiber route service', () => {
  it('creates a route', async () => {
    const repo = fakeRepo()
    const service = createFiberRouteService({ fiberRouteRepository: repo })
    const created = await service.createFiberRoute({ name: 'Trunk 2', segments: SEGMENTS })
    expect(repo.create).toHaveBeenCalledWith({ name: 'Trunk 2', segments: SEGMENTS })
    expect(created.id).toBe('new')
  })

  it('409s a duplicate name; renaming onto another route also 409s', async () => {
    const clash = fakeRepo({ existing: { id: 'OTHER', name: 'trunk' } })
    const service = createFiberRouteService({ fiberRouteRepository: clash })
    await expect(service.createFiberRoute({ name: 'Trunk', segments: SEGMENTS })).rejects.toMatchObject({ status: 409 })
    await expect(service.updateFiberRoute('f1', { name: 'Trunk' })).rejects.toMatchObject({ status: 409 })
  })

  it('404s update/delete of unknown routes; delete works on known ones', async () => {
    const repo = fakeRepo()
    const service = createFiberRouteService({ fiberRouteRepository: repo })
    await expect(service.updateFiberRoute('nope', { name: 'X' })).rejects.toMatchObject({ status: 404 })
    await expect(service.deleteFiberRoute('nope')).rejects.toMatchObject({ status: 404 })
    await service.deleteFiberRoute('f1')
    expect(repo.delete).toHaveBeenCalledWith('f1')
  })
})
```

Run to verify FAIL (module not found), then implement.

- [ ] **Step 3: Implement the module**

`fiber-route.schemas.js`:

```js
import { z } from 'zod'

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

// Each segment is one polyline; a branch starts at another segment's vertex.
const segmentSchema = z.array(pointSchema).min(2).max(200)

export const createFiberRouteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  segments: z.array(segmentSchema).min(1).max(50),
})

export const updateFiberRouteSchema = createFiberRouteSchema.partial()
```

`fiber-route.repository.js`:

```js
import { prisma } from '../../lib/prisma.js'

export const fiberRouteRepository = {
  list: () => prisma.fiberRoute.findMany({ orderBy: { name: 'asc' } }),
  findById: (id) => prisma.fiberRoute.findUnique({ where: { id } }),
  findByName: (name) =>
    prisma.fiberRoute.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } }),
  create: (data) => prisma.fiberRoute.create({ data }),
  update: (id, data) => prisma.fiberRoute.update({ where: { id }, data }),
  delete: (id) => prisma.fiberRoute.delete({ where: { id } }),
}
```

`fiber-route.service.js`:

```js
import { ApiError } from '../../lib/api-error.js'
import { fiberRouteRepository } from './fiber-route.repository.js'

export function createFiberRouteService(deps) {
  const { fiberRouteRepository } = deps

  async function assertNameFree(name, selfId) {
    const clash = await fiberRouteRepository.findByName(name)
    if (clash && clash.id !== selfId) {
      throw ApiError.conflict('A fiber route with this name already exists')
    }
  }

  return {
    async listFiberRoutes() {
      return fiberRouteRepository.list()
    },

    async createFiberRoute(data) {
      await assertNameFree(data.name)
      return fiberRouteRepository.create(data)
    },

    async updateFiberRoute(id, data) {
      const route = await fiberRouteRepository.findById(id)
      if (!route) throw ApiError.notFound('Fiber route not found')
      if (data.name) await assertNameFree(data.name, id)
      return fiberRouteRepository.update(id, data)
    },

    async deleteFiberRoute(id) {
      const route = await fiberRouteRepository.findById(id)
      if (!route) throw ApiError.notFound('Fiber route not found')
      await fiberRouteRepository.delete(id)
    },
  }
}

export const fiberRouteService = createFiberRouteService({ fiberRouteRepository })
```

`fiber-route.controller.js`:

```js
import { fiberRouteService } from './fiber-route.service.js'

export const fiberRouteController = {
  async list(req, res, next) {
    try {
      res.json({ success: true, data: await fiberRouteService.listFiberRoutes() })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const route = await fiberRouteService.createFiberRoute(req.body)
      res.status(201).json({ success: true, data: route })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      res.json({
        success: true,
        data: await fiberRouteService.updateFiberRoute(req.params.id, req.body),
      })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await fiberRouteService.deleteFiberRoute(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },
}
```

`fiber-route.routes.js`:

```js
import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { fiberRouteRepository } from './fiber-route.repository.js'
import { createFiberRouteSchema, updateFiberRouteSchema } from './fiber-route.schemas.js'
import { fiberRouteController } from './fiber-route.controller.js'

export const fiberRouteRoutes = Router()

fiberRouteRoutes.use(requireAuth)
fiberRouteRoutes.get('/', fiberRouteController.list)
fiberRouteRoutes.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  audit('FiberRoute', 'Create', {
    describe: (req) => `Fiber route '${req.body?.name ?? 'unknown'}' created`,
  }),
  validateBody(createFiberRouteSchema),
  fiberRouteController.create,
)
fiberRouteRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('FiberRoute', 'Update', {
    load: (req) => fiberRouteRepository.findById(req.params.id),
    describe: (req, old) => `Fiber route '${old?.name ?? req.params.id}' updated`,
  }),
  validateBody(updateFiberRouteSchema),
  fiberRouteController.update,
)
fiberRouteRoutes.delete(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('FiberRoute', 'Delete', {
    load: (req) => fiberRouteRepository.findById(req.params.id),
    describe: (req, old) => `Fiber route '${old?.name ?? req.params.id}' deleted`,
  }),
  fiberRouteController.remove,
)
```

`app.js`: import `fiberRouteRoutes` and `app.use('/api/v1/fiber-routes', fiberRouteRoutes)` after the cities mount.

- [ ] **Step 4: Route tests**

`backend/tests/fiber-routes.route.test.js`:

```js
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

const SEGMENTS = [
  [
    { latitude: 18.59, longitude: 73.74 },
    { latitude: 18.6, longitude: 73.75 },
  ],
]

describe('fiber routes API', () => {
  it('lists for any authenticated role; requires auth', async () => {
    const ok = await request(createApp())
      .get('/api/v1/fiber-routes')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(ok.status).toBe(200)
    expect(Array.isArray(ok.body.data)).toBe(true)
    expect((await request(createApp()).get('/api/v1/fiber-routes')).status).toBe(401)
  })

  it('blocks SURVEYOR writes', async () => {
    const res = await request(createApp())
      .post('/api/v1/fiber-routes')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
      .send({ name: 'Nope', segments: SEGMENTS })
    expect(res.status).toBe(403)
  })

  it('MANAGER round-trip: create → duplicate 409 → update → delete', async () => {
    const stamp = Date.now()
    const app = createApp()
    const auth = ['Authorization', `Bearer ${tokenFor('MANAGER')}`]

    const created = await request(app)
      .post('/api/v1/fiber-routes')
      .set(...auth)
      .send({ name: `FiberTest-${stamp}`, segments: SEGMENTS, color: '#dc2626' })
    expect(created.status).toBe(201)
    expect(created.body.data.color).toBe('#dc2626')
    const id = created.body.data.id

    const dup = await request(app)
      .post('/api/v1/fiber-routes')
      .set(...auth)
      .send({ name: `fibertest-${stamp}`, segments: SEGMENTS })
    expect(dup.status).toBe(409)

    const updated = await request(app)
      .patch(`/api/v1/fiber-routes/${id}`)
      .set(...auth)
      .send({ segments: [...SEGMENTS, [SEGMENTS[0][1], { latitude: 18.61, longitude: 73.73 }]] })
    expect(updated.status).toBe(200)
    expect(updated.body.data.segments).toHaveLength(2)

    const del = await request(app).delete(`/api/v1/fiber-routes/${id}`).set(...auth)
    expect(del.status).toBe(200)
  })
})
```

- [ ] **Step 5: Run new tests + full suite; commit**

`npx vitest run tests/fiber-route.service.test.js tests/fiber-routes.route.test.js` → pass; `npx vitest run` → all pass.

```bash
cd backend
git add prisma src/modules/fiber-routes src/app.js tests/fiber-route.service.test.js tests/fiber-routes.route.test.js
git commit -m "feat: FiberRoute model and CRUD API (admin+manager, audited)"
```

---

### Task 2: `GoogleFiberEditor` component

**Files:**
- Create: `frontend/src/components/map/google/GoogleFiberEditor.js`

**Interfaces:**
- Consumes: the fiber API from Task 1; all shared libs the boundary editor uses (`loadGoogleMaps`, provider search, `buildingDotIcon`/`clusterRenderer`, `zoneColor`, `useMapLayer`, prefs pattern).
- Produces (Task 3 relies on this contract):

```js
export default function GoogleFiberEditor({
  initialRoute,   // { id, name, color, segments } | undefined (new route)
  onClose,        // () => void
  onSaved,        // () => void — after a successful API save
})
```

- [ ] **Step 1: Write the component**

Clone the structure of `GoogleBoundaryMapEditor.js` (same file layout: prefs helpers, init effect with projection + DOM listeners, mode effect, lazy buildings/zones overlays, search, save panel, header/controls JSX, mobile classes) with these deltas — the full working file is authored during execution from the boundary editor as the reference, with every delta below applied:

**Constants / props:**
- `MAX_SEGMENT_POINTS = 200`, `MAX_SEGMENTS = 50`, `SNAP_PX = 12`.
- `SWATCHES = ['#f59e0b', '#dc2626', '#2563eb', '#10b981', '#a855f7', '#ec4899', '#f97316', '#0f172a']` (amber default first).
- Pref keys: `fiber-buildings-shown` (default false), `fiber-zones-shown` (default false — zones are less essential here), layer pref `useMapLayer('fiber', 'hybrid')`.

**Multi-segment state (replaces single polygon/path):**

```js
const segmentsRef = useRef([]) // [{ path: MVCArray, polyline: Polyline }]
const activeRef = useRef(-1)   // index of the segment taps append to
const vertexMarkersRef = useRef([])
const [counts, setCounts] = useState({ segments: 0, points: 0 })
const [color, setColor] = useState(initialRoute?.color ?? SWATCHES[0])
const colorRef = useRef(color)
```

- `addSegment(points)` creates an explicit `MVCArray` of `LatLng` + an editable `Polyline({ map, path, strokeColor: colorRef.current, strokeWeight: 3, zIndex: 10 })`, wires `insert_at/remove_at/set_at` → `sync()`, wires polyline `rightclick` vertex removal, pushes to `segmentsRef`, sets `activeRef` to its index.
- On init: `initialRoute?.segments?.forEach(s => addSegment(s))`; if none, `addSegment([])` so the first tap starts the trunk. Fit bounds over all initial points when present.
- `sync()` recomputes counts (`setCounts`) and rebuilds plain vertex dots (scale 4.5 white-stroked circles in `colorRef.current`; the ACTIVE segment's LAST vertex gets scale 7 — that's where the line grows from). Junction rendering falls out naturally: shared vertices overlap.
- **Draw click:** appends to the active segment. If the active segment is EMPTY, snap: project every vertex of every other segment via `projection.fromLatLngToContainerPixel`, use the nearest within `SNAP_PX` of the click, else the raw click point (a route may also start free-standing).
- **Rubber band** follows the active segment's last vertex.
- **New line** button (header, next to Undo): pushes `addSegment([])` — enabled only when the active segment has ≥2 points and `segments < MAX_SEGMENTS`. Hint text in Draw mode becomes: `'Tap to extend the line · New line + tap near a point to branch'`.
- **Undo:** pops the active segment's last point; if that leaves it empty AND more than one segment exists, remove its polyline and the segment, reactivate the last remaining segment. **Clear:** removes all segments, then `addSegment([])`.
- **Save enabled** when at least one segment has ≥2 points. `handleDone` extracts `segments = segmentsRef.current.map(s => pathToPoints(s.path)).filter(pts => pts.length >= 2)`.
- **Color:** swatch row in the Save panel (`SWATCHES.map` → round buttons, ring on the selected one); picking one calls `setColor` + updates `colorRef` + `polyline.setOptions({ strokeColor })` on every segment + re-renders vertex dots, so the preview is live.

**Save panel deltas:** title "Save fiber route"; modes `Update existing route` / `Create new route`; existing-mode `Select` lists routes from a mount-time `GET /fiber-routes` (`routeList`, preselect `initialRoute?.id`); new-mode single `Input` for name (prefill `initialRoute?.name ?? ''`); save calls `PATCH /fiber-routes/:id { segments, color }` or `POST /fiber-routes { name, color, segments }`; hint under existing mode: "The route's lines and color are replaced — its name stays."

**Header deltas:** eyebrow "Fiber route"; count text `${counts.segments} line${s} · ${counts.points} points`; buttons `Undo · New line · Cancel · Save…` (grid-cols-4 on mobile); Clear moves into the Save-panel-adjacent position? No — keep 5 buttons impossible on mobile: use `Undo · New line · Cancel · Save…` and move **Clear** to a small text button beside the legend chips (`Clear all`, dangerGhost styling, only when points > 0).

**Everything else** (projection, isMapSurface filter, mode toggle, search, layer control, lazy buildings with cluster + details card, lazy zone outlines with labels, mobile stacking, cleanup) is IDENTICAL to the boundary editor apart from pref keys — during execution, copy those blocks verbatim and rename `boundary-zone-label` → `fiber-zone-label`.

- [ ] **Step 2: Lint + build; commit**

```bash
cd frontend && npm run lint && npm run build
git add src/components/map/google/GoogleFiberEditor.js
git commit -m "feat: fiber route editor — branching polylines with snap-to-vertex"
```

---

### Task 3: Admin → Fiber routes page

**Files:**
- Create: `frontend/src/app/(app)/admin/fiber/page.js`
- Modify: `frontend/src/app/(app)/dashboard/page.js` (MANAGE_LINKS + icon import)

**Interfaces:**
- Consumes: `GoogleFiberEditor` (Task 2), fiber API (Task 1).

- [ ] **Step 1: The page**

```js
'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { apiClient, getApiErrorMessage } from '@/lib/api-client'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { IconEdit, IconTrash, IconPlus } from '@/components/ui/icons'

// Client-only: Google Maps JS touches window.
const GoogleFiberEditor = dynamic(() => import('@/components/map/google/GoogleFiberEditor'), {
  ssr: false,
})

export default function AdminFiberPage() {
  const [routes, setRoutes] = useState(null)
  const [listError, setListError] = useState(null)
  // undefined = closed, null = new route, object = edit that route.
  const [editorRoute, setEditorRoute] = useState(undefined)

  const fetchRoutes = useCallback(
    () =>
      apiClient
        .get('/fiber-routes')
        .then((res) => setRoutes(res.data.data))
        .catch(() => setRoutes([])),
    [],
  )

  useEffect(() => {
    fetchRoutes()
  }, [fetchRoutes])

  async function handleDelete(route) {
    if (!window.confirm(`Delete fiber route "${route.name}"?`)) return
    setListError(null)
    try {
      await apiClient.delete(`/fiber-routes/${route.id}`)
      fetchRoutes()
    } catch (err) {
      setListError(getApiErrorMessage(err))
    }
  }

  const segmentCount = (route) => route.segments?.length ?? 0
  const pointCount = (route) =>
    (route.segments ?? []).reduce((sum, segment) => sum + segment.length, 0)

  return (
    <main className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Administration"
        title="Fiber routes"
        sub="Draw the physical fiber network on the map — trunks and branches"
        backHref="/dashboard"
        backLabel="Dashboard"
      />

      <Button onClick={() => setEditorRoute(null)}>
        <IconPlus className="h-4.5 w-4.5" />
        Draw new route
      </Button>

      {listError && (
        <p className="mt-3 rounded-btn bg-bad-tint px-4 py-3 text-sm font-normal text-bad">
          {listError}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3">
        {routes === null && <p className="text-sm font-normal text-muted">Loading…</p>}
        {routes?.length === 0 && (
          <p className="text-sm font-normal text-muted">
            No fiber routes yet — draw the first one.
          </p>
        )}
        {routes?.map((route) => (
          <div
            key={route.id}
            className="flex items-center justify-between gap-3 rounded-card bg-card p-4 shadow-soft"
          >
            <span
              className="h-4 w-4 shrink-0 rounded-full border-2 border-white shadow"
              style={{ backgroundColor: route.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{route.name}</p>
              <p className="text-sm font-normal text-muted">
                {segmentCount(route)} line{segmentCount(route) === 1 ? '' : 's'} ·{' '}
                {pointCount(route)} points
              </p>
            </div>
            <button
              aria-label="Edit"
              onClick={() => setEditorRoute(route)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-paper hover:text-ink"
            >
              <IconEdit className="h-4.5 w-4.5" strokeWidth={1.8} />
            </button>
            <button
              aria-label="Delete"
              onClick={() => handleDelete(route)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-colors hover:bg-bad-tint hover:text-bad"
            >
              <IconTrash className="h-4.5 w-4.5" strokeWidth={1.8} />
            </button>
          </div>
        ))}
      </div>

      {editorRoute !== undefined && (
        <GoogleFiberEditor
          initialRoute={editorRoute ?? undefined}
          onClose={() => setEditorRoute(undefined)}
          onSaved={() => {
            setEditorRoute(undefined)
            fetchRoutes()
          }}
        />
      )}
    </main>
  )
}
```

- [ ] **Step 2: Dashboard link**

In `dashboard/page.js` MANAGE_LINKS, after the Zones entry (`IconNavigate` joins the icons import):

```js
  { href: '/admin/fiber', label: 'Fiber routes', sub: 'Network lines', icon: IconNavigate },
```

(No `adminOnly` — managers may draw.)

- [ ] **Step 3: Lint + build; commit**

```bash
cd frontend && npm run lint && npm run build
git add "src/app/(app)/admin/fiber" "src/app/(app)/dashboard/page.js"
git commit -m "feat: admin fiber routes page with draw/edit/delete"
```

---

### Task 4: Fiber layer on `/map`

**Files:**
- Create: `frontend/src/hooks/useFiberRoutes.js`
- Modify: `frontend/src/app/(app)/map/page.js`, `frontend/src/components/map/MapLegend.js`, `frontend/src/components/map/google/GoogleBuildingsMap.js`

**Interfaces:**
- Consumes: `GET /fiber-routes`.
- Produces: `useFiberRoutes(enabled)` → `{ routes }` (empty until enabled; fetched once); `GoogleBuildingsMap` accepts `fiberRoutes` prop (array of route objects) and renders polylines; `MapLegend` gains `fiberShown / fiberCount / onToggleFiber`.

- [ ] **Step 1: Hook**

```js
'use client'

import { useEffect, useRef, useState } from 'react'
import { apiClient } from '@/lib/api-client'

/** Fiber routes for the map layer — fetched once, only after first enable. */
export function useFiberRoutes(enabled) {
  const [routes, setRoutes] = useState([])
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (!enabled || fetchedRef.current) return
    fetchedRef.current = true
    let cancelled = false
    apiClient
      .get('/fiber-routes')
      .then((res) => {
        if (!cancelled) setRoutes(res.data.data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { routes }
}
```

- [ ] **Step 2: Map page wiring**

In `map/page.js`: `const [fiberShown, setFiberShown] = useState(false)`; `const { routes: fiberRoutes } = useFiberRoutes(fiberShown)`; pass `fiberRoutes={fiberShown ? fiberRoutes : []}` to `<BuildingsMap>`; pass `fiberShown`, `fiberCount={fiberRoutes.length}`, `onToggleFiber={() => setFiberShown((v) => !v)}` to `<MapLegend>`.

- [ ] **Step 3: Legend row**

In `MapLegend.js`, add props `fiberShown, fiberCount, onToggleFiber` and, after the Coverage zones row, a toggle row in the same button style as Buildings/zones rows with the label `Fiber` and count `fiberCount` (dim to `opacity-40` when off; use a small amber line glyph: `<span className="h-0.5 w-4 rounded-full bg-[#f59e0b]" />` in place of the icon).

- [ ] **Step 4: Polylines in GoogleBuildingsMap**

Add prop `fiberRoutes = []`, a `fiberOverlaysRef = useRef([])`, and an effect:

```js
  // Fiber routes: plain colored polylines + junction-friendly rendering.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    fiberOverlaysRef.current.forEach((line) => line.setMap(null))
    fiberOverlaysRef.current = fiberRoutes.flatMap((route) =>
      (route.segments ?? []).map(
        (segment) =>
          new google.maps.Polyline({
            map,
            path: segment.map((p) => ({ lat: p.latitude, lng: p.longitude })),
            strokeColor: route.color,
            strokeOpacity: 0.9,
            strokeWeight: 3,
            clickable: false,
            zIndex: 5,
          }),
      ),
    )
  }, [fiberRoutes, ready])
```

plus `fiberOverlaysRef.current.forEach((line) => line.setMap(null))` in the unmount cleanup.

- [ ] **Step 5: Lint + build; commit**

```bash
cd frontend && npm run lint && npm run build
git add src/hooks/useFiberRoutes.js "src/app/(app)/map/page.js" src/components/map/MapLegend.js src/components/map/google/GoogleBuildingsMap.js
git commit -m "feat: fiber layer on the main map behind a legend toggle"
```

---

### Task 5: Browser verification (Playwright, scratchpad)

Servers: backend :4090 (restart via nohup if down), `npm run build && npx next start -p 3477`.

- [ ] **Step 1: Editor flow** — login admin → `/admin/fiber` → "Draw new route" → editor opens → "Draw points" → click 3 spread points (header `1 line · 3 points`) → **New line** → click within 12 px of the 2nd vertex's screen position, then two more points (header `2 lines · 3 points`… then `2 lines · 5 points`; assert the branch's first point EQUALS the trunk vertex by reading the saved payload later) → Undo twice (drops branch points; dropping the last one removes the branch → `1 line · 3 points`) → redraw branch → **Save…** → pick a red swatch → name `FiberTest-<stamp>` → Create route → appears in the list with the red dot and `2 lines`.
- [ ] **Step 2: Persistence + snap check** — reopen via Edit → header shows `2 lines · 6 points` (or matching counts); via the API (page fetch with the app session) confirm `segments[1][0]` equals some vertex of `segments[0]` exactly.
- [ ] **Step 3: Map layer** — `/map` → legend shows `Fiber` row → toggle on → assert exactly one `/fiber-routes` request fired and polylines render (screenshot) → toggle off/on.
- [ ] **Step 4: Cleanup** — delete the test route; kill only our `next start` (by PID/pkill of `next start -p 3477`). Commit any fixes found.

---

## Self-Review Notes

- **Spec coverage:** model + validation caps (T1), CRUD gates ADMIN+MANAGER with audit + all-role reads (T1), branching editor with snap + New line + undo-across-segments + live color swatches (T2), reuse of every v3.65 workaround (T2 clones the boundary editor), admin entry page + dashboard link (T3), lazy `/map` layer + legend row (T4), phasing honored (no types/legend-colors yet), verification incl. junction-coordinate equality (T5).
- **Type consistency:** `segments: [[{latitude, longitude}]]` shape identical across schema (T1), editor extraction (T2), admin counts (T3), and polyline rendering (T4); `initialRoute {id,name,color,segments}` (T2) = list objects passed by T3; hook contract `useFiberRoutes(enabled)` (T4) matches map page usage.
- **Placeholder scan:** Task 2 authors the editor from an in-repo reference file plus a complete delta list (state model, handlers, panel, header all specified with code) — executed inline with the reference open; no TBDs.
