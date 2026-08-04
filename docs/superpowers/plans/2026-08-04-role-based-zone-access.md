# Role-Based Zone Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surveyors see only assigned zones and their own buildings everywhere (list, map, dashboard); admins assign zones via a searchable multi-select; users and zones lists gain pagination + search.

**Architecture:** Additive M2M (`User.assignedZones ↔ Zone.assignedUsers`). Enforcement lives in services which receive the actor (`req.user = { id, role }`) and bake restrictions into Prisma where-clauses. `GET /users` and `GET /zones` keep their legacy array shape unless `?page` is passed (dual response), so existing dropdown consumers don't break.

**Tech Stack:** Express 5 + Prisma 6 (JS ESM), zod 4, vitest + supertest; Next.js app router (JS).

**Spec:** `docs/superpowers/specs/2026-08-04-role-based-zone-access-design.md`

## Global Constraints

- SURVEYOR-only scoping; ADMIN/MANAGER behavior unchanged.
- Zone assignment stored only for SURVEYOR users; `zoneIds` on update **replaces** the set; omitted field = unchanged.
- Foreign building detail for surveyor → **404** (not 403). Create in unassigned zone → 403 `You are not assigned to this zone`.
- Nearby scan stays global; other owners' `buildingName` masked to `null` for surveyors (mask AFTER computing `similarName`).
- Dual response: no `page` param → legacy array; with `page` → `{ items, total, page, pageSize, totalPages }` (default 50, max 100).
- Search: users by name/email (+ `role` exact filter); zones by name/city. No phone/zone-code/building-number fields.
- Plain JS ESM, Prisma 6, `{ success, data }` envelope, `req.validatedQuery`, no sync setState in React effects.
- Never kill the user's dev servers. Branch: `feature/zone-access` in both repos.

---

### Task 1: Schema — User↔Zone M2M

**Files:**
- Modify: `prisma/schema.prisma` (User and Zone models)

**Interfaces:**
- Produces: `user.assignedZones` / `zone.assignedUsers` relation, usable via `prisma.user.update({ data: { assignedZones: { set: [...] } } })` and `prisma.zone.findMany({ where: { assignedUsers: { some: { id } } } })`.

- [ ] **Step 1: Add the relation to both models**

In `model User` add:

```prisma
  assignedZones Zone[] @relation("UserAssignedZones")
```

In `model Zone` add:

```prisma
  assignedUsers User[] @relation("UserAssignedZones")
```

- [ ] **Step 2: Migrate**

Run: `npx prisma migrate dev --name user_zone_assignment`
Expected: creates `_UserAssignedZones` join table; client regenerated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: user-zone assignment M2M"
```

---

### Task 2: Zone list scoping (actor-aware)

**Files:**
- Modify: `src/modules/zones/zone.repository.js`
- Modify: `src/modules/zones/zone.service.js`
- Modify: `src/modules/zones/zone.controller.js`
- Test: `tests/zone-scope.service.test.js`

**Interfaces:**
- Produces: `zoneRepository.listAssigned(userId)`; `zoneService.listZones(actor) -> Zone[]` (actor = `{ id, role }`). Controller `list` now calls `zoneService.listZones(req.user)`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { createZoneService } from '../src/modules/zones/zone.service.js'

const allZones = [{ id: 'z1' }, { id: 'z2' }, { id: 'z3' }]
const repo = {
  list: async () => allZones,
  listAssigned: async (userId) => (userId === 'u-surv' ? [allZones[1]] : []),
}

describe('listZones scoping', () => {
  it('returns all zones for ADMIN and MANAGER', async () => {
    const service = createZoneService({ zoneRepository: repo })
    expect(await service.listZones({ id: 'u-a', role: 'ADMIN' })).toHaveLength(3)
    expect(await service.listZones({ id: 'u-m', role: 'MANAGER' })).toHaveLength(3)
  })

  it('returns only assigned zones for SURVEYOR', async () => {
    const service = createZoneService({ zoneRepository: repo })
    const zones = await service.listZones({ id: 'u-surv', role: 'SURVEYOR' })
    expect(zones).toEqual([{ id: 'z2' }])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/zone-scope.service.test.js` → FAIL (`listZones` undefined).

- [ ] **Step 3: Implement**

`zone.repository.js` — add:

```js
  listAssigned: (userId) =>
    prisma.zone.findMany({
      where: { assignedUsers: { some: { id: userId } } },
      orderBy: { name: 'asc' },
    }),
```

`zone.service.js` — add to the returned object:

```js
    async listZones(actor) {
      if (actor?.role === 'SURVEYOR') return zoneRepository.listAssigned(actor.id)
      return zoneRepository.list()
    },
```

