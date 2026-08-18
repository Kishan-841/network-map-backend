# Zone Boundary Map Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins draw/edit zone boundaries by clicking on a full-screen Google Map instead of typing lat/longs; the zone form's coordinates fill automatically.

**Architecture:** One new client component, `GoogleBoundaryMapEditor`, opened as a full-screen overlay from the zone form in Admin → Zones. A single `google.maps.Polygon` with `editable: true` is the source of truth: map clicks append vertices, Google's handles drag/insert them, Undo pops the last one. On Done the path is extracted to the API's `{ latitude, longitude }` shape and handed back to the existing `ZoneForm.points` state — the backend and save flow are untouched. Overlays (faded buildings, faint other zones) and a location search (existing map-provider autocomplete) give drawing context.

**Tech Stack:** Google Maps JS via existing `loadGoogleMaps()`, Next.js client components, existing map-provider autocomplete (`getMapProvider()`), DaisyUI.

**Spec:** `interactive-google-maps.md` (repo root; decisions confirmed 2026-08-18)

## Global Constraints

- Frontend-only. NO backend/schema changes. NO new npm dependencies. NO `google.maps.drawing.DrawingManager`.
- 3-point minimum, **100-point maximum** (API cap) enforced in the editor.
- `/map` page untouched; Leaflet variant not built.
- Manual coordinate rows stay as a collapsible fallback (collapsed by default).
- Nothing persists until the zone form's normal Save.
- No frontend unit-test framework — verification is `npm run lint`, `npm run build`, and Playwright against a `next start` server on an alternate port (Next 16 refuses a second `next dev`; NEVER touch the user's dev server).
- Pre-existing lint errors in `SearchStep.js`, `AuthGuard.js`, `useBuildings.js` are not ours.

---

### Task 1: `GoogleBoundaryMapEditor` component

**Files:**
- Create: `frontend/src/components/map/google/GoogleBoundaryMapEditor.js`

**Interfaces:**
- Consumes: `loadGoogleMaps()`; `getMapProvider().autocomplete({ input, latitude, longitude, signal })` → predictions `[{ placeId, name, formattedAddress, latitude?, longitude? }]` and `.getPlaceDetails({ placeId })` → `{ latitude, longitude }` (Google provider only — Nominatim predictions carry coords inline); `apiClient.get('/buildings', { params: { pageSize: 500 } })` → `data.data.items`; `apiClient.get('/zones')` → `data.data` array with `{ id, name, boundary }`; `buildingColor`, `zoneColor` from `@/lib/constants`; `DECLUTTER_MAP_STYLE` from `@/lib/map-markers`; `useMapLayer` + `MapLayerControl`.
- Produces (Task 2 relies on this exact contract):

```js
export default function GoogleBoundaryMapEditor({
  zoneName,        // string — shown in the header
  excludeZoneId,   // string | undefined — this zone's own overlay is hidden
  initialPoints,   // [{ latitude: number, longitude: number }] — may be []
  onDone,          // (points: [{ latitude, longitude }]) => void — ≥3 points guaranteed
  onCancel,        // () => void
})
```

- [ ] **Step 1: Write the component**

Create `frontend/src/components/map/google/GoogleBoundaryMapEditor.js`:

```js
'use client'

import { useEffect, useRef, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { loadGoogleMaps } from '@/lib/google-maps-loader'
import { getMapProvider } from '@/lib/map-providers'
import { buildingColor, zoneColor } from '@/lib/constants'
import { DECLUTTER_MAP_STYLE } from '@/lib/map-markers'
import { useMapLayer } from '@/lib/useMapLayer'
import { MapLayerControl } from '@/components/map/MapLayerControl'
import { Button } from '@/components/ui/Button'
import { IconSearch } from '@/components/ui/icons'

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 } // country-level fallback
const DEFAULT_ZOOM = 5
const MAX_POINTS = 100 // API cap (zone.schemas.js)
const EDIT_COLOR = '#0e7569' // --color-fiber

/**
 * Full-screen draw/edit surface for a zone boundary. One editable polygon is
 * the source of truth: map clicks append vertices, Google's handles drag and
 * insert them, Undo pops the last. Done extracts the path in API shape
 * ({ latitude, longitude }); nothing persists here — the zone form saves.
 */
export default function GoogleBoundaryMapEditor({
  zoneName,
  excludeZoneId,
  initialPoints = [],
  onDone,
  onCancel,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const polygonRef = useRef(null)
  const numberMarkersRef = useRef([])
  const rubberRef = useRef(null)
  const overlaysRef = useRef([]) // building dots + other-zone outlines
  const zonesShownRef = useRef(true)
  const [ready, setReady] = useState(false)
  const [pointCount, setPointCount] = useState(initialPoints.length)
  const [zonesShown, setZonesShown] = useState(true)
  const [layer, setLayer] = useMapLayer('boundary', 'hybrid')

  // Location search (same provider stack as the add-building flow).
  const [query, setQuery] = useState('')
  const [predictions, setPredictions] = useState([])

  useEffect(() => {
    let cancelled = false
    loadGoogleMaps().then(({ Map }) => {
      if (cancelled || mapRef.current) return
      const map = new Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        mapTypeId: layer,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
        styles: DECLUTTER_MAP_STYLE,
      })
      mapRef.current = map

      const polygon = new google.maps.Polygon({
        map,
        paths: initialPoints.map((p) => ({ lat: p.latitude, lng: p.longitude })),
        strokeColor: EDIT_COLOR,
        strokeWeight: 2,
        fillColor: EDIT_COLOR,
        fillOpacity: 0.2,
        editable: true,
        draggable: false,
        zIndex: 10,
      })
      polygonRef.current = polygon
      const path = polygon.getPath()

      const syncCount = () => {
        setPointCount(path.getLength())
        renderNumbers()
      }
      // Numbered dots on every vertex — rebuilt on any path change (≤100, cheap).
      const renderNumbers = () => {
        numberMarkersRef.current.forEach((m) => m.setMap(null))
        numberMarkersRef.current = []
        for (let i = 0; i < path.getLength(); i++) {
          numberMarkersRef.current.push(
            new google.maps.Marker({
              map,
              position: path.getAt(i),
              clickable: false,
              zIndex: 11,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 9,
                fillColor: EDIT_COLOR,
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
              },
              label: { text: String(i + 1), color: '#ffffff', fontSize: '10px', fontWeight: '700' },
            }),
          )
        }
      }
      path.addListener('insert_at', syncCount)
      path.addListener('remove_at', syncCount)
      path.addListener('set_at', syncCount)

      // Click appends the next vertex (drawing and refining share one mode).
      map.addListener('click', (event) => {
        if (!event.latLng || path.getLength() >= MAX_POINTS) return
        path.push(event.latLng)
      })

      // Rubber band from the last vertex to the cursor (desktop only).
      const rubber = new google.maps.Polyline({
        map,
        path: [],
        strokeColor: EDIT_COLOR,
        strokeOpacity: 0.5,
        strokeWeight: 2,
        clickable: false,
        zIndex: 9,
      })
      rubberRef.current = rubber
      map.addListener('mousemove', (event) => {
        const len = path.getLength()
        if (!event.latLng || len === 0 || len >= MAX_POINTS) {
          rubber.setPath([])
          return
        }
        rubber.setPath([path.getAt(len - 1), event.latLng])
      })
      map.addListener('mouseout', () => rubber.setPath([]))

      // Right-click a vertex to remove it (Undo covers the common case).
      polygon.addListener('rightclick', (event) => {
        if (event.vertex !== undefined) path.removeAt(event.vertex)
      })

      // Start where the work is: the existing boundary, else the default view.
      if (initialPoints.length > 0) {
        const bounds = new google.maps.LatLngBounds()
        initialPoints.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }))
        map.fitBounds(bounds, 64)
      }

      renderNumbers()
      setReady(true)
    })
    return () => {
      cancelled = true
      polygonRef.current?.setMap(null)
      numberMarkersRef.current.forEach((m) => m.setMap(null))
      overlaysRef.current.forEach((o) => o.setMap(null))
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (mapRef.current && ready) mapRef.current.setMapTypeId(layer)
  }, [layer, ready])

  // Context overlays: faded building dots + faint other-zone outlines.
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    let cancelled = false
    Promise.all([
      apiClient.get('/buildings', { params: { pageSize: 500 } }).catch(() => null),
      apiClient.get('/zones').catch(() => null),
    ]).then(([buildingsRes, zonesRes]) => {
      if (cancelled || !mapRef.current) return
      const overlays = []
      for (const building of buildingsRes?.data.data.items ?? []) {
        overlays.push(
          new google.maps.Marker({
            map,
            position: { lat: building.latitude, lng: building.longitude },
            clickable: false,
            zIndex: 2,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 5,
              fillColor: buildingColor(building),
              fillOpacity: 0.5,
              strokeColor: '#ffffff',
              strokeWeight: 1,
            },
          }),
        )
      }
      const zones = (zonesRes?.data.data ?? []).filter(
        (zone) => zone.id !== excludeZoneId && zone.boundary?.length >= 3,
      )
      zones.forEach((zone, index) => {
        overlays.push(
          new google.maps.Polygon({
            map: zonesShownRef.current ? map : null,
            paths: zone.boundary.map((p) => ({ lat: p.latitude, lng: p.longitude })),
            strokeColor: zoneColor(index),
            strokeOpacity: 0.6,
            strokeWeight: 1.5,
            fillColor: zoneColor(index),
            fillOpacity: 0.06,
            clickable: false,
            zIndex: 1,
            isZoneOverlay: true,
          }),
        )
      })
      overlaysRef.current = overlays
    })
    return () => {
      cancelled = true
    }
  }, [ready, excludeZoneId])

  // Toggle only the zone outlines; building dots always show.
  useEffect(() => {
    zonesShownRef.current = zonesShown
    overlaysRef.current.forEach((overlay) => {
      if (overlay.isZoneOverlay) overlay.setMap(zonesShown ? mapRef.current : null)
    })
  }, [zonesShown])

  // Debounced location search via the existing provider stack.
  useEffect(() => {
    const input = query.trim()
    if (input.length < 3) {
      setPredictions([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const center = mapRef.current?.getCenter()
      getMapProvider()
        .autocomplete({
          input,
          latitude: center?.lat() ?? DEFAULT_CENTER.lat,
          longitude: center?.lng() ?? DEFAULT_CENTER.lng,
          signal: controller.signal,
        })
        .then((results) => setPredictions(results.slice(0, 5)))
        .catch(() => {})
    }, 350)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  async function jumpTo(prediction) {
    setQuery('')
    setPredictions([])
    let { latitude, longitude } = prediction
    if (latitude == null) {
      try {
        ;({ latitude, longitude } = await getMapProvider().getPlaceDetails({
          placeId: prediction.placeId,
        }))
      } catch {
        return
      }
    }
    mapRef.current?.panTo({ lat: latitude, lng: longitude })
    mapRef.current?.setZoom(15)
  }

  function handleUndo() {
    const path = polygonRef.current?.getPath()
    if (path?.getLength() > 0) path.removeAt(path.getLength() - 1)
  }

  function handleClear() {
    polygonRef.current?.getPath().clear()
  }

  function handleDone() {
    const path = polygonRef.current.getPath()
    const points = []
    for (let i = 0; i < path.getLength(); i++) {
      const point = path.getAt(i)
      points.push({ latitude: point.lat(), longitude: point.lng() })
    }
    onDone(points)
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-paper">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-faint">Zone boundary</p>
          <p className="truncate font-bold">{zoneName?.trim() || 'New zone'}</p>
        </div>
        <p className="text-sm tabular-nums text-muted">
          {pointCount} point{pointCount === 1 ? '' : 's'}
          {pointCount < 3 && ' — need at least 3'}
          {pointCount >= MAX_POINTS && ` — limit ${MAX_POINTS}`}
        </p>
        <Button variant="secondary" onClick={handleUndo} disabled={pointCount === 0}>
          Undo
        </Button>
        <Button variant="dangerGhost" onClick={handleClear} disabled={pointCount === 0}>
          Clear
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleDone} disabled={pointCount < 3}>
          Done
        </Button>
      </div>

      {/* Map + floating controls */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />

        <div className="absolute left-3 top-3 z-10 w-72 max-w-[calc(100%-6rem)]">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search location…"
              className="h-11 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-sm shadow-md outline-none focus:border-fiber focus:ring-2 focus:ring-fiber/15"
            />
          </div>
          {predictions.length > 0 && (
            <div className="mt-1 overflow-hidden rounded-xl border border-line bg-card shadow-lift">
              {predictions.map((prediction) => (
                <button
                  key={prediction.placeId}
                  onClick={() => jumpTo(prediction)}
                  className="block w-full truncate px-3 py-2.5 text-left text-sm transition-colors hover:bg-paper"
                >
                  <span className="font-medium">{prediction.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {prediction.formattedAddress}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="absolute bottom-4 left-3 z-10 flex cursor-pointer items-center gap-2 rounded-full border border-line bg-card px-3.5 py-2 text-xs font-medium shadow-md">
          <input
            type="checkbox"
            checked={zonesShown}
            onChange={(e) => setZonesShown(e.target.checked)}
            className="checkbox checkbox-xs"
          />
          Other zones
        </label>

        <MapLayerControl value={layer} onChange={setLayer} position="right-3 top-3" />

        <p className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-card/90 px-4 py-1.5 text-xs text-muted shadow">
          Click the map to add points · drag handles to adjust · right-click a point to remove it
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint + build**

Run: `cd "/Users/gazon/Documents/Network graph map/frontend" && npm run lint && npm run build`
Expected: no NEW lint problems; build compiles. (Check `MapLayerControl`'s `position` prop default — `GoogleBuildingsMap` passes one, `GoogleLocationPicker` omits it; if omitting positions it wrong here, pass `position="right-3 top-3"` as shown.)

- [ ] **Step 3: Commit**

```bash
cd "/Users/gazon/Documents/Network graph map/frontend"
git add src/components/map/google/GoogleBoundaryMapEditor.js
git commit -m "feat: full-screen zone boundary map editor component"
```

---

### Task 2: Wire the editor into the zone form

**Files:**
- Modify: `frontend/src/app/(app)/admin/zones/page.js` (ZoneForm + both usages)

**Interfaces:**
- Consumes: `GoogleBoundaryMapEditor` contract from Task 1; existing `parseBoundaryPoints(points)` → `[{ latitude, longitude }] | null`.
- Produces: zone form flow — "Draw on map" opens the editor seeded from current rows; Done writes 6-decimal strings back into `form.points`; manual rows collapse into a `<details>`.

- [ ] **Step 1: Add the dynamic import and icons**

In `frontend/src/app/(app)/admin/zones/page.js`:

```js
import dynamic from 'next/dynamic'
import { IconEdit, IconTrash, IconPin, IconUpload, IconDownload, IconMap } from '@/components/ui/icons'

// Client-only: Google Maps JS touches window.
const GoogleBoundaryMapEditor = dynamic(
  () => import('@/components/map/google/GoogleBoundaryMapEditor'),
  { ssr: false },
)
```

(`IconMap` joins the existing icon import line; `dynamic` joins the top imports.)

- [ ] **Step 2: Rework ZoneForm's boundary section**

Inside `ZoneForm` add state and a handler (after the existing `const [error, setError] = useState(null)`):

```js
  const [mapOpen, setMapOpen] = useState(false)

  // Editor returns numbers; rows hold strings. 6 decimals ≈ 0.1 m precision.
  const applyDrawnPoints = (drawn) => {
    setForm({
      ...form,
      points: drawn.map((point) => ({
        latitude: point.latitude.toFixed(6),
        longitude: point.longitude.toFixed(6),
      })),
    })
    setMapOpen(false)
  }
```

Replace the bare `<BoundaryEditor …/>` line with a draw button + collapsed manual rows:

```js
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-normal text-muted">
          {form.points.length >= 3
            ? `Boundary: ${form.points.length} points`
            : 'No boundary yet'}
        </p>
        <Button type="button" variant="secondary" onClick={() => setMapOpen(true)}>
          <IconMap className="h-4 w-4" strokeWidth={1.8} />
          Draw on map
        </Button>
      </div>

      {/* Manual rows stay as a transparency/debug fallback, collapsed. */}
      <details className="rounded-btn border border-line/60 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-faint">
          Edit coordinates manually
        </summary>
        <div className="pt-3">
          <BoundaryEditor points={form.points} onChange={(points) => setForm({ ...form, points })} />
        </div>
      </details>

      {mapOpen && (
        <GoogleBoundaryMapEditor
          zoneName={form.name}
          excludeZoneId={zoneId}
          initialPoints={parseBoundaryPoints(form.points) ?? []}
          onDone={applyDrawnPoints}
          onCancel={() => setMapOpen(false)}
        />
      )}
```

Change the ZoneForm signature to accept the id (used to hide the zone's own overlay):

```js
function ZoneForm({ initial, zoneId, onSave, onCancel, saveLabel }) {
```

- [ ] **Step 3: Pass zoneId at the edit call site**

Find the edit-mode usage (`editingId === zone.id` branch) and add `zoneId={zone.id}`:

```js
            <ZoneForm
              key={zone.id}
              zoneId={zone.id}
              initial={{ name: zone.name, city: zone.city, points: toFormPoints(zone.boundary) }}
```

(The create form at the top passes no `zoneId` — correct.)

- [ ] **Step 4: Lint + build**

Run: `cd "/Users/gazon/Documents/Network graph map/frontend" && npm run lint && npm run build`
Expected: no NEW problems; compiles.

- [ ] **Step 5: Commit**

```bash
cd "/Users/gazon/Documents/Network graph map/frontend"
git add "src/app/(app)/admin/zones/page.js"
git commit -m "feat: draw-on-map boundary editing in the zone form"
```

---

### Task 3: Browser verification (Playwright)

**Files:** scratchpad script only.

**Interfaces:**
- Consumes: backend on :4090 (`admin@isp.local` / `ChangeMe123!` — token field `data.token`); production frontend via `npm run build && npx next start -p 3477` (never the user's dev server); Playwright from the scratchpad with `executablePath` pointing at `~/Library/Caches/ms-playwright/chromium_headless_shell-1223/...`.

- [ ] **Step 1: Start servers**

Backend: `curl -s http://localhost:4090/api/v1/health` → 200 (restart `npm run dev` in `backend/` via nohup if down). Frontend: from `frontend/`, `npx next start -p 3477` in background (build already exists from Task 2).

- [ ] **Step 2: Script the flow**

Playwright script (scratchpad `verify-boundary.js`):

1. Log in as admin; go to `/admin/zones`.
2. In the create form: fill name `BoundaryTest-<stamp>`, city `TestCity`; click **Draw on map**.
3. Wait for the overlay (`text=Zone boundary`); wait ~3.5 s for Maps to settle.
4. Click 4 spread-out pixel positions on the map container (e.g. center ±150 px). Assert the header pill reads `4 points`.
5. Click **Undo** → `3 points`. Click one more map point → `4 points`.
6. Click **Done** → overlay closes; assert the form shows `Boundary: 4 points`; open the `<details>` and assert 4 coordinate rows are populated with numbers.
7. Save the zone; wait for it to appear in the list.
8. Reopen it (Edit → Draw on map) and assert the pill starts at `4 points` (existing boundary loads).
9. Cancel the editor, cancel the edit form; delete the test zone (accept the confirm dialog).
10. Fail the script on any `pageerror`/console error; screenshot the drawing state for the report.

- [ ] **Step 3: Run, fix, re-run until green**

Expected: all steps pass, no JS errors. Kill only the `next start` process we started (by PID). If fixes were needed, lint + build + commit them:

```bash
cd "/Users/gazon/Documents/Network graph map/frontend"
git add -A src
git commit -m "fix: boundary editor issues found in browser verification"
```

---

## Self-Review Notes

- **Spec coverage:** click-to-draw with live polygon + numbered points (T1), rubber-band preview desktop-only (T1), undo/clear (T1), ≥3/≤100 enforcement (T1 header + click guard), editable vertices with drag/insert/right-click-remove (T1), auto-fill of form coordinates — user never types lat/long (T2 `applyDrawnPoints`), existing-zone editing incl. boundary-less imported zones (T2 seeds `initialPoints` from rows; empty → draw fresh), cancel discards (T2 just closes; form untouched), location search via existing provider (T1), buildings overlay faded/non-clickable/unclustered (T1), other-zones faint toggleable overlay excluding self (T1 + T2 `excludeZoneId`), `/map` untouched (no edits there), no DrawingManager/no new deps (T1 uses plain Polygon), mobile: tap=click listener, big header buttons (T1), manual rows collapsed fallback (T2), acceptance walk-through (T3).
- **Type consistency:** `onDone(points: [{latitude, longitude}])` (T1) ↔ `applyDrawnPoints(drawn)` (T2); `excludeZoneId` (T1) ↔ `zoneId` prop (T2); `initialPoints` numbers via `parseBoundaryPoints` (T2) ↔ T1's `{ lat: p.latitude, lng: p.longitude }` mapping.
- **Placeholder scan:** clean. (One typo fixed: "collapsible fallback".)
