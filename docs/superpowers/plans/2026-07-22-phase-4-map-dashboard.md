# Phase 4 – Map Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive map of all surveyed buildings with PRD marker colors, tap-to-inspect bottom card, and filters (zone, status, surveyor, date, radius) plus text search.

**Architecture:** The buildings service gains filter-aware listing (Prisma `where` built in the service, radius post-filtered with the Phase-3 geo utils). The frontend `/map` page hosts a dynamic-imported `BuildingsMap` (Leaflet circle markers, fit-to-buildings on load — user decision), a `FilterSheet` bottom sheet, a search bar, and a `SelectedBuildingCard`.

**Tech Stack:** Existing stack; no new dependencies.

## Global Constraints

- Marker colors, verbatim per PRD: FEASIBLE green `#16a34a`, PERMISSION_PENDING yellow `#ca8a04`, REJECTED red `#dc2626`, SURVEY_PENDING blue `#2563eb`.
- Filters: zoneId, status, createdById, dateFrom, dateTo, search, latitude+longitude+radius. All optional, combinable.
- Map list capped at 500 buildings (clustering deferred per PRD challenge #7).
- Surveyor filter UI only for ADMIN / MANAGER roles.
- Express 5: validated query params on `req.validatedQuery`.
- Envelope and layering rules unchanged. Commit after every task.

---

### Task 1: Backend — filtered buildings list

**Files:**
- Modify: `backend/src/modules/buildings/building.schemas.js` (add `listQuerySchema`)
- Modify: `backend/src/modules/buildings/building.service.js` (`listBuildings(filters)`)
- Modify: `backend/src/modules/buildings/building.repository.js` (`list(where, take)`)
- Modify: `backend/src/modules/buildings/building.controller.js`
- Modify: `backend/src/modules/buildings/building.routes.js`
- Test: `backend/tests/building-list.service.test.js`

**Interfaces:**
- Produces: `listBuildings(filters)` where filters = `{ zoneId?, status?, createdById?, dateFrom?, dateTo?, search?, latitude?, longitude?, radius? }`; returns buildings (radius-filtered when lat/lng/radius all present). Repository `list(where, take = 100)`.

- [ ] **Step 1: Write the failing service test**

`backend/tests/building-list.service.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

function captureRepo(result = []) {
  const calls = []
  return {
    calls,
    list: async (where, take) => {
      calls.push({ where, take })
      return result
    },
  }
}

describe('building service listBuildings filters', () => {
  it('passes an empty where when no filters given', async () => {
    const repo = captureRepo()
    await createBuildingService({ buildingRepository: repo }).listBuildings({})
    expect(repo.calls[0].where).toEqual({})
  })

  it('builds zone/status/surveyor filters', async () => {
    const repo = captureRepo()
    await createBuildingService({ buildingRepository: repo }).listBuildings({
      zoneId: 'z1',
      status: 'FEASIBLE',
      createdById: 'u1',
    })
    expect(repo.calls[0].where).toEqual({
      zoneId: 'z1',
      feasibleStatus: 'FEASIBLE',
      createdById: 'u1',
    })
  })

  it('builds a createdAt range from dateFrom/dateTo', async () => {
    const repo = captureRepo()
    await createBuildingService({ buildingRepository: repo }).listBuildings({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
    })
    const range = repo.calls[0].where.createdAt
    expect(range.gte).toEqual(new Date('2026-07-01'))
    expect(range.lte).toEqual(new Date('2026-07-22T23:59:59.999Z'))
  })

  it('builds an OR search over name, address, and zone name', async () => {
    const repo = captureRepo()
    await createBuildingService({ buildingRepository: repo }).listBuildings({ search: 'sunrise' })
    expect(repo.calls[0].where.OR).toEqual([
      { buildingName: { contains: 'sunrise', mode: 'insensitive' } },
      { formattedAddress: { contains: 'sunrise', mode: 'insensitive' } },
      { zone: { name: { contains: 'sunrise', mode: 'insensitive' } } },
    ])
  })

  it('radius filter: bounding box in where, exact haversine post-filter', async () => {
    const inside = { id: 'a', latitude: 19.0761, longitude: 72.8777 }
    const corner = { id: 'b', latitude: 19.0769, longitude: 72.8786 } // in box, ~130 m away
    const repo = captureRepo([inside, corner])
    const results = await createBuildingService({ buildingRepository: repo }).listBuildings({
      latitude: 19.076,
      longitude: 72.8777,
      radius: 100,
    })
    expect(repo.calls[0].where.latitude.gte).toBeCloseTo(19.0751, 3)
    expect(results.map((r) => r.id)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/building-list.service.test.js` → FAIL (listBuildings takes no filters / repo.list signature).

- [ ] **Step 3: Implement**

`building.schemas.js` — add:

```js
export const listQuerySchema = z.object({
  zoneId: z.string().optional(),
  status: z.enum(['FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING']).optional(),
  createdById: z.string().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  search: z.string().max(200).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().int().positive().max(50000).optional(),
})
```

`building.repository.js` — replace `list`:

```js
  list: (where = {}, take = 100) =>
    prisma.building.findMany({
      where,
      include: { zone: true, details: true },
      orderBy: { createdAt: 'desc' },
      take,
    }),
```

`building.service.js` — replace `listBuildings`:

```js
    async listBuildings(filters = {}) {
      const { zoneId, status, createdById, dateFrom, dateTo, search, latitude, longitude, radius } =
        filters
      const where = {}
      if (zoneId) where.zoneId = zoneId
      if (status) where.feasibleStatus = status
      if (createdById) where.createdById = createdById
      if (dateFrom || dateTo) {
        where.createdAt = {}
        if (dateFrom) where.createdAt.gte = new Date(dateFrom)
        if (dateTo) where.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`)
      }
      if (search) {
        where.OR = [
          { buildingName: { contains: search, mode: 'insensitive' } },
          { formattedAddress: { contains: search, mode: 'insensitive' } },
          { zone: { name: { contains: search, mode: 'insensitive' } } },
        ]
      }

      const hasRadius = latitude !== undefined && longitude !== undefined && radius !== undefined
      if (hasRadius) {
        const box = boundingBox(latitude, longitude, radius)
        where.latitude = { gte: box.minLat, lte: box.maxLat }
        where.longitude = { gte: box.minLon, lte: box.maxLon }
      }

      const buildings = await buildingRepository.list(where, 500)
      if (!hasRadius) return buildings
      return buildings.filter(
        (b) => haversineMeters(latitude, longitude, b.latitude, b.longitude) <= radius,
      )
    },