`zone.controller.js` — change `list` to:

```js
  async list(req, res, next) {
    try {
      const zones = await zoneService.listZones(req.user)
      res.json({ success: true, data: zones })
    } catch (err) {
      next(err)
    }
  },
```

- [ ] **Step 4: Run tests, then full suite**

Run: `npx vitest run tests/zone-scope.service.test.js` → PASS. `npm test` → all PASS (zones.route.test still passes — admin/surveyor token sees seeded zones? NOTE: that test uses a SURVEYOR token and expects ≥2 zones; it will now get []). **Update `tests/zones.route.test.js`**: change its token role from `'SURVEYOR'` to `'ADMIN'` (line ~8) — scoping is exactly the new intended behavior.

- [ ] **Step 5: Commit**

```bash
git add src/modules/zones tests/zone-scope.service.test.js tests/zones.route.test.js
git commit -m "feat: zone list scoped to assigned zones for surveyors"
```

---

### Task 3: Users API — zoneIds assign/replace + /auth/me

**Files:**
- Modify: `src/modules/users/user.schemas.js`, `user.repository.js`, `user.service.js`, `user.controller.js`
- Modify: `src/modules/auth/auth.controller.js` (me)
- Test: `tests/user-zones.service.test.js`

**Interfaces:**
- Produces: `userRepository.assignedZoneIds(userId) -> string[]`; `createUserService({ userRepository, zoneRepository })` — `createUser`/`updateUser` accept `zoneIds`; user rows include `assignedZones: [{id, name}]`; `GET /auth/me` data gains `assignedZoneIds`.
- Consumes: `zoneRepository.findById` (existing) — used via a new `countByIds`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import bcrypt from 'bcryptjs'
import { createUserService } from '../src/modules/users/user.service.js'

function fakeRepos({ users = [], zoneCount = (ids) => ids.length } = {}) {
  const calls = []
  return {
    calls,
    userRepository: {
      findByEmail: async (email) => users.find((u) => u.email === email) ?? null,
      findById: async (id) => users.find((u) => u.id === id) ?? null,
      create: async (data) => {
        calls.push(['create', data])
        return { id: 'new', ...data }
      },
      update: async (id, data) => {
        calls.push(['update', id, data])
        return { id, ...data }
      },
    },
    zoneRepository: { countByIds: async (ids) => zoneCount(ids) },
  }
}

const surveyorInput = {
  name: 'S',
  email: 's@isp.local',
  password: 'Passw0rd1',
  role: 'SURVEYOR',
}

