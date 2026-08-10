# Map Marker Diffing + Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the map from destroying/recreating all building markers on selection/refetch, and cluster markers at low zoom, so zooming stays smooth at 261+ buildings.

**Architecture:** `GoogleBuildingsMap` keeps markers in a persistent `Map` keyed by building id and diffs against the `buildings` prop (add/remove/update only what changed). Selection changes re-icon only the two affected pins via refs. A single `MarkerClusterer` owns marker visibility; batch mutations use `noDraw` + one `render()`. Pin SVG data-URIs are memoized per color/selected in `map-markers.js`.

**Tech Stack:** Google Maps JS (legacy `google.maps.Marker`, no Map ID), `@googlemaps/markerclusterer`, Next.js client component.

## Global Constraints

- Frontend has NO unit-test framework — verification is `npm run lint`, `npm run build`, and browser checks against the dev servers (codebase norm; adding a test framework is out of scope).
- Design.md is binding: cluster bubbles use the fiber emerald `#10b981`, white text, Inter font.
- Leaflet variant (`components/map/leaflet/`) untouched.
- Never restart/kill the user's dev servers; browser verification uses whatever is already running (frontend dev server), starting one only on an alternate port if none is running.
- Pre-existing lint errors in `SearchStep.js`, `AuthGuard.js`, `useBuildings.js` are NOT ours to fix — only the changed files must be clean.

---

### Task 1: Cached pin icons + dependency install

**Files:**
- Modify: `frontend/src/lib/map-markers.js` (append after `pinDataUri`)
- Modify: `frontend/package.json` (via npm install)

**Interfaces:**
- Consumes: existing `buildingPin({ color, selected })` → `{ svg, width, height, anchorX, anchorY }` and `pinDataUri(pin)`.
- Produces: `buildingPinCached({ color, selected })` → `{ svg, width, height, anchorX, anchorY, url }` — same shape plus a ready `url` data-URI, memoized per `color|selected`. Task 2 imports this.

- [ ] **Step 1: Install the clusterer**

Run: `cd "/Users/gazon/Documents/Network graph map/frontend" && npm install @googlemaps/markerclusterer`
Expected: added to `dependencies` in package.json, no peer warnings that break install.

- [ ] **Step 2: Add the memoized pin helper**

Append to `frontend/src/lib/map-markers.js` after `pinDataUri`:

```js
const pinCache = new Map()

/**
 * Memoized pin + data-URI per color/selected pair. Marker icons repeat across
 * hundreds of buildings — caching lets the browser reuse one decoded image
 * instead of re-encoding identical SVGs on every marker (re)build.
 */
export function buildingPinCached({ color, selected = false }) {
  const key = `${color}|${selected}`
  let cached = pinCache.get(key)
  if (!cached) {
    const pin = buildingPin({ color, selected })
    cached = { ...pin, url: pinDataUri(pin) }
    pinCache.set(key, cached)
  }
  return cached
}
```

- [ ] **Step 3: Verify build**

