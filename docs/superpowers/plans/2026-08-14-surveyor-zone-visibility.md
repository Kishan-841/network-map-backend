# Surveyor Zone Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surveyors see every building in their assigned zones (plus their own buildings anywhere), in the list, detail view, nearby duplicate check, and dashboard stats — so admin-added buildings stop getting duplicated.

**Architecture:** The read-scope Prisma fragment `{ OR: [{ zoneId: { in: assignedIds } }, { createdById: actor.id }] }` replaces the forced `createdById` in `building.service.js` (list via `where.AND` because search owns the top-level `OR`; detail and nearby compare `building.zoneId` against the id list) and in `stats.service.js` (which gains a `userRepository` dependency). Write rules are untouched.

**Tech Stack:** Express 5 / Prisma 6 (plain JS), vitest + supertest.

**Spec:** `backend/docs/superpowers/specs/2026-08-14-surveyor-zone-visibility-design.md`

## Global Constraints

- Backend is plain JavaScript — no TypeScript.
- Write rules unchanged: create-in-assigned-zones, own-photos-only, no permission records, no edit/delete for surveyors.
- Buildings outside assigned zones stay fully masked in nearby results (existing privacy test `strips ALL sensitive fields` must keep passing with an unassigned-zone fixture).
- All work in `backend/`; no schema changes, no frontend changes.

---

### Task 1: Zone-or-own scope in the building service (list, detail, nearby)

**Files:**
- Modify: `backend/src/modules/buildings/building.service.js:69` (list), `:113-120` (getBuilding), `:155-203` (findNearby)
- Test: `backend/tests/building-scope.service.test.js` (update in place)

**Interfaces:**
- Consumes: existing `userRepository.assignedZoneIds(userId)` → `Promise<string[]>` (already injected into `createBuildingService`).
- Produces: `listBuildings` emits `where.AND = [{ OR: [{ zoneId: { in: assigned } }, { createdById: actor.id }] }]` for surveyors; `getBuilding`/`findNearby` treat assigned-zone buildings as visible. Task 3's route test relies on these.

- [ ] **Step 1: Update the scope tests**

In `backend/tests/building-scope.service.test.js`:

Give the fixtures zones — replace the `own` / `foreign` consts:

```js
const own = {
  id: 'b1',
  createdById: 'u-surv',
  zoneId: 'z1',
  buildingName: 'Mine',
  latitude: 18.5,
  longitude: 73.8,
  placeId: null,
}
// Foreign building in an UNASSIGNED zone — stays invisible/masked.
const foreign = {
  id: 'b2',
  createdById: 'u-other',
  zoneId: 'z9',
  buildingName: 'Theirs',
  latitude: 18.5001,
  longitude: 73.8001,
  placeId: null,
}
// Foreign building in the surveyor's ASSIGNED zone — now visible (the fix).
const foreignInZone = {
  id: 'b3',
  createdById: 'u-admin',
  zoneId: 'z1',
  buildingName: 'AdminAdded',
  latitude: 18.5002,
  longitude: 73.8002,
  placeId: null,
}
```

In `makeService`, default `buildings = [own, foreign, foreignInZone]` and simplify the fake `list` (the where shape is asserted, not simulated):

```js
      list: async (where) => {
        lastWhere = where
        return buildings
      },
```

Replace the first test (`forces createdById for surveyors…`) with:

```js
  it('scopes surveyors to assigned zones plus their own buildings', async () => {
    const { service, whereUsed } = makeService({ assigned: ['z1'] })
    await service.listBuildings({}, surveyor)
    expect(whereUsed().createdById).toBeUndefined()
    expect(whereUsed().AND).toEqual([
      { OR: [{ zoneId: { in: ['z1'] } }, { createdById: 'u-surv' }] },
    ])
  })

  it('composes surveyor scope with search (search keeps the top-level OR)', async () => {
    const { service, whereUsed } = makeService({ assigned: ['z1'] })
    await service.listBuildings({ search: 'abc' }, surveyor)
    expect(whereUsed().OR).toHaveLength(3) // name/address/zone search clauses
    expect(whereUsed().AND[0].OR).toEqual([
      { zoneId: { in: ['z1'] } },
      { createdById: 'u-surv' },
    ])
  })
```