describe('user zone assignment', () => {
  it('connects zones on surveyor create', async () => {
    const deps = fakeRepos()
    const service = createUserService(deps)
    await service.createUser({ ...surveyorInput, zoneIds: ['z1', 'z2'] })
    const [, data] = deps.calls.find(([op]) => op === 'create')
    expect(data.assignedZones).toEqual({ connect: [{ id: 'z1' }, { id: 'z2' }] })
  })

  it('ignores zoneIds for non-surveyors', async () => {
    const deps = fakeRepos()
    const service = createUserService(deps)
    await service.createUser({ ...surveyorInput, role: 'MANAGER', zoneIds: ['z1'] })
    const [, data] = deps.calls.find(([op]) => op === 'create')
    expect(data.assignedZones).toBeUndefined()
  })

  it('rejects unknown zone ids with 400', async () => {
    const deps = fakeRepos({ zoneCount: () => 0 })
    const service = createUserService(deps)
    await expect(
      service.createUser({ ...surveyorInput, zoneIds: ['nope'] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('replaces the set on update', async () => {
    const existing = {
      id: 'u1',
      email: 's@isp.local',
      role: 'SURVEYOR',
      passwordHash: bcrypt.hashSync('x', 4),
    }
    const deps = fakeRepos({ users: [existing] })
    const service = createUserService(deps)
    await service.updateUser('u1', { zoneIds: ['z9'] })
    const [, , data] = deps.calls.find(([op]) => op === 'update')
    expect(data.assignedZones).toEqual({ set: [{ id: 'z9' }] })
  })

  it('leaves assignments unchanged when zoneIds omitted', async () => {
    const existing = { id: 'u1', email: 's@isp.local', role: 'SURVEYOR' }
    const deps = fakeRepos({ users: [existing] })
    const service = createUserService(deps)
    await service.updateUser('u1', { name: 'New' })
    const [, , data] = deps.calls.find(([op]) => op === 'update')
    expect(data.assignedZones).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/user-zones.service.test.js` → FAIL.

- [ ] **Step 3: Implement**

`user.schemas.js` — add `zoneIds: z.array(z.string().min(1)).max(200).optional(),` to BOTH `createUserSchema` and the object inside `updateUserSchema` (before `.partial()`).

`user.repository.js` — replace `list` and add two methods:

```js
  list: () =>
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { assignedZones: { select: { id: true, name: true } } },
    }),
  assignedZoneIds: (userId) =>
    prisma.zone
      .findMany({ where: { assignedUsers: { some: { id: userId } } }, select: { id: true } })
      .then((rows) => rows.map((row) => row.id)),
```

`src/modules/zones/zone.repository.js` — add:

```js
  countByIds: (ids) => prisma.zone.count({ where: { id: { in: ids } } }),
```

`user.service.js` — factory becomes `createUserService({ userRepository, zoneRepository })`; add helper + wire into both methods:

```js
  // zoneIds -> Prisma relation op, or undefined when not applicable.
  async function zoneAssignment(zoneIds, role, op) {
    if (zoneIds === undefined || role !== 'SURVEYOR') return undefined
    const found = await zoneRepository.countByIds(zoneIds)
    if (found !== zoneIds.length) throw ApiError.badRequest('One or more zones do not exist')
    return { [op]: zoneIds.map((id) => ({ id })) }
  }
```

In `createUser` (destructure `zoneIds` out of data):

```js
    async createUser({ password, zoneIds, ...data }) {
      const existing = await userRepository.findByEmail(data.email)
      if (existing) throw ApiError.conflict('A user with this email already exists')
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
      const assignedZones = await zoneAssignment(zoneIds, data.role, 'connect')
      const user = await userRepository.create({
        ...data,
        passwordHash,
        ...(assignedZones && { assignedZones }),
      })
      return toPublicUser(user)
    },
```

In `updateUser` (destructure `zoneIds`; resolve target role from patch or existing record):

```js
    async updateUser(id, { password, email, zoneIds, ...data }) {
      if (email) {
        const existing = await userRepository.findByEmail(email)
        if (existing && existing.id !== id) {
          throw ApiError.conflict('A user with this email already exists')
        }
        data.email = email
      }
      if (password) data.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

      if (zoneIds !== undefined) {
        const current = await userRepository.findById(id)
        if (!current) throw ApiError.notFound('User not found')
        const targetRole = data.role ?? current.role
        const assignedZones = await zoneAssignment(zoneIds, targetRole, 'set')
        if (assignedZones) data.assignedZones = assignedZones
      }

      const user = await userRepository.update(id, data)
      return toPublicUser(user)
    },
```

`user.controller.js` — update the DI:

```js
import { zoneRepository } from '../zones/zone.repository.js'
const userService = createUserService({ userRepository, zoneRepository })
```

`auth.controller.js` — in `me`, after the active check:

```js
      const assignedZoneIds =
        user.role === 'SURVEYOR' ? await userRepository.assignedZoneIds(user.id) : []
      res.json({ success: true, data: { ...toPublicUser(user), assignedZoneIds } })
```

- [ ] **Step 4: Run tests + full suite**

Run: `npx vitest run tests/user-zones.service.test.js` → PASS. `npm test` → all PASS (user.service.test.js constructs `createUserService({ userRepository })` — if it fails on missing zoneRepository, pass `{ userRepository, zoneRepository: { countByIds: async (ids) => ids.length } }` in that test file).

- [ ] **Step 5: Commit**

```bash
git add src/modules/users src/modules/zones/zone.repository.js src/modules/auth/auth.controller.js tests/user-zones.service.test.js tests/user.service.test.js
git commit -m "feat: surveyor zone assignment on user create/update; /me returns assignedZoneIds"
```

---

### Task 4: Building scoping — list, detail, create, photos, nearby masking

**Files:**
- Modify: `src/modules/buildings/building.service.js`, `building.controller.js`
- Test: `tests/building-scope.service.test.js`

**Interfaces:**
- Consumes: `userRepository.assignedZoneIds(userId)` (Task 3). Building service DI gains it: `createBuildingService({ buildingRepository, storage, userRepository })` — update the controller's factory call accordingly.
- Produces: `listBuildings(filters, actor)`, `getBuilding(id, actor)`, `createBuilding(input, createdById, actor)`, `addPhoto(buildingId, photo, user)` (ownership check added), `findNearby(params, actor)`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

const own = { id: 'b1', createdById: 'u-surv', buildingName: 'Mine', latitude: 18.5, longitude: 73.8, placeId: null }
const foreign = { id: 'b2', createdById: 'u-other', buildingName: 'Theirs', latitude: 18.5001, longitude: 73.8001, placeId: null }

function makeService({ buildings = [own, foreign], assigned = ['z1'] } = {}) {
  let lastWhere = null
  const service = createBuildingService({
    buildingRepository: {
      list: async (where) => {
        lastWhere = where
        return buildings.filter((b) => !where.createdById || b.createdById === where.createdById)
      },
      count: async () => buildings.length,
      findById: async (id) => buildings.find((b) => b.id === id) ?? null,
      findWithinBounds: async () => buildings,
      findByPlaceId: async () => null,
      create: async (data) => ({ id: 'new', ...data }),
      createPhoto: async (data) => data,
    },
    storage: { keyFromUrl: () => 'key' },
    userRepository: { assignedZoneIds: async () => assigned },
  })
  return { service, whereUsed: () => lastWhere }
}

const surveyor = { id: 'u-surv', role: 'SURVEYOR' }
const admin = { id: 'u-a', role: 'ADMIN' }

describe('building scoping', () => {
  it('forces createdById for surveyors even when the param says otherwise', async () => {
    const { service, whereUsed } = makeService()
    await service.listBuildings({ createdById: 'u-other' }, surveyor)
    expect(whereUsed().createdById).toBe('u-surv')
  })

  it('does not scope admins', async () => {
    const { service, whereUsed } = makeService()
    await service.listBuildings({}, admin)
    expect(whereUsed().createdById).toBeUndefined()
  })

  it('404s surveyor access to a foreign building', async () => {
    const { service } = makeService()
    await expect(service.getBuilding('b2', surveyor)).rejects.toMatchObject({ status: 404 })
    await expect(service.getBuilding('b2', admin)).resolves.toMatchObject({ id: 'b2' })
  })

  it('403s creation outside assigned zones', async () => {
    const { service } = makeService({ assigned: ['z1'] })
    const input = { buildingName: 'X', formattedAddress: 'A', latitude: 1, longitude: 1, zoneId: 'z9' }
    await expect(service.createBuilding(input, 'u-surv', surveyor)).rejects.toMatchObject({ status: 403 })
    await expect(
      service.createBuilding({ ...input, zoneId: 'z1' }, 'u-surv', surveyor),
    ).resolves.toMatchObject({ id: 'new' })
  })

  it('403s photo add on a foreign building for surveyors', async () => {
    const { service } = makeService()
    await expect(
      service.addPhoto('b2', { type: 'ENTRANCE', url: 'u' }, surveyor),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('masks foreign building names in nearby results for surveyors only', async () => {
    const { service } = makeService()
    const forSurveyor = await service.findNearby(
      { latitude: 18.5, longitude: 73.8, radiusMeters: 500, name: 'Mine' },
      surveyor,
    )
    expect(forSurveyor.find((b) => b.id === 'b1').buildingName).toBe('Mine')
    expect(forSurveyor.find((b) => b.id === 'b2').buildingName).toBeNull()
    const forAdmin = await service.findNearby(
      { latitude: 18.5, longitude: 73.8, radiusMeters: 500 },
      admin,
    )
    expect(forAdmin.find((b) => b.id === 'b2').buildingName).toBe('Theirs')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/building-scope.service.test.js` → FAIL.

- [ ] **Step 3: Implement in `building.service.js`**

Factory signature: `createBuildingService({ buildingRepository, storage, userRepository })`.

`createBuilding` — before the repository call:

```js
      if (actor?.role === 'SURVEYOR') {
        const assigned = await userRepository.assignedZoneIds(actor.id)
        if (!assigned.includes(building.zoneId)) {
          throw ApiError.forbidden('You are not assigned to this zone')
        }
      }
```

(new third param: `async createBuilding(input, createdById, actor)`)

`listBuildings(filters, actor)` — after `if (createdById) where.createdById = createdById` add:

```js
      // Surveyors only ever see their own buildings — forced, not a param.
      if (actor?.role === 'SURVEYOR') where.createdById = actor.id
```

`getBuilding(id, actor)`:

```js
    async getBuilding(id, actor) {
      const building = await buildingRepository.findById(id)
      // 404 (not 403) for foreign buildings: don't leak existence.
      if (!building || (actor?.role === 'SURVEYOR' && building.createdById !== actor.id)) {
        throw ApiError.notFound('Building not found')
      }
      return building
    },
```

`addPhoto` — after the `findById`/not-found check:

```js
      if (user?.role === 'SURVEYOR' && building.createdById !== user.id) {
        throw ApiError.forbidden('You can only add photos to your own buildings')
      }
```

`findNearby(params, actor)` — in the final `.map(...)`, mask before returning (keep `similarName` computed from the real name):

```js
        .map((building) => ({
          ...building,
          buildingName:
            actor?.role === 'SURVEYOR' && building.createdById !== actor.id
              ? null
              : building.buildingName,
          samePlaceId: Boolean(placeId) && building.placeId === placeId,
          similarName: name ? isSimilarName(name, building.buildingName) : false,
        }))
```

(NOTE: compute `similarName` FIRST — keep `similarName: name ? isSimilarName(name, building.buildingName) : false` referencing the original `building.buildingName`, and spread the mask after it, e.g. build the object with `similarName` before overwriting `buildingName`. Order the properties: `...building, samePlaceId, similarName, buildingName: masked`.)

`building.controller.js` — pass the actor through:

```js
const buildingService = createBuildingService({ buildingRepository, storage, userRepository })
// create:
const building = await buildingService.createBuilding(req.body, req.user.id, req.user)
// list:
const buildings = await buildingService.listBuildings(req.validatedQuery ?? {}, req.user)
// nearby: append req.user as 2nd arg to findNearby({...}, req.user)
// get:
const building = await buildingService.getBuilding(req.params.id, req.user)
```

(add `import { userRepository } from '../users/user.repository.js'`)

- [ ] **Step 4: Run tests + full suite**

Run: `npx vitest run tests/building-scope.service.test.js` → PASS. `npm test` → all PASS. Existing building service tests construct the factory without `userRepository` — where they fail, add `userRepository: { assignedZoneIds: async () => [] }` to their deps.

- [ ] **Step 5: Commit**

```bash
git add src/modules/buildings tests/building-scope.service.test.js tests/building*.test.js
git commit -m "feat: zone/ownership scoping for buildings (list, detail, create, photos, nearby masking)"
```

---

### Task 5: Stats scoping

**Files:**
- Modify: `src/modules/stats/stats.repository.js`, `stats.service.js`, `stats.controller.js`
- Test: `tests/stats-scope.service.test.js`

**Interfaces:**
- Produces: every `statsRepository` method accepts an optional `where` (`{ createdById }` on Building; nested for details/permission); `getDashboardStats(actor)`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { createStatsService } from '../src/modules/stats/stats.service.js'

function fakeStatsRepo() {
  const wheres = {}
  return {
    wheres,
    countBuildings: async (where) => ((wheres.count = where), 5),
    countsByStatus: async (where) => ((wheres.status = where), []),
    sumHomePass: async (where) => ((wheres.homePass = where), 10),
    sumPermissionCost: async (where) => ((wheres.cost = where), 0),
  }
}

describe('dashboard stats scoping', () => {
  it('passes no filter for admins', async () => {
    const repo = fakeStatsRepo()
    await createStatsService({ statsRepository: repo }).getDashboardStats({ id: 'a', role: 'ADMIN' })
    expect(repo.wheres.count).toBeUndefined()
  })

  it('scopes all queries to the surveyor', async () => {
    const repo = fakeStatsRepo()
    await createStatsService({ statsRepository: repo }).getDashboardStats({
      id: 'u-surv',
      role: 'SURVEYOR',
    })
    expect(repo.wheres.count).toEqual({ createdById: 'u-surv' })
    expect(repo.wheres.status).toEqual({ createdById: 'u-surv' })
    expect(repo.wheres.homePass).toEqual({ building: { createdById: 'u-surv' } })
    expect(repo.wheres.cost).toEqual({ building: { createdById: 'u-surv' } })
  })
})
```

- [ ] **Step 2: Run to verify failure** → `npx vitest run tests/stats-scope.service.test.js` FAIL.

- [ ] **Step 3: Implement**

`stats.repository.js`:

```js
export const statsRepository = {
  countBuildings: (where) => prisma.building.count({ where }),
  countsByStatus: (where) =>
    prisma.building.groupBy({ by: ['feasibleStatus'], _count: { _all: true }, where }),
  sumHomePass: (where) =>
    prisma.buildingDetails
      .aggregate({ _sum: { homePass: true }, where })
      .then((result) => result._sum.homePass),
  sumPermissionCost: (where) =>
    prisma.permission
      .aggregate({ _sum: { amountPaid: true }, where })
      .then((result) => result._sum.amountPaid),
}
```

`stats.service.js` — `getDashboardStats(actor)`:

```js
    async getDashboardStats(actor) {
      const scoped = actor?.role === 'SURVEYOR'
      const buildingWhere = scoped ? { createdById: actor.id } : undefined
      const nestedWhere = scoped ? { building: { createdById: actor.id } } : undefined
      const [totalBuildings, statusCounts, homePass, permissionCost] = await Promise.all([
        statsRepository.countBuildings(buildingWhere),
        statsRepository.countsByStatus(buildingWhere),
        statsRepository.sumHomePass(nestedWhere),
        statsRepository.sumPermissionCost(nestedWhere),
      ])
      // ...rest unchanged...
```

`stats.controller.js` — pass `req.user` into `getDashboardStats`.

- [ ] **Step 4: Run tests + full suite** → both PASS (fix `tests/stats.service.test.js` deps the same way if needed).

- [ ] **Step 5: Commit**

```bash
git add src/modules/stats tests/stats-scope.service.test.js tests/stats.service.test.js
git commit -m "feat: dashboard stats scoped to surveyor's own buildings"
```

---

### Task 6: Users & Zones pagination + search (dual response)

**Files:**
- Modify: `src/modules/users/user.schemas.js`, `user.repository.js`, `user.service.js`, `user.controller.js`, `user.routes.js`
- Modify: `src/modules/zones/zone.schemas.js`, `zone.repository.js`, `zone.service.js`, `zone.controller.js`, `zone.routes.js`
- Test: `tests/list-pagination.route.test.js`

**Interfaces:**
- Produces: `GET /users?page&pageSize&search&role` and `GET /zones?page&pageSize&search` — with `page`: `{ items, total, page, pageSize, totalPages }`; without: legacy array. New schemas `listUsersQuerySchema`, `listZonesQuerySchema`; repo methods `paged({ where, skip, take })` + `count(where)` on both; services `listUsersPaged(query)`, `listZonesPaged(query, actor)`.

- [ ] **Step 1: Write the failing route test**

```js
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'

const adminToken = jwt.sign({ sub: 'test-admin', role: 'ADMIN' }, env.jwtSecret, { expiresIn: '1h' })
const get = (url) => request(createApp()).get(url).set('Authorization', `Bearer ${adminToken}`)

describe('dual-response pagination', () => {
  it('GET /users without page returns the legacy array with assignedZones', async () => {
    const res = await get('/api/v1/users')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data[0]).toHaveProperty('assignedZones')
    expect(res.body.data[0]).not.toHaveProperty('passwordHash')
  })

  it('GET /users with page returns the envelope and filters by search + role', async () => {
    const res = await get('/api/v1/users?page=1&pageSize=5&search=admin&role=ADMIN')
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 5 })
    expect(Array.isArray(res.body.data.items)).toBe(true)
    expect(res.body.data.items.every((u) => u.role === 'ADMIN')).toBe(true)
  })

  it('GET /zones without page returns the legacy array', async () => {
    const res = await get('/api/v1/zones')
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it('GET /zones with page + search returns matching envelope', async () => {
    const res = await get('/api/v1/zones?page=1&pageSize=5&search=zzz-no-such-zone')
    expect(res.body.data.items).toHaveLength(0)
    expect(res.body.data.total).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure** → 400s/array mismatches.

- [ ] **Step 3: Implement users side**

`user.schemas.js`:

```js
export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().optional(),
  role: roleSchema.optional(),
})
```

`user.repository.js`:

```js
  paged: ({ where, skip, take }) =>
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { assignedZones: { select: { id: true, name: true } } },
    }),
  count: (where) => prisma.user.count({ where }),
```

`user.service.js`:

```js
    async listUsersPaged({ page, pageSize, search, role }) {
      const where = {
        ...(role && { role }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }),
      }
      const [items, total] = await Promise.all([
        userRepository.paged({ where, skip: (page - 1) * pageSize, take: pageSize }),
        userRepository.count(where),
      ])
      return {
        items: items.map(toPublicUser),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      }
    },
```

`user.controller.js` `list`:

```js
      const query = req.validatedQuery ?? {}
      const data = query.page
        ? await userService.listUsersPaged(query)
        : await userService.listUsers()
      res.json({ success: true, data })
```

`user.routes.js` — add `validateQuery(listUsersQuerySchema)` to the GET route (import both from schemas/validate).

- [ ] **Step 4: Implement zones side** (mirror)

`zone.schemas.js`:

```js
export const listZonesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().optional(),
})
```

`zone.repository.js`:

```js
  paged: ({ where, skip, take }) =>
    prisma.zone.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
  count: (where) => prisma.zone.count({ where }),
```

`zone.service.js`:

```js
    async listZonesPaged({ page, pageSize, search }, actor) {
      const where = {
        ...(actor?.role === 'SURVEYOR' && { assignedUsers: { some: { id: actor.id } } }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
          ],
        }),
      }
      const [items, total] = await Promise.all([
        zoneRepository.paged({ where, skip: (page - 1) * pageSize, take: pageSize }),
        zoneRepository.count(where),
      ])
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
    },
```

`zone.controller.js` `list`:

```js
      const query = req.validatedQuery ?? {}
      const data = query.page
        ? await zoneService.listZonesPaged(query, req.user)
        : await zoneService.listZones(req.user)
      res.json({ success: true, data })
```

`zone.routes.js` — add `validateQuery(listZonesQuerySchema)` to the GET route.

- [ ] **Step 5: Run tests + full suite** → PASS. **Step 6: Commit**

```bash
git add src/modules/users src/modules/zones tests/list-pagination.route.test.js
git commit -m "feat: dual-response pagination + search on users and zones lists"
```

---

### Task 7: Frontend — ZoneMultiSelect component

**Files (frontend repo):**
- Create: `src/components/admin/ZoneMultiSelect.js`

**Interfaces:**
- Produces: `<ZoneMultiSelect zones selectedIds onChange />` — `zones: [{id, name, city}]`, `selectedIds: string[]`, `onChange(nextIds: string[])`. Client-side search filter; chips for selections.

- [ ] **Step 1: Implement**

```js
'use client'

import { useMemo, useState } from 'react'
import { IconClose, IconSearch } from '@/components/ui/icons'

/** Searchable multi-select for zone assignment: filter as you type, chips for picks. */
export function ZoneMultiSelect({ zones, selectedIds, onChange }) {
  const [query, setQuery] = useState('')

  const selected = useMemo(
    () => zones.filter((zone) => selectedIds.includes(zone.id)),
    [zones, selectedIds],
  )
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return zones.filter(
      (zone) =>
        !selectedIds.includes(zone.id) &&
        (!q || zone.name.toLowerCase().includes(q) || zone.city?.toLowerCase().includes(q)),
    )
  }, [zones, selectedIds, query])

  const add = (id) => onChange([...selectedIds, id])
  const remove = (id) => onChange(selectedIds.filter((zoneId) => zoneId !== id))

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">Assigned zones</span>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((zone) => (
            <span
              key={zone.id}
              className="inline-flex items-center gap-1 rounded-full bg-fiber-tint px-2.5 py-1 text-xs font-medium text-fiber"
            >
              {zone.name}
              <button
                type="button"
                aria-label={`Remove ${zone.name}`}
                onClick={() => remove(zone.id)}
                className="hover:opacity-70"
              >
                <IconClose className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search zones…"
          className="h-11 w-full rounded-btn border border-line bg-card pl-9 pr-3 text-sm text-ink outline-none placeholder:text-faint focus:border-fiber focus:ring-2 focus:ring-fiber/15"
        />
      </div>

      <div className="max-h-44 overflow-y-auto rounded-btn border border-line">
        {matches.length === 0 && (
          <p className="px-3 py-2.5 text-sm text-muted">No matching zones</p>
        )}
        {matches.map((zone) => (
          <button
            key={zone.id}
            type="button"
            onClick={() => add(zone.id)}
            className="flex w-full items-center justify-between gap-2 border-b border-line/60 px-3 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-fiber-tint/50"
          >
            <span className="truncate font-medium">{zone.name}</span>
            <span className="shrink-0 text-xs text-muted">{zone.city}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint + commit**

```bash
npx eslint src/components/admin/ZoneMultiSelect.js
git add src/components/admin/ZoneMultiSelect.js
git commit -m "feat: searchable ZoneMultiSelect for zone assignment"
```

---

### Task 8: Frontend — users page: zone assignment + pagination + search

**Files (frontend repo):**
- Modify: `src/app/(app)/admin/users/page.js`

**Interfaces:**
- Consumes: `ZoneMultiSelect` (Task 7); `GET /users?page&search&role` envelope (Task 6); `POST/PATCH /users` with `zoneIds` (Task 3); `GET /zones` legacy array.

- [ ] **Step 1: UserFormModal — add zone assignment**

- Import `ZoneMultiSelect`.
- Modal receives a new `zones` prop (array from the page).
- Extend form state with `zoneIds: []`; on open in edit mode initialize from `initial.assignedZones?.map((z) => z.id) ?? []`.
- After the role `<Select>`, render:

```js
        {form.role === 'SURVEYOR' && (
          <ZoneMultiSelect
            zones={zones}
            selectedIds={form.zoneIds}
            onChange={(zoneIds) => setForm((prev) => ({ ...prev, zoneIds }))}
          />
        )}
```

- In `submit`, include `zoneIds: form.zoneIds` in both the create body and the patch body when `form.role === 'SURVEYOR'`.

- [ ] **Step 2: Page — fetch zones once, switch list to paginated + search**

- Add state: `search`, `debouncedSearch` (400ms timer effect, same pattern as system-logs page), `roleFilter`, `page`, `zones` (from `apiClient.get('/zones')`, the legacy array).
- Replace `fetchUsers` with a param-keyed fetch identical in shape to the system-logs page pattern (derive `loading` from key mismatch — the lint rule forbids sync setState in effects):

```js
  const paramsKey = useMemo(() => {
    const p = { page, pageSize: 50 }
    if (debouncedSearch.trim()) p.search = debouncedSearch.trim()
    if (roleFilter) p.role = roleFilter
    return JSON.stringify(p)
  }, [page, debouncedSearch, roleFilter])
```

  Effect fetches `apiClient.get('/users', { params: JSON.parse(paramsKey) })`, stores `{ key, data }`; `users = result?.data?.items`, `pagination = { page, totalPages, total }` from the envelope. Refetch after create/edit/toggle = re-run by bumping a `refreshTick` included in `paramsKey`.
- Add above the table: a search `Input` (placeholder "Search name or email…") and a role `Select` (All roles / Admin / Manager / Surveyor), both resetting `page` to 1 on change.
- Render `Pagination` below the list with `onChange={setPage}` (users page currently maps rows directly — wrap with the existing `Pagination` component, or pass `pagination`/`onPageChange` if the page already uses `DataTable`).
- Show each user's assigned zones as small chips in the row (e.g. `user.assignedZones?.map(z => z.name).join(', ')` in the meta line) so admins can see assignments at a glance.

- [ ] **Step 3: Lint + commit**

```bash
npx eslint "src/app/(app)/admin/users/page.js"
git add "src/app/(app)/admin/users/page.js"
git commit -m "feat: zone assignment, search, role filter, pagination on users page"
```

---

### Task 9: Frontend — zones page pagination/search + surveyor UX touches

**Files (frontend repo):**
- Modify: `src/app/(app)/admin/zones/page.js`
- Modify: the add-building zone select + duplicate-warning components (locate exactly via `grep -rn "useZones\|similarName\|samePlaceId" src/`)

**Interfaces:**
- Consumes: `GET /zones?page&search` envelope (Task 6); nearby responses where `buildingName` may be `null` (Task 4).

- [ ] **Step 1: Zones page — search + pagination**

Same pattern as Task 8: `search` + `debouncedSearch` + `page` state, param-keyed fetch of `/zones?page=&pageSize=50&search=`, list renders `result.items`, `Pagination` below (`pagination={{ page, totalPages, total }}`). The import-modal's `onImported` and create/edit/delete handlers re-fetch by bumping `refreshTick`. Search `Input` placeholder: "Search zone or city…".

- [ ] **Step 2: Add-building flow — empty-zones notice**

Locate the zone `<Select>`/dropdown in the add-building flow (`grep -rn "useZones" src/`). Where the zones array renders options, add before/instead of the select when empty:

```js
{zones?.length === 0 && (
  <p className="rounded-btn bg-warn-tint px-4 py-3 text-sm font-normal text-warn">
    No zones assigned to you yet — contact your admin.
  </p>
)}
```

- [ ] **Step 3: Duplicate warning — masked names**

Locate where nearby-duplicate candidates render their `buildingName` (`grep -rn "similarName\|samePlaceId\|distanceMeters" src/`). Replace the name display with:

```js
{building.buildingName ?? 'Existing building'}
```

- [ ] **Step 4: Lint + commit**

```bash
npx eslint "src/app/(app)/admin/zones/page.js" <other touched files>
git add -A src/
git commit -m "feat: zones page pagination/search; surveyor empty-zones and masked-duplicate UX"
```

---

### Task 10: Live verification + finish

- [ ] **Step 1:** `cd backend && npm test` → all PASS. `cd frontend && npm run build` → clean.
- [ ] **Step 2:** Live browser pass (headless Brave via scratchpad playwright-core, servers on :3000/:4090 — start temp instances only if down, kill by PID):
  1. As admin: create a surveyor test user with 1 assigned zone via the searchable picker (type to filter, chip appears). Edit the user: add a second zone, remove it, save — assignments persist.
  2. Users page: search by name narrows; role filter works; pagination renders.
  3. Zones page: search narrows; pagination renders.
  4. As the surveyor (login): zones dropdowns show only the assigned zone; map/buildings list show only own buildings (create one to prove visibility); dashboard counts = own buildings only; building create in the assigned zone succeeds; foreign building detail URL → not found; system logs record the denied/allowed actions.
  5. Delete the test user + test building afterwards.
- [ ] **Step 3:** Report honestly, then use superpowers:finishing-a-development-branch.
