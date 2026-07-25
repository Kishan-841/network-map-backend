# Phase 6 – Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin section per PRD Phase 6 — manage zones, users, building types; change building statuses (user decision: statuses stay system-defined); KPI dashboard (total buildings, per-status counts, total home pass, total permission cost).

**Architecture:** Zones gain a service + full CRUD (delete blocked while buildings reference the zone). `BuildingType` becomes a DB table (migration + seed from the static list); the add-building form loads types from the API. Building status changes are a dedicated `PATCH /buildings/:id/status` (ADMIN/MANAGER). Stats live in their own module (`stats`) using Prisma aggregates. Frontend adds an `/admin` route group (role-gated), KPI cards per Design.md ("large numbers, minimal text"), and management pages built from the design system.

**Tech Stack:** Existing stack; no new dependencies.

## Global Constraints

- Management APIs: `requireRole('ADMIN', 'MANAGER')` — except user create/update which stays ADMIN-only (existing routes).
- KPIs, verbatim from PRD: Total Buildings, Feasible, Pending (permission), Rejected, Total Home Pass, Total Permission Cost. (Survey Pending shown too — it's a real status.)
- Zone delete with buildings referencing it → 409 CONFLICT.
- BuildingType delete/rename never mutates existing `details.buildingType` strings (historical data stays).
- `/admin` UI visible only to ADMIN/MANAGER (nav + client-side layout gate); server routes are the real enforcement.
- Design language: existing tokens/components (`PageHeader`, `StatusBadge`, `Button`, `Input/Select`, `rounded-card`, `shadow-soft`). Dashboard cards: large tabular numbers, no charts inside cards.
- Commit after every task.

---

### Task 1: Backend — zones CRUD with delete guard

**Files:** Create `backend/src/modules/zones/zone.service.js`, `backend/src/modules/zones/zone.schemas.js`; Modify `zone.repository.js`, `zone.controller.js`, `zone.routes.js`; Test `backend/tests/zone.service.test.js`.

**Interfaces:** `createZoneService({ zoneRepository })` → `createZone({ name, city })` (409 duplicate name), `updateZone(id, data)` (404 missing), `deleteZone(id)` (404 missing, 409 when `countBuildings(id) > 0`). Repository adds `findById`, `findByName`, `create`, `update`, `delete`, `countBuildings(zoneId)`. Routes: `POST/PATCH/DELETE` under `requireRole('ADMIN','MANAGER')`. `zoneSchema = { name: z.string().min(1).max(100), city: z.string().min(1).max(100) }` (partial for PATCH).

Test cases (fake repo): creates zone; 409 on duplicate name; 404 update missing; deletes empty zone; 409 delete when buildings exist.

---

### Task 2: Backend — BuildingType table, seed, CRUD

**Files:** Modify `backend/prisma/schema.prisma` (+`BuildingType` model), `backend/prisma/seed.js` (seed Residential/Commercial/Mixed Use/Industrial); Create `backend/src/modules/building-types/` (repository/service/schemas/controller/routes); Modify `backend/src/app.js`; Test `backend/tests/building-type.service.test.js`.

**Interfaces:** Model `BuildingType { id, name @unique, createdAt }`. Routes: `GET /api/v1/building-types` (any auth), `POST`, `PATCH /:id`, `DELETE /:id` (ADMIN/MANAGER). Service: `createType({ name })` 409 duplicate, `renameType(id, { name })`, `deleteType(id)` — deletes freely (constraint above).

Steps: migration `npx prisma migrate dev --name building-types`, seed, TDD service, wire routes.

---

### Task 3: Backend — building status update

**Files:** Modify `building.service.js`, `building.schemas.js`, `building.controller.js`, `building.routes.js`; Test extend `backend/tests/building.service.test.js`.

**Interfaces:** `updateStatus(id, { feasibleStatus?, surveyStatus? })` — 404 missing building; repository `update(id, data)` (`prisma.building.update` with `fullInclude`). Route: `PATCH /buildings/:id/status`, `requireRole('ADMIN','MANAGER')`, schema requires at least one field:

```js
export const updateStatusSchema = z
  .object({
    feasibleStatus: z.enum(['FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING']).optional(),
    surveyStatus: z.enum(['PENDING', 'COMPLETED']).optional(),
  })
  .refine((data) => data.feasibleStatus || data.surveyStatus, {
    message: 'Provide at least one status field',
  })
```

Route must be declared before generic `/:id` handlers remain unaffected (distinct path, but keep above `/:id/photos` grouping for readability).

Test cases: updates feasibleStatus; 404 unknown id.

---

### Task 4: Backend — dashboard stats

**Files:** Create `backend/src/modules/stats/stats.repository.js`, `stats.service.js`, `stats.controller.js`, `stats.routes.js`; Modify `app.js`; Test `backend/tests/stats.service.test.js`.

**Interfaces:** `GET /api/v1/stats/dashboard` (ADMIN/MANAGER) →

```json
{ "totalBuildings": 5, "byStatus": { "FEASIBLE": 1, "PERMISSION_PENDING": 1, "REJECTED": 1, "SURVEY_PENDING": 2 }, "totalHomePass": 48, "totalPermissionCost": 5000 }
```

Repository: `countsByStatus()` (groupBy feasibleStatus), `sumHomePass()`, `sumPermissionCost()`, `countBuildings()`. Service normalizes: every enum key present (0 default), Decimal → Number, null sums → 0.

Test cases (fake repo): assembles all keys with zero-defaults; converts Decimal-ish string to number.

---

### Task 5: Frontend — admin nav, layout gate, KPI dashboard

**Files:** Modify `frontend/src/components/ui/icons.js` (+`IconGauge` in house stroke style), `Sidebar.js`, `BottomNav.js` (Admin item for ADMIN/MANAGER); Create `frontend/src/app/(app)/admin/layout.js` (role gate → redirect `/map`), `frontend/src/app/(app)/admin/page.js` (KPI cards + links to management pages), `frontend/src/hooks/useDashboardStats.js`.

KPI cards: PRD's six numbers; large tabular-nums values, small muted labels; status cards tinted with signal colors; permission cost formatted with `Intl.NumberFormat`.

---

### Task 6: Frontend — zones & building-types management

**Files:** Create `frontend/src/app/(app)/admin/zones/page.js`, `frontend/src/app/(app)/admin/building-types/page.js`, shared `frontend/src/components/admin/CrudList.js` (card list + inline add form + edit/delete actions, confirm on delete, error surface).

---

### Task 7: Frontend — users management

**Files:** Create `frontend/src/app/(app)/admin/users/page.js` — list users (name, email, role chip, active state), add-user form (name/email/password/role — password policy errors surface from API), toggle active, change role. ADMIN-only actions disabled for MANAGER (list is visible).

---

### Task 8: Frontend — status changer + dynamic building types

**Files:** Create `frontend/src/components/buildings/StatusChanger.js` (Select of feasible statuses + survey status toggle, PATCH on change, ADMIN/MANAGER only) wired into `buildings/[id]/page.js`; Create `frontend/src/hooks/useBuildingTypes.js`; Modify `DetailsForm.js` to use it instead of `BUILDING_TYPES` constant (remove from `constants.js`).

---

### Task 9: End-to-end verification & finish

Full backend suite; API checks (zones CRUD + 409s, building-types CRUD, status PATCH, stats numbers vs seeded data, role 403s for surveyor); frontend routes 200; finish branch.
