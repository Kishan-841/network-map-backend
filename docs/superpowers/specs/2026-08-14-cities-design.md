# Cities

**Date:** 2026-08-14
**Status:** Approved

## Goal

Introduce City as a first-class entity forming the hierarchy
**City → Operator → Zone → Building**, and add a city filter to the
Dashboard and the Buildings tab (mirroring the existing operator filter one
level up).

## Current state

- `Operator.city` is an optional free-text string; `Zone.city` is a required
  free-text string. No City table. Typos create phantom "cities".
- Buildings/stats already filter by `operatorId` through
  `where.zone = { operatorId }` — the city filter reuses this exact pattern.

## Decisions

- **New `City` model** (`id`, unique `name`, timestamps). Operators get
  `cityId` (nullable, `onDelete: SetNull` — deleting a city never deletes
  operators, they just become city-less, same semantics as Operator→Zone).
- **Migration backfills** existing distinct `Operator.city` strings
  (trimmed, case-preserving; matched case-insensitively) into City rows,
  links `Operator.cityId`, then **drops the old `Operator.city` column**.
  Hand-written SQL in a Prisma migration (`gen_random_uuid()` ids are fine —
  `@default(cuid())` only governs Prisma-created rows).
- **`Zone.city` string stays untouched.** It's a label used by zone admin and
  bulk upload; the hierarchy the user asked for hangs cities above operators,
  not zones.
- **Filter semantics:** a city filter means "buildings whose zone's operator
  belongs to that city": `where.zone = { operator: { cityId } }`. City and
  operator filters compose as AND.

## Backend

### Cities module (`src/modules/cities/`)

Mirrors the operators module: repository, service, schemas, controller,
routes.

- `GET /api/v1/cities` — list with zone/operator counts; ADMIN + MANAGER
  (same gating as `/operators`, since the filter UI is admin/manager-only).
- `POST /api/v1/cities` — ADMIN; body `{ name }` (trimmed, unique,
  conflict → 409).
- `PATCH /api/v1/cities/:id` — ADMIN; rename.
- `DELETE /api/v1/cities/:id` — ADMIN; operators are SetNull'd.
- Audit entries for create/update/delete (existing `audit()` middleware).

### Operator changes

- Schemas: `cityId: z.string().nullish()` replaces the `city` string on
  create/update; service validates the city exists when set.
- List/read include `city: { select: { id, name } }`.
- Operator search also matches the linked city name
  (`city: { name: { contains: search, mode: 'insensitive' } }`).
- **Bulk upload:** the CSV `city` column now upserts a City by
  case-insensitive name and links the operator (instead of storing a string).

### Filters

- **Buildings list:** `cityId` query param (schemas + service):
  `if (cityId) where.zone = { ...where.zone, operator: { cityId } }` —
  composes with `operatorId`.
- **Stats:** `cityId` query param; applied wherever `operatorId` is today:
  KPI `buildingWhere.zone`, `countZones` where, and the `buildingsOverTime`
  raw SQL (gains a `LEFT JOIN "Operator"` + cityId condition). The
  `byOperator` chart keeps its current unfiltered behavior (parity with
  operatorId today).

## Frontend

- **Admin → Cities page** (`/admin/cities`): CrudList-based name-only CRUD,
  like building types. Sidebar/admin index entry added.
- **Admin → Operators page:** city free-text input becomes a city `<select>`
  fed by the cities API (empty option = no city).
- **Buildings tab:** City dropdown beside the existing operator dropdown
  (URL param `cityId`, same `router.replace` pattern). Selecting a city
  narrows the operator dropdown to that city's operators; picking an
  operator outside no city constraint is unaffected.
- **Dashboard:** City dropdown beside the operator dropdown; passes `cityId`
  to the stats API. Same narrowing behavior.
- `useCities()` hook mirroring `useOperators()`.
- Filters are visible to ADMIN/MANAGER only (same as the operator filter —
  the cities API is role-gated).

## Error handling

- Duplicate city name → 409 with the existing conflict error shape.
- Unknown `cityId` on operator create/update → 400.
- Filtering by a deleted cityId simply matches nothing (no error).

## Testing

- City service tests: CRUD, duplicate 409, delete SetNull behavior (fake
  repo asserting where/data shapes).
- Cities route tests: role gates (401 / SURVEYOR 403 / MANAGER can list but
  not create).
- Buildings list: `cityId` where-shape test; composes with `operatorId`.
- Stats: `cityId` filters KPI + zone wheres (fake repo shape assertions).
- Operator service: cityId validation, bulk-upload city upsert.
- Migration verified against dev DB (existing operator city strings become
  linked City rows; column dropped).

## Out of scope

- Linking `Zone.city` strings to the City table.
- City on buildings directly, map-tab city filter, surveyor-facing filters.