Replace the `404s surveyor access to a foreign building` test with:

```js
  it('404s foreign buildings in unassigned zones, allows assigned-zone ones', async () => {
    const { service } = makeService({ assigned: ['z1'] })
    await expect(service.getBuilding('b2', surveyor)).rejects.toMatchObject({ status: 404 })
    await expect(service.getBuilding('b3', surveyor)).resolves.toMatchObject({ id: 'b3' })
    await expect(service.getBuilding('b1', surveyor)).resolves.toMatchObject({ id: 'b1' })
    await expect(service.getBuilding('b2', admin)).resolves.toMatchObject({ id: 'b2' })
  })
```

Replace the `masks foreign building names…` test with:

```js
  it('masks only unassigned-zone buildings in nearby results for surveyors', async () => {
    const { service } = makeService({ assigned: ['z1'] })
    const forSurveyor = await service.findNearby(
      { latitude: 18.5, longitude: 73.8, radiusMeters: 500, name: 'Mine' },
      surveyor,
    )
    expect(forSurveyor.find((b) => b.id === 'b1').buildingName).toBe('Mine')
    expect(forSurveyor.find((b) => b.id === 'b3').buildingName).toBe('AdminAdded')
    expect(forSurveyor.find((b) => b.id === 'b2').buildingName).toBeNull()
    const forAdmin = await service.findNearby(
      { latitude: 18.5, longitude: 73.8, radiusMeters: 500 },
      admin,
    )
    expect(forAdmin.find((b) => b.id === 'b2').buildingName).toBe('Theirs')
  })
```

The `strips ALL sensitive fields` test already uses `zoneId: 'z-secret'` (unassigned) on its rich fixture — it must keep passing untouched. In that same test the default fixture set changes to include `foreignInZone`; its assertions only reference `b1`/`b2`, so no edits are needed.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run tests/building-scope.service.test.js`
Expected: FAIL — new scope/detail/nearby assertions (old behavior still forces `createdById` and masks `b3`).

- [ ] **Step 3: Implement the service changes**

In `building.service.js`:

`listBuildings` — replace `if (actor?.role === 'SURVEYOR') where.createdById = actor.id` with:

```js
      // Surveyors see their assigned zones plus their own buildings — via AND
      // because `search` below owns the top-level OR (spec 2026-08-14).
      if (actor?.role === 'SURVEYOR') {
        const assigned = await userRepository.assignedZoneIds(actor.id)
        where.AND = [{ OR: [{ zoneId: { in: assigned } }, { createdById: actor.id }] }]
      }
```

`getBuilding` — replace the whole method with:

```js
    async getBuilding(id, actor) {
      const building = await buildingRepository.findById(id)
      if (!building) throw ApiError.notFound('Building not found')
      // 404 (not 403) for out-of-scope buildings: don't leak existence.
      if (actor?.role === 'SURVEYOR' && building.createdById !== actor.id) {
        const assigned = await userRepository.assignedZoneIds(actor.id)
        if (!assigned.includes(building.zoneId)) throw ApiError.notFound('Building not found')
      }
      return building
    },
```

`findNearby` — after the `withinRadius` placeId block and before the `return withinRadius.map(...)`, add:

```js
      const assigned =
        actor?.role === 'SURVEYOR' ? await userRepository.assignedZoneIds(actor.id) : null
