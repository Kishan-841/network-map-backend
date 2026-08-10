# Map Marker Performance (Diffing + Clustering)

**Date:** 2026-08-10
**Status:** Approved

## Problem

With 261 buildings (and growing), the production map lags badly around zoom.
Two root causes in `frontend/src/components/map/google/GoogleBuildingsMap.js`:

1. **Full rebuild storm.** The marker effect depends on
   `[buildings, selectedId, onSelect, ready]` and begins by destroying every
   marker and recreating all of them. Tapping a building changes `selectedId`
   → 261 markers are torn down and rebuilt *during* the tap's own
   `setZoom(17)` animation. Every refetch (search keystroke, filter change)
   does the same.
2. **Too many DOM nodes.** 261 individual legacy `google.maps.Marker`
   elements must be repositioned per animation frame during any zoom.

## Decisions

- **Incremental diffing:** markers persist across renders; only actual
  changes touch the map.
- **Clustering:** `@googlemaps/markerclusterer` (official Google library)
  groups nearby markers into numbered bubbles at low zoom.
- No backend or data-flow changes. Leaflet variant untouched (Google is the
  active provider in prod).

## Design

All changes in `GoogleBuildingsMap.js` (+ one dependency, + a small icon
cache in `lib/map-markers.js`).

### Marker diffing

Replace the single rebuild effect with:

- **Sync effect** (deps: `buildings`, `ready`) keyed by `building.id` on the
  existing `markersRef` Map:
  - New id → create marker, add to clusterer.
  - Missing id → remove from clusterer, `setMap(null)`, delete from Map.
  - Existing id → update position if lat/lng changed; update icon only if the
    computed pin (color + selected state) changed. Each marker caches its
    current `{ color, selected }` to make the comparison cheap.
  - Marker stores its latest building object (`marker.buildingData`) so the
    click listener never closes over a stale building.
- **Selection effect** (deps: `selectedId`): re-icon and re-zIndex only the
  previously-selected and newly-selected markers (tracked via a ref).
- **onSelect via ref:** click listeners call `onSelectRef.current(...)` so a
  changing callback prop never invalidates markers.

### Icon cache

`buildingPin`/`pinDataUri` results memoized in a module-level Map keyed by
`color|selected`. Bounded domain (a handful of status colors × 2), so no
eviction needed.

### Clustering

- Create one `MarkerClusterer` when the map initializes; markers are managed
  through `clusterer.addMarker(m, true)` / `removeMarker(m, true)` (noDraw)
  with a single `clusterer.render()` after each sync batch.
- Custom renderer draws cluster bubbles in the design system's emerald
  (`--fiber` #10b981 family): filled circle, white count text — consistent
  with Design.md tokens.
- Default behavior on cluster click (zoom into the cluster) is kept.
- Zone overlays/labels stay outside the clusterer (unchanged).
- Component unmount: `clusterer.clearMarkers()` + existing cleanup.

## Error handling

No new failure modes: clusterer is created only after `loadGoogleMaps()`
resolves; sync effect no-ops until `ready`.

## Testing / verification

- `npm run lint` + `npm run build` clean (changed files).
- Browser verification against the dev servers: markers persist when tapping
  a building (no blink), cluster bubbles appear zoomed out and expand on
  zoom-in, selection highlight still works, legend toggle still hides
  buildings.

## Out of scope

- `AdvancedMarkerElement` migration, viewport-based rendering.
- Leaflet map variant.
- Backend pagination/bounds queries.