Run: `cd "/Users/gazon/Documents/Network graph map/frontend" && npm run build`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
cd "/Users/gazon/Documents/Network graph map/frontend"
git add package.json package-lock.json src/lib/map-markers.js
git commit -m "feat: markerclusterer dependency + memoized pin icons"
```

---

### Task 2: Marker diffing + clustering in GoogleBuildingsMap

**Files:**
- Modify: `frontend/src/components/map/google/GoogleBuildingsMap.js`

**Interfaces:**
- Consumes: `buildingPinCached({ color, selected })` from Task 1; `MarkerClusterer` from `@googlemaps/markerclusterer`; existing `buildingColor(building)`.
- Produces: same component contract as before (`{ buildings, zones, selectedId, onSelect }` props) — no caller changes.

- [ ] **Step 1: Add imports and module-level cluster renderer**

Replace the import of `buildingPin, pinDataUri` and add the clusterer import at the top of `GoogleBuildingsMap.js`:

```js
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { buildingPinCached, DECLUTTER_MAP_STYLE } from '@/lib/map-markers'
```

Add below `ZONE_DETAIL_ZOOM`:

```js
// Cluster bubble: fiber-emerald disc with a soft halo and white count,
// sized up slightly for bigger counts (Design.md palette).
const clusterRenderer = {
  render({ count, position }) {
    const size = count < 10 ? 44 : count < 100 ? 52 : 60
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 60 60">
  <circle cx="30" cy="30" r="28" fill="#10b981" fill-opacity="0.25"/>
  <circle cx="30" cy="30" r="20" fill="#10b981" stroke="#ffffff" stroke-width="3"/>
  <text x="30" y="31" fill="#ffffff" font-family="Inter, sans-serif" font-size="16" font-weight="700" text-anchor="middle" dominant-baseline="central">${count}</text>
</svg>`
    return new google.maps.Marker({
      position,
      icon: {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
        scaledSize: new google.maps.Size(size, size),
        anchor: new google.maps.Point(size / 2, size / 2),
      },
      // Clusters sit above raw pins so counts stay readable.
      zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
    })
  },
}

const pinIcon = (building, selected) => {
  const pin = buildingPinCached({ color: buildingColor(building), selected })
  return {
    url: pin.url,
    scaledSize: new google.maps.Size(pin.width, pin.height),
    anchor: new google.maps.Point(pin.anchorX, pin.anchorY),
  }
}
```

- [ ] **Step 2: Add refs and create the clusterer with the map**

Inside the component, alongside the existing refs:

```js
  const clustererRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  const selectedIdRef = useRef(selectedId)
  const prevSelectedRef = useRef(null)
  onSelectRef.current = onSelect
```

In the map-init effect, after `mapRef.current = new Map(...)` and before `setReady(true)`:

```js
      clustererRef.current = new MarkerClusterer({
        map: mapRef.current,
        markers: [],
        renderer: clusterRenderer,
      })
```

And extend its cleanup (before `mapRef.current = null`):

```js
      clustererRef.current?.clearMarkers()
      clustererRef.current = null
```

- [ ] **Step 3: Replace the rebuild effect with a diffing sync effect**

Delete the whole existing markers effect (`useEffect` with deps `[buildings, selectedId, onSelect, ready]`, currently lines 145-183) and replace with:

```js
  // Diff markers against the buildings prop — never tear down the world.
  // Selection is handled in its own effect so a tap only re-icons two pins.
  useEffect(() => {
    const map = mapRef.current
    const clusterer = clustererRef.current
    if (!map || !clusterer || !ready) return

    const markers = markersRef.current
    const seen = new Set()
    let changed = false

    buildings.forEach((building) => {
      seen.add(building.id)
      const selected = building.id === selectedIdRef.current
      const key = `${buildingColor(building)}|${selected}`
      let marker = markers.get(building.id)

      if (!marker) {
        marker = new google.maps.Marker({
          position: { lat: building.latitude, lng: building.longitude },
          icon: pinIcon(building, selected),
          zIndex: selected ? 1000 : 1,
        })
        marker.addListener('click', () => {
          onSelectRef.current(marker.buildingData)
          map.panTo(marker.getPosition())
          if (map.getZoom() < 17) map.setZoom(17) // zoom in to the tapped building
        })
        marker.pinKey = key
        marker.buildingData = building
        markers.set(building.id, marker)
        clusterer.addMarker(marker, true)
        changed = true
        return
      }

      marker.buildingData = building
      const pos = marker.getPosition()
      if (pos.lat() !== building.latitude || pos.lng() !== building.longitude) {
        marker.setPosition({ lat: building.latitude, lng: building.longitude })
        changed = true
      }
      if (marker.pinKey !== key) {
        marker.setIcon(pinIcon(building, selected))
        marker.setZIndex(selected ? 1000 : 1)
        marker.pinKey = key
      }
    })

    markers.forEach((marker, id) => {
      if (seen.has(id)) return
      clusterer.removeMarker(marker, true)
      marker.setMap(null)
      markers.delete(id)
      changed = true
    })

    if (changed) clusterer.render()

    // Fit-to-all on first load (user decision) — later refetches keep the view.
    if (!fittedRef.current && buildings.length > 0) {
      const bounds = new google.maps.LatLngBounds()
      buildings.forEach((b) => bounds.extend({ lat: b.latitude, lng: b.longitude }))
      map.fitBounds(bounds, 48)
      fittedRef.current = true
    }
  }, [buildings, ready])

  // Selection: restyle only the previously- and newly-selected pins.
  useEffect(() => {
    selectedIdRef.current = selectedId
    if (!ready) return
    const markers = markersRef.current

    const restyle = (id, selected) => {
      const marker = markers.get(id)
      if (!marker?.buildingData) return
      marker.setIcon(pinIcon(marker.buildingData, selected))
      marker.setZIndex(selected ? 1000 : 1)
      marker.pinKey = `${buildingColor(marker.buildingData)}|${selected}`
    }

    if (prevSelectedRef.current && prevSelectedRef.current !== selectedId) {
      restyle(prevSelectedRef.current, false)
    }
    if (selectedId) restyle(selectedId, true)
    prevSelectedRef.current = selectedId
  }, [selectedId, ready])
```

Also update the unmount cleanup in the map-init effect: the old `markersRef.current.forEach((marker) => marker.setMap(null))` stays valid (markers detached from clusterer are safe to unmap) — keep it.

- [ ] **Step 4: Lint and build**

Run: `cd "/Users/gazon/Documents/Network graph map/frontend" && npm run lint && npm run build`
Expected: zero lint problems in `GoogleBuildingsMap.js` / `map-markers.js` (pre-existing errors elsewhere are known); build compiles.

- [ ] **Step 5: Commit**

```bash
cd "/Users/gazon/Documents/Network graph map/frontend"
git add src/components/map/google/GoogleBuildingsMap.js
git commit -m "perf: diff map markers instead of rebuilding; cluster at low zoom"
```

---

### Task 3: Browser verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: running frontend dev server + backend on :4090; seeded admin login `admin@isp.local` / `ChangeMe123!`.

- [ ] **Step 1: Confirm dev servers**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4090/api/v1/health` (expect 200). Check the frontend dev port (usually 3000): `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`. If the frontend isn't running, start one owned by us: `nohup npm run dev -- -p 3477 &` (never touch the user's).

- [ ] **Step 2: Verify in the browser (chrome-devtools MCP)**

1. Open the app, log in as admin, go to `/map`.
2. Zoom out until buildings collapse → emerald numbered cluster bubbles appear.
3. Click a cluster → map zooms in, cluster splits.
4. Click an individual building pin → it enlarges with halo (selected), other pins DO NOT blink/disappear.
5. Toggle "Buildings" off/on in the legend → markers vanish/return.
6. Screenshot the clustered view for the report.

- [ ] **Step 3: Clean up**

Kill only the frontend server we started (by PID), if any.

---

## Self-Review Notes

- **Spec coverage:** diffing (T2 sync effect), selection restyle-only (T2 selection effect), onSelect ref (T2), stale-closure fix via `marker.buildingData` (T2), icon cache (T1), clusterer with batch noDraw + single render (T2), emerald renderer (T2), zones untouched, cleanup on unmount (T2), verification list matches spec (T3).
- **Type consistency:** `buildingPinCached` returns `{...pin, url}` (T1) and T2's `pinIcon` reads `.url/.width/.height/.anchorX/.anchorY`; `marker.pinKey`/`marker.buildingData` names consistent across both T2 effects.
- **No placeholders.**