```

and change the masking condition from
`if (actor?.role === 'SURVEYOR' && building.createdById !== actor.id) {` to:

```js
          if (
            actor?.role === 'SURVEYOR' &&
            building.createdById !== actor.id &&
            !assigned.includes(building.zoneId)
          ) {
```

(The comment above it about not leaking foreign buildings stays — it now applies only to unassigned zones.)

- [ ] **Step 4: Run the buildings test files**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run tests/building-scope.service.test.js tests/building-list.service.test.js tests/building-nearby.service.test.js tests/building.service.test.js`
Expected: all pass. If `building-list` or `building-nearby` fakes lack `assignedZoneIds`, add `userRepository: { assignedZoneIds: async () => [] }` to their service construction — do not weaken their assertions.

- [ ] **Step 5: Commit**

```bash
cd "/Users/gazon/Documents/Network graph map/backend"
git add tests/building-scope.service.test.js src/modules/buildings/building.service.js tests/building-list.service.test.js tests/building-nearby.service.test.js
git commit -m "feat: surveyors see assigned-zone buildings in list, detail, nearby"
```

---

### Task 2: Zone-or-own scope in dashboard stats

**Files:**
- Modify: `backend/src/modules/stats/stats.service.js` (factory + `buildingWhere`), `backend/src/modules/stats/stats.controller.js` (inject userRepository)
- Test: `backend/tests/stats-scope.service.test.js` (update in place)

**Interfaces:**
- Consumes: `userRepository.assignedZoneIds(userId)` → `Promise<string[]>` from `../users/user.repository.js`.
- Produces: `createStatsService({ statsRepository, userRepository })` — new second dependency; surveyor KPI where becomes `{ OR: [{ zoneId: { in: assigned } }, { createdById: actor.id }] }`.

- [ ] **Step 1: Update the stats scope tests**

In `backend/tests/stats-scope.service.test.js`, add after `fakeStatsRepo`:

```js
const fakeUserRepo = (zones = ['z1']) => ({ assignedZoneIds: async () => zones })

const SURVEYOR_SCOPE = {
  OR: [{ zoneId: { in: ['z1'] } }, { createdById: 'u-surv' }],
}
```

Update the two surveyor tests (admin tests keep constructing without `userRepository` — the admin path never touches it):

```js
  it('scopes all KPI queries to assigned zones + own and omits charts', async () => {
    const repo = fakeStatsRepo()
    const result = await createStatsService({
      statsRepository: repo,
      userRepository: fakeUserRepo(['z1']),
    }).getDashboardStats({ id: 'u-surv', role: 'SURVEYOR' })
    expect(repo.wheres.count).toEqual(SURVEYOR_SCOPE)
    expect(repo.wheres.homePass).toEqual({ building: SURVEYOR_SCOPE })
    // Charts are admin/manager only.
    expect(result.byOperator).toEqual([])
    expect(result.overTime).toEqual([])
    expect(repo.calls.byOperator).toBe(0)
    expect(repo.calls.overTime).toBe(0)
  })

  it('combines surveyor scope AND operator filter', async () => {
    const repo = fakeStatsRepo()
    await createStatsService({
      statsRepository: repo,
      userRepository: fakeUserRepo(['z1']),
    }).getDashboardStats({ id: 'u-surv', role: 'SURVEYOR' }, { operatorId: 'op1' })
    expect(repo.wheres.count).toEqual({ ...SURVEYOR_SCOPE, zone: { operatorId: 'op1' } })
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run tests/stats-scope.service.test.js`
Expected: FAIL — surveyor wheres still `{ createdById: 'u-surv' }`.

- [ ] **Step 3: Implement**

`stats.service.js` — change the factory signature and the scoped where:

```js
export function createStatsService({ statsRepository, userRepository }) {
```

and replace `if (scoped) buildingWhere.createdById = actor.id` with:

```js
      if (scoped) {
        // Same zone-or-own read scope the buildings list uses (spec 2026-08-14).
        const assigned = await userRepository.assignedZoneIds(actor.id)
        buildingWhere.OR = [{ zoneId: { in: assigned } }, { createdById: actor.id }]
      }
```

`stats.controller.js` — inject the dependency:

```js
import { createStatsService } from './stats.service.js'
import { statsRepository } from './stats.repository.js'
import { userRepository } from '../users/user.repository.js'

const statsService = createStatsService({ statsRepository, userRepository })
```

- [ ] **Step 4: Run stats tests**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run tests/stats-scope.service.test.js tests/stats.service.test.js tests/stats.route.test.js`
Expected: all pass (`stats.service.test.js` uses admin/manager actors, untouched; if it constructs surveyor cases, give it `fakeUserRepo`-style stubs the same way).

- [ ] **Step 5: Commit**

```bash
cd "/Users/gazon/Documents/Network graph map/backend"
git add tests/stats-scope.service.test.js src/modules/stats/stats.service.js src/modules/stats/stats.controller.js
git commit -m "feat: dashboard stats follow surveyor zone-or-own scope"
```

---

### Task 3: Route-level proof of the user's scenario + full suite

**Files:**
- Test: `backend/tests/building-visibility.route.test.js` (create)

**Interfaces:**
- Consumes: `DELETE`-free read routes; real dev DB via `prisma`; JWT signing as in `building-update.route.test.js`. User model fields: `name`, `email` (unique), `passwordHash`, `role`, relation `assignedZones` (connect by zone id).

- [ ] **Step 1: Write the integration test (the exact reported bug)**

Create `backend/tests/building-visibility.route.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: '1h' })