```

`building.controller.js` — `list` uses `req.validatedQuery`:

```js
  async list(req, res, next) {
    try {
      const buildings = await buildingService.listBuildings(req.validatedQuery ?? {})
      res.json({ success: true, data: buildings })
    } catch (err) {
      next(err)
    }
  },
```

`building.routes.js` — validate the list query:

```js
buildingRoutes.get('/', validateQuery(listQuerySchema), buildingController.list)
```

(import `listQuerySchema`.)

- [ ] **Step 4: Run all tests** — `npx vitest run` → PASS.
- [ ] **Step 5: Commit** — `git add backend && git commit -m "feat(backend): filtered buildings listing for map dashboard"`

---

### Task 2: Frontend — status constants and BuildingsMap component

**Files:**
- Modify: `frontend/src/lib/constants.js` (STATUS_COLORS, STATUS_LABELS)
- Modify: `frontend/src/components/buildings/BuildingCard.js` (use shared constants)
- Create: `frontend/src/components/map/BuildingsMap.js`

**Interfaces:**
- Produces: `STATUS_COLORS = { FEASIBLE: '#16a34a', PERMISSION_PENDING: '#ca8a04', REJECTED: '#dc2626', SURVEY_PENDING: '#2563eb' }`, `STATUS_LABELS` (existing labels moved here). Default-export client component `<BuildingsMap buildings selectedId onSelect />` — circle markers colored by `feasibleStatus`; fits bounds to buildings on first data (user decision: fit-all); `onSelect(building)` on marker tap. Load with `next/dynamic`, `ssr: false`.

- [ ] **Step 1: Shared constants**

Append to `frontend/src/lib/constants.js`:

```js
export const STATUS_COLORS = {
  FEASIBLE: '#16a34a',
  PERMISSION_PENDING: '#ca8a04',
  REJECTED: '#dc2626',
  SURVEY_PENDING: '#2563eb',
}

export const STATUS_LABELS = {
  FEASIBLE: 'Feasible',
  PERMISSION_PENDING: 'Permission Pending',
  REJECTED: 'Rejected',
  SURVEY_PENDING: 'Survey Pending',
}
```

Update `BuildingCard.js` and the detail page to import `STATUS_LABELS` from constants (delete their local copies).

- [ ] **Step 2: BuildingsMap**

`frontend/src/components/map/BuildingsMap.js`:

```js
'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { STATUS_COLORS } from '@/lib/constants'

