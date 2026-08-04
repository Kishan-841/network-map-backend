# Role-Based Zone Access & List UX — Design

**Date:** 2026-08-04
**Status:** Approved
**Source:** `User-access.md` (project root), adapted per decisions below.

## Overview

Surveyors get zone-scoped access: they see only zones assigned to them, create
buildings only in those zones, and see only buildings they created — across the
buildings list, map, and dashboard. Admins assign zones from the user form via a
searchable multi-select. Users and Zones lists gain pagination + search.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| MANAGER role | Unchanged — sees and manages everything. Zone scoping applies to SURVEYOR only. |
| Spec fields that don't exist (user phone, zone code, building number) | Skipped. Search uses existing fields only. |
| Scope depth | Surveyor sees own buildings everywhere (list, map, dashboard stats). Duplicate-nearby check still scans ALL buildings but masks other owners' building names. |
| Existing surveyors | Start with zero assigned zones; admin assigns manually. No backfill. |
| Enforcement layer | Service layer, actor-aware: services receive `{ id, role }` and apply restrictions inside the query. Never trust query params for scoping. |

## Schema

Implicit Prisma M2M (additive migration, no backfill):

```prisma
model User {
  // ...existing fields...
  assignedZones Zone[] @relation("UserAssignedZones")
}
model Zone {
  // ...existing fields...
  assignedUsers User[] @relation("UserAssignedZones")
}
```

`zoneIds` are stored only for SURVEYOR users; ignored for ADMIN/MANAGER.

## Backend access rules

All enforcement in services, keyed off the actor (`req.user` = `{ id, role }`):

- **Zones list** (`GET /zones`): SURVEYOR → only assigned zones (all its consumers
  — add-building flow, map filters, user form — scope automatically).
- **Buildings list** (`GET /buildings`): SURVEYOR → `where.createdById = actor.id`
  forced server-side (list, map, buildings tab). The `createdById` query param is
  ignored for surveyors.
- **Building detail** (`GET /buildings/:id`): SURVEYOR → 404 when
  `createdById !== actor.id` (404, not 403, to avoid existence leaks).
- **Building create** (`POST /buildings`): SURVEYOR → `zoneId` must be one of
  their assigned zones, else 403 `You are not assigned to this zone`.
- **Photo add** (`POST /buildings/:id/photos`): SURVEYOR → 403 on buildings they
  did not create. (Photo delete / status change already ADMIN/MANAGER only.)
- **Nearby duplicate check** (`GET /buildings/nearby`): unchanged global scan;
  for SURVEYOR the response masks `buildingName` to `null` on buildings created
  by others. UI shows "a building already exists here" for masked entries.
- **Dashboard stats** (`GET /stats/dashboard`): SURVEYOR → all KPIs computed
  over `createdById = actor.id` only.
- **`GET /auth/me`**: response gains `assignedZoneIds: string[]` (empty for
  non-surveyors).

Denied attempts return the standard error envelope and are captured by the
existing audit middleware (module Building/Zone, status FAILED).

## Users API

- `POST /users` and `PATCH /users/:id` accept optional `zoneIds: string[]`
  (max 200, each an existing zone id — invalid ids → 400). Stored only when the
  target user's role is SURVEYOR. On update, `zoneIds` **replaces** the full
  assignment set; omitting the field leaves assignments unchanged.
- `GET /users` adds `?page&pageSize&search&role`:
  - `search`: case-insensitive contains on name OR email.
  - `role`: exact enum filter.
  - **Dual response**: without `page` → plain array (backward compatible — the
    system-logs user dropdown relies on it), with user rows including
    `assignedZones: [{id, name}]`. With `page` → `{ items, total, page,
    pageSize, totalPages }` (pageSize default 50, max 100).

## Zones API

- `GET /zones` adds `?page&pageSize&search` with the same dual-response
  convention: no `page` → today's full array (role-scoped); with `page` →
  paginated envelope. `search`: case-insensitive contains on name OR city.

## Frontend

- **`ZoneMultiSelect`** (`src/components/admin/ZoneMultiSelect.js`): searchable
  multi-select — text input filters zones client-side as you type; selections
  render as removable chips. Props: `zones`, `selectedIds`, `onChange`.
- **User form modal** (admin users page): shows ZoneMultiSelect only when the
  form's role is SURVEYOR; sends `zoneIds` on create/save; pre-populates from
  the user's `assignedZones` on edit.
- **Users page**: debounced search box + role filter + DataTable pagination
  (50/page) via the paginated API form.
- **Zones page**: debounced search box + pagination controls on the zone list
  (existing card list, paged).
- **Surveyor UX**: no new screens. Scoped APIs shrink zone dropdowns, map,
  buildings list, and dashboard automatically. Add-building flow shows
  "No zones assigned to you yet — contact your admin" when the zone list is
  empty. Duplicate warnings display "Existing building" when `buildingName` is
  null (masked).

## Testing

Backend (vitest, fake repos + route tests):

- Zone list scoping by role; buildings list forced `createdById`; detail 404 for
  foreign buildings; create-in-unassigned-zone 403; photo-add 403 on foreign
  building; nearby masking (own name visible, others null); stats scoping.
- Users: zoneIds stored/replaced/ignored-for-non-surveyors; invalid zoneIds 400;
  pagination + search + role filter; dual response shapes.
- Zones: pagination + search; dual response shapes.
- `GET /auth/me` returns assignedZoneIds.

Frontend: eslint clean; live browser pass — assign zones via searchable picker,
then as the surveyor verify scoped zone dropdown, scoped map/list/dashboard,
blocked creation outside assigned zones, and users/zones pagination + search.

## Out of scope

- Manager zone scoping; phone/zone-code/building-number fields; per-permission
  matrices; reassigning building ownership; backfilling assignments.