// The reported bug: admin adds a building in Wakad; the surveyor assigned to
// Wakad can't see it and adds a duplicate.
describe('surveyor sees admin-added buildings in assigned zones', () => {
  const stamp = Date.now()
  let zone
  let surveyor
  let building

  beforeAll(async () => {
    zone = await prisma.zone.findFirst()
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    surveyor = await prisma.user.create({
      data: {
        name: 'Visibility Test Surveyor',
        email: `vis-test-${stamp}@test.local`,
        passwordHash: 'not-a-real-hash',
        role: 'SURVEYOR',
        assignedZones: { connect: { id: zone.id } },
      },
    })
    building = await prisma.building.create({
      data: {
        buildingName: `AdminAdded-${stamp}`,
        formattedAddress: '1 Visibility St',
        latitude: 18.51,
        longitude: 73.81,
        zoneId: zone.id,
        createdById: admin.id,
      },
    })
  })

  afterAll(async () => {
    await prisma.building.delete({ where: { id: building.id } })
    await prisma.user.delete({ where: { id: surveyor.id } })
  })

  it('lists the admin-added building for the assigned surveyor', async () => {
    const res = await request(createApp())
      .get('/api/v1/buildings?pageSize=500')
      .set('Authorization', `Bearer ${tokenFor(surveyor)}`)
    expect(res.status).toBe(200)
    const ids = res.body.data.items.map((b) => b.id)
    expect(ids).toContain(building.id)
  })

  it('serves the detail page for the admin-added building', async () => {
    const res = await request(createApp())
      .get(`/api/v1/buildings/${building.id}`)
      .set('Authorization', `Bearer ${tokenFor(surveyor)}`)
    expect(res.status).toBe(200)
    expect(res.body.data.buildingName).toBe(`AdminAdded-${stamp}`)
  })

  it('returns it unmasked in the nearby duplicate check', async () => {
    const res = await request(createApp())
      .get('/api/v1/buildings/nearby?latitude=18.51&longitude=73.81&radius=200')
      .set('Authorization', `Bearer ${tokenFor(surveyor)}`)
    expect(res.status).toBe(200)
    const hit = res.body.data.find((b) => b.id === building.id)
    expect(hit.buildingName).toBe(`AdminAdded-${stamp}`)
    expect(hit.masked).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the new route test**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run tests/building-visibility.route.test.js`
Expected: PASS (implementation landed in Tasks 1-2). If it fails, fix the implementation — not the test.

- [ ] **Step 3: Run the full backend suite**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd "/Users/gazon/Documents/Network graph map/backend"
git add tests/building-visibility.route.test.js
git commit -m "test: route-level proof surveyors see admin-added zone buildings"
```

---

## Self-Review Notes

- **Spec coverage:** list AND-composition (T1), detail zone-or-own (T1), nearby unmask-assigned/mask-unassigned incl. preserved privacy test (T1), stats scope + userRepository injection (T2), write rules untouched (no write path edited), route-level reproduction of the reported bug (T3).
- **Type consistency:** scope fragment `{ OR: [{ zoneId: { in: [...] } }, { createdById }] }` identical in T1 (`where.AND[0]`) and T2 (`buildingWhere.OR`); `createStatsService({ statsRepository, userRepository })` matches controller injection; `assignedZoneIds` name matches `user.repository.js:23`.
- **No placeholders.**
