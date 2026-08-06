# Map Layer Switcher (satellite / roadmap / hybrid) — Design

**Date:** 2026-08-06
**Status:** Approved

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Providers | Both, Google-first. Google native mapTypeId; Leaflet OSM/Esri imagery/Esri hybrid. |
| Control UI | Custom overlay chips (Map · Satellite · Hybrid) top-right, consistent on both providers/screens. |
| Defaults + persistence | Picker default Satellite; Map tab default Roadmap. Last choice remembered per context in localStorage. |

## Components (frontend only)

- **`src/components/map/MapLayerControl.js`** — presentational segmented control.
  Chips `Map | Satellite | Hybrid`; props `{ value, onChange }` where value is
  `'roadmap' | 'satellite' | 'hybrid'`. Absolutely positioned top-right, above
  the map (`z-[500]` over Leaflet panes / above Google tiles), design-system
  styling. Pointer events isolated so map drag doesn't fire underneath.
- **`src/lib/useMapLayer.js`** — `useMapLayer(context, defaultLayer)` returns
  `[layer, setLayer]`, persisting to `localStorage['map-layer:'+context]`
  (contexts: `'tab'`, `'picker'`). Reads the stored value on mount (falling back
  to `defaultLayer`); writes on change. SSR-safe (guards `window`).

## Provider wiring

Four existing components gain the control + layer state. Each renders
`<MapLayerControl value={layer} onChange={setLayer} />` inside the map container.

- **`google/GoogleBuildingsMap.js`** (`useMapLayer('tab','roadmap')`) and
  **`google/GoogleLocationPicker.js`** (`useMapLayer('picker','satellite')`):
  create the map with `mapTypeId: layer` (Google keys are literally
  `roadmap|satellite|hybrid`); an effect calls `map.setMapTypeId(layer)` when
  `layer` changes. `mapTypeControl` stays off (we render our own).
- **`leaflet/LeafletBuildingsMap.js`** (`'tab','roadmap'`) and
  **`leaflet/LeafletLocationPicker.js`** (`'picker','satellite'`): a shared
  `src/lib/leaflet-layers.js` exposes `createBaseLayer(map, layer)` returning the
  L.LayerGroup for a given key:
  - `roadmap`: OSM `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
  - `satellite`: Esri World Imagery
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
    (free, no key).
  - `hybrid`: the imagery layer plus Esri
    `Reference/World_Boundaries_and_Places` transparent overlay for street/place
    labels.
  A ref holds the active base layer group; on change the old group is removed and
  the new one added `{ pane: 'tilePane' }` so markers/zones (overlay panes) stay
  on top. Existing marker/zone/fit logic is untouched.

## Error handling / edges

- Unknown stored value → falls back to the context default.
- Esri tiles occasionally 404 at extreme zoom; Leaflet renders gaps gracefully
  (same as OSM today) — no special handling.
- The control must not intercept map gestures: `stopPropagation` on the control's
  pointer events; it sits in a corner, not over the pin.

## Testing

- eslint + production build.
- Live browser (dev = Leaflet): Map tab switches OSM ↔ satellite ↔ hybrid (tile
  URL changes) and the choice persists across reloads; add-building picker opens
  in satellite and switches. Verify markers/zones stay visible after a switch.
- Google path verified by code review of the `setMapTypeId` wiring; run against
  the Google key if it loads headlessly (production uses Google).

## Out of scope

- Terrain layer; per-user server-side layer preference; 3D/tilt.
