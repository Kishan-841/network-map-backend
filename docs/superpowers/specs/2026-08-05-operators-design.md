# Operators (grouping zones) + mapping import + filtering — Design

**Date:** 2026-08-05
**Status:** Approved

**Source sheet:** `operator wise Name.xlsx` — columns `Operator | Zone | City | Email`,
94 rows → 56 operators, 94 zones, 4 cities, 17 surveyors. Each zone belongs to
exactly one operator (clean 1→many); 12 surveyors span multiple operators.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Create vs match | One upload creates missing operators + zones and assigns surveyors. Existing ones reused. |
| Operator↔surveyor | Through zones — no direct surveyor↔operator link. Operator is a grouping layer on zones. |
| Filtering | Operator dropdown beside Zone; filters buildings via `zone.operatorId`; narrows the zone dropdown. Building→Operator is derived through Zone (no Building change). |
| Unknown emails | Skip + report "user not found". No auto-created accounts. |
| Assignment | Replace — each listed surveyor gets exactly the union of their sheet zones. |
| Admin surface | New Operators admin page; the mapping import lives there. |

## Schema

```prisma
model Operator {
  id        String   @id @default(cuid())
  name      String   @unique
  city      String?
  createdAt DateTime @default(now())
  zones     Zone[]
}

model Zone {
  // ...existing fields...
  operatorId String?
  operator   Operator? @relation(fields: [operatorId], references: [id])
}
```

Additive, nullable → existing zones unaffected. `Zone.operatorId` FK uses
`onDelete: SetNull` implicitly via optional relation (deleting an operator
detaches its zones rather than deleting them).

## Backend

New `src/modules/operators/` module (routes/controller/service/repository/schemas).

**CRUD (ADMIN, MANAGER read):**
- `GET /api/v1/operators` — list with `zoneCount` (name-ordered). Dual-response
  `?page` pagination + `search` (same convention as zones/users).
- `POST /api/v1/operators` — `{ name, city? }`.
- `PATCH /api/v1/operators/:id` — `{ name?, city? }`; 404 if missing.
- `DELETE /api/v1/operators/:id` — detaches zones (sets `operatorId = null`), then deletes.

**Import (`POST /api/v1/operators/import`, ADMIN):**
Body: `{ rows: [{ operator, zone, city, email }] }` (1–1000 rows; strings trimmed).
Service `importOperatorMapping(rows)`:
1. Load all operators + zones once. Resolve/create operators by name
   (case-insensitive), storing `city` on create.
2. Resolve/create zones by name (case-insensitive). Create → `{ city, operatorId }`.
   Existing zone → set `operatorId` if unset or different; leave `city` untouched.
3. Group emails → set of zone ids (union across their rows). Per email: find the
   SURVEYOR by case-insensitive email; if missing or not a surveyor, skip with
   reason; else `assignedZones: { set: ids }`.
Returns `{ operatorsCreated, zonesCreated, zonesLinked, surveyorsUpdated: [{email, zones}], skipped: [{email, reason}], totalRows }`.
Audit: route annotated `audit('Operator', 'MappingImport')` — one entry,
description `Operator mapping: A operators, B zones, C surveyors`.

**Filtering:**
- `building.schemas.listQuerySchema` gains `operatorId` (string). `listBuildings`
  where: `if (operatorId) where.zone = { operatorId }` (merged with any existing
  zone filter). Surveyor own-building scoping unchanged.
- `stats.getDashboardStats` unchanged for now (operator filter is list/map only).
- `zone.repository.list` / `paged` include `{ operator: { select: { id, name } } }`
  and accept an `operatorId` filter so the UI can narrow zones per operator.

## Frontend

- **Operators admin page** (`src/app/(app)/admin/operators/page.js`) — mirrors the
  zones page: search + paginated list (name, city, "N zones"), CRUD via a simple
  form, and an **Import mapping** button opening `ImportOperatorMappingModal`
  (Operator|Zone|City|Email; pick → preview → result via shared `spreadsheet.js`).
  Result lists created/linked counts + skipped emails.
- **Dashboard**: add an Operators card (admin-only) to the Manage section.
- **Zones page**: show each zone's operator name as a chip.
- **Map filter + buildings filter**: add an Operator `<Select>` beside Zone.
  Selecting an operator sets `operatorId` in the filter and narrows the Zone
  dropdown to `zones.filter(z => z.operatorId === operatorId)`. Clearing operator
  restores all zones. Buildings/map query passes `operatorId`.
- New hook `useOperators()` (list) for the dropdowns; zones already load via `useZones`.

## Testing

Backend (vitest): operator CRUD + dual-response list; import service (create
operators/zones, link existing zone, union-per-email replace, skip unknown/non-
surveyor, case-insensitive matching); building list `operatorId` filter (via zone
relation, with surveyor scoping intact); route auth (ADMIN-only import, 403
others). Frontend: eslint; live browser run uploading the real sheet, then
verifying the operator filter narrows zones and filters buildings.

## Out of scope

- Direct surveyor↔operator table; operator on the Building model; operator in
  dashboard stats; per-operator permissions.