const DEFAULT_CENTER = [20.5937, 78.9629] // country-level fallback when no buildings
const DEFAULT_ZOOM = 5

export default function BuildingsMap({ buildings, selectedId, onSelect }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(new Map())
  const fittedRef = useRef(false)

  useEffect(() => {
    if (mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: false }).setView(
      DEFAULT_CENTER,
      DEFAULT_ZOOM,
    )
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current.clear()

    buildings.forEach((building) => {
      const isSelected = building.id === selectedId
      const marker = L.circleMarker([building.latitude, building.longitude], {
        radius: isSelected ? 11 : 8,
        color: '#ffffff',
        weight: 2,
        fillColor: STATUS_COLORS[building.feasibleStatus] ?? '#6b7280',
        fillOpacity: 1,
      }).addTo(map)
      marker.on('click', () => onSelect(building))
      markersRef.current.set(building.id, marker)
    })

    if (!fittedRef.current && buildings.length > 0) {
      const bounds = L.latLngBounds(buildings.map((b) => [b.latitude, b.longitude]))
      map.fitBounds(bounds.pad(0.2), { maxZoom: 16 })
      fittedRef.current = true
    }
  }, [buildings, selectedId, onSelect])

  return <div ref={containerRef} className="h-full w-full" />
}
```

- [ ] **Step 3: Commit** — `git add frontend && git commit -m "feat(frontend): BuildingsMap with PRD status-colored markers"`

---

### Task 3: Frontend — map page with filters, search, selected card

**Files:**
- Create: `frontend/src/hooks/useBuildings.js`
- Create: `frontend/src/components/map/FilterSheet.js`
- Create: `frontend/src/components/map/SelectedBuildingCard.js`
- Modify: `frontend/src/app/(app)/map/page.js`

**Interfaces:**
- Consumes: `GET /buildings` with query params, `useZones`, `useAuthStore` (role check), `GET /users` (ADMIN/MANAGER only), `BuildingsMap`, `STATUS_LABELS`.
- Produces: `/map` dashboard page. `useBuildings(filters)` → `{ buildings, loading, refetch }`.

- [ ] **Step 1: useBuildings hook**

`frontend/src/hooks/useBuildings.js`:

```js
'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'

export function useBuildings(filters = {}) {
  const [buildings, setBuildings] = useState([])
  const [loading, setLoading] = useState(true)
  const filtersKey = JSON.stringify(filters)

  const fetchBuildings = useCallback(() => {
    setLoading(true)
    const params = Object.fromEntries(
      Object.entries(JSON.parse(filtersKey)).filter(([, v]) => v !== '' && v != null),
    )
    return apiClient
      .get('/buildings', { params })
      .then((res) => setBuildings(res.data.data))
      .finally(() => setLoading(false))
  }, [filtersKey])

  useEffect(() => {
    fetchBuildings()
  }, [fetchBuildings])

  return { buildings, loading, refetch: fetchBuildings }
}
```

- [ ] **Step 2: FilterSheet** (bottom sheet; zone/status/surveyor/date filters)

`frontend/src/components/map/FilterSheet.js`:

```js
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useZones } from '@/hooks/useZones'
import { useAuthStore } from '@/stores/auth-store'
import { apiClient } from '@/lib/api-client'
import { STATUS_LABELS } from '@/lib/constants'

const selectClass =
  'min-h-12 w-full rounded-xl border border-gray-300 bg-white px-4 text-base outline-none focus:ring-2 focus:ring-blue-200'

export function FilterSheet({ open, filters, onApply, onClose }) {
  const { zones } = useZones()
  const role = useAuthStore((s) => s.user?.role)
  const [surveyors, setSurveyors] = useState([])
  const [local, setLocal] = useState(filters)
  const canFilterSurveyor = role === 'ADMIN' || role === 'MANAGER'

  useEffect(() => setLocal(filters), [filters, open])

  useEffect(() => {
    if (canFilterSurveyor) {
      apiClient.get('/users').then((res) => setSurveyors(res.data.data))
    }
  }, [canFilterSurveyor])

  if (!open) return null

  const set = (key) => (e) => setLocal({ ...local, [key]: e.target.value })

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-300" />
        <h2 className="mb-4 text-lg font-bold text-gray-900">Filters</h2>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Zone</label>
            <select className={selectClass} value={local.zoneId ?? ''} onChange={set('zoneId')}>
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Status</label>
            <select className={selectClass} value={local.status ?? ''} onChange={set('status')}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {canFilterSurveyor && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Surveyor</label>
              <select
                className={selectClass}
                value={local.createdById ?? ''}
                onChange={set('createdById')}
              >
                <option value="">All surveyors</option>
                {surveyors.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input id="dateFrom" label="From" type="date" value={local.dateFrom ?? ''} onChange={set('dateFrom')} />
            <Input id="dateTo" label="To" type="date" value={local.dateTo ?? ''} onChange={set('dateTo')} />
          </div>

          <div className="mt-2 flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => { onApply({}); onClose() }}>
              Clear
            </Button>
            <Button fullWidth onClick={() => { onApply(local); onClose() }}>
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: SelectedBuildingCard**

`frontend/src/components/map/SelectedBuildingCard.js`:

```js
'use client'

import Link from 'next/link'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/constants'

export function SelectedBuildingCard({ building, onClose }) {
  if (!building) return null

  return (
    <div className="fixed inset-x-3 bottom-20 z-40 rounded-2xl bg-white p-4 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{building.buildingName}</p>
          <p className="truncate text-sm text-gray-500">{building.formattedAddress}</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1 text-gray-400">✕</button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: STATUS_COLORS[building.feasibleStatus] }}
        />
        <span className="text-sm text-gray-700">{STATUS_LABELS[building.feasibleStatus]}</span>
        {building.zone?.name && <span className="text-sm text-gray-400">· {building.zone.name}</span>}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
        {building.details?.homePass != null && <span>{building.details.homePass} home pass</span>}
        {building.details?.wings != null && <span>{building.details.wings} wings</span>}
        {building.details?.floors != null && <span>{building.details.floors} floors</span>}
      </div>

      <Link
        href={`/buildings/${building.id}`}
        className="mt-3 block rounded-xl bg-blue-600 py-3 text-center font-semibold text-white active:bg-blue-700"
      >
        View Details
      </Link>
    </div>
  )
}
```

- [ ] **Step 4: Map page**

`frontend/src/app/(app)/map/page.js`:

```js
'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useBuildings } from '@/hooks/useBuildings'
import { FilterSheet } from '@/components/map/FilterSheet'
import { SelectedBuildingCard } from '@/components/map/SelectedBuildingCard'
import { Fab } from '@/components/ui/Fab'

const BuildingsMap = dynamic(() => import('@/components/map/BuildingsMap'), { ssr: false })

export default function MapPage() {
  const [filters, setFilters] = useState({})
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState(null)

  const query = useMemo(
    () => ({ ...filters, search: search || undefined }),
    [filters, search],
  )
  const { buildings, loading } = useBuildings(query)
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  return (
    <div className="fixed inset-0 bottom-16">
      <BuildingsMap buildings={buildings} selectedId={selected?.id} onSelect={setSelected} />

      <div className="absolute inset-x-3 top-3 z-40 flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search building, address, zone…"
          className="min-h-12 flex-1 rounded-xl border border-gray-200 bg-white px-4 text-base shadow-md outline-none focus:ring-2 focus:ring-blue-200"
        />
        <button
          onClick={() => setFiltersOpen(true)}
          className="relative min-h-12 rounded-xl bg-white px-4 font-medium text-gray-700 shadow-md"
        >
          Filters
          {activeFilterCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {loading && (
        <p className="absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-full bg-white px-4 py-1.5 text-sm text-gray-600 shadow">
          Loading…
        </p>
      )}

      <SelectedBuildingCard building={selected} onClose={() => setSelected(null)} />
      <FilterSheet
        open={filtersOpen}
        filters={filters}
        onApply={setFilters}
        onClose={() => setFiltersOpen(false)}
      />
      {!selected && <Fab href="/buildings/add" label="Add Building" />}
    </div>
  )
}
```

- [ ] **Step 5: Commit** — `git add frontend && git commit -m "feat(frontend): map dashboard with filters, search, and building card"`

---

### Task 4: End-to-end verification

- [ ] Seed a few status variations via psql, run full backend suite, verify `/api/v1/buildings?status=…&search=…&zoneId=…` combinations, `/map` renders, then finish the branch.
