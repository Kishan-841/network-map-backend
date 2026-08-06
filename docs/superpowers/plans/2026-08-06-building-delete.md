# Building Delete (Admin-only, R2 cleanup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins can permanently delete a building; the delete cascades all child rows in the DB and removes every uploaded file (photos + permission letter) from Cloudflare R2, best-effort.

**Architecture:** New `DELETE /api/v1/buildings/:id` route gated by `requireRole('ADMIN')` and wrapped in the existing `audit()` middleware. The service loads the building, collects all file URLs (photos + `permission.documentUrl`, deduped in a Set), deletes the DB row (Prisma `onDelete: Cascade` removes children), then deletes each file from storage in a try/catch. Frontend adds an admin-only Delete button on the building detail page using the existing `window.confirm` pattern.

**Tech Stack:** Express 5 / Prisma 6 (JS only, no TypeScript), vitest + supertest, Next.js App Router client components, DaisyUI buttons.

## Global Constraints

- Backend is plain JavaScript — no TypeScript anywhere (Prisma pinned to v6 for this reason).
- Frontend Design.md is binding: use existing `Button` variants and `IconTrash` from `@/components/ui/icons`; do not invent new styles.
- Storage failures must never fail the request after the DB row is gone (matches `removePhoto`).
- Do not restart or kill the user's dev servers; backend tests run against the dev DB via vitest as-is.
- Deviation from spec (approved rationale): no toast and no `useDeleteBuilding` hook — the codebase has neither toasts nor mutation hooks; deletes use `window.confirm` + direct `apiClient` calls (see `PhotoManager.js:60`, `CrudList.js:122`).

---

### Task 1: `deleteBuilding` service method

**Files:**
- Modify: `backend/src/modules/buildings/building.service.js` (add method after `removePhoto`, ~line 257)
- Test: `backend/tests/building-delete.service.test.js` (create)

**Interfaces:**
- Consumes: `buildingRepository.findById(id)` (existing, returns building with `photos` and `permission` included), `storage.keyFromUrl(url)`, `storage.delete({ key })` (existing).
- Produces: `buildingService.deleteBuilding(id)` → resolves to `undefined`; throws `ApiError.notFound` (status 404) if the building doesn't exist. Task 2's controller calls exactly this. Also produces the repository contract Task 2 implements: `buildingRepository.delete(id)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/building-delete.service.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

function fakeRepo(building) {
  return {
    findById: vi.fn(async (id) => (id === building?.id ? building : null)),
    delete: vi.fn(async () => {}),
  }
}

const fakeStorage = () => ({
  delete: vi.fn(async () => {}),
  keyFromUrl: (url) => (url.includes('/uploads/') ? url.split('/uploads/')[1] : null),
})

describe('building service delete', () => {
  it('deletes the row and every distinct stored file (photos + permission doc)', async () => {
    const building = {
      id: 'b1',
      photos: [
        { id: 'p1', url: 'http://x/uploads/a.jpg' },
        { id: 'p2', url: 'http://x/uploads/letter.pdf' },
      ],
      // Same URL as photo p2 — must be deleted from storage only once.
      permission: { documentUrl: 'http://x/uploads/letter.pdf' },
    }
    const repo = fakeRepo(building)
    const storage = fakeStorage()
    const service = createBuildingService({ buildingRepository: repo, storage })

    await service.deleteBuilding('b1')

    expect(repo.delete).toHaveBeenCalledWith('b1')
    expect(storage.delete).toHaveBeenCalledTimes(2)
    expect(storage.delete).toHaveBeenCalledWith({ key: 'a.jpg' })
    expect(storage.delete).toHaveBeenCalledWith({ key: 'letter.pdf' })
  })

  it('deletes a permission documentUrl that has no photo row', async () => {
    const building = {
      id: 'b1',
      photos: [],
      permission: { documentUrl: 'http://x/uploads/only-doc.pdf' },
    }
    const storage = fakeStorage()
    const service = createBuildingService({ buildingRepository: fakeRepo(building), storage })

    await service.deleteBuilding('b1')

    expect(storage.delete).toHaveBeenCalledWith({ key: 'only-doc.pdf' })
  })

  it('404s when the building does not exist', async () => {
    const service = createBuildingService({
      buildingRepository: fakeRepo(null),
      storage: fakeStorage(),
    })
    await expect(service.deleteBuilding('nope')).rejects.toMatchObject({ status: 404 })
  })

  it('still succeeds when file deletion fails (row already gone)', async () => {
    const building = { id: 'b1', photos: [{ id: 'p1', url: 'http://x/uploads/a.jpg' }] }
    const repo = fakeRepo(building)
    const storage = {
      delete: vi.fn(async () => {
        throw new Error('r2 down')
      }),
      keyFromUrl: () => 'a.jpg',
    }
    const service = createBuildingService({ buildingRepository: repo, storage })

    await expect(service.deleteBuilding('b1')).resolves.toBeUndefined()
    expect(repo.delete).toHaveBeenCalledWith('b1')
  })

  it('skips foreign URLs that do not belong to our storage', async () => {
    const building = { id: 'b1', photos: [{ id: 'p1', url: 'https://evil.example/x.jpg' }] }
    const storage = fakeStorage()
    const service = createBuildingService({ buildingRepository: fakeRepo(building), storage })

    await service.deleteBuilding('b1')

    expect(storage.delete).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run tests/building-delete.service.test.js`
Expected: FAIL — `service.deleteBuilding is not a function`

- [ ] **Step 3: Implement `deleteBuilding`**

In `backend/src/modules/buildings/building.service.js`, add after the `removePhoto` method (inside the returned object, before the closing `}`):

```js
    async deleteBuilding(id) {
      const building = await buildingRepository.findById(id)
      if (!building) throw ApiError.notFound('Building not found')

      // Collect every stored file before the row (and its cascaded photo/
      // permission children) disappears. The permission letter usually exists
      // as both a photo row and permission.documentUrl — the Set dedupes it.
      const urls = new Set(building.photos?.map((photo) => photo.url) ?? [])
      if (building.permission?.documentUrl) urls.add(building.permission.documentUrl)

      await buildingRepository.delete(id)

      // File removal is best-effort — the record is gone either way.
      for (const url of urls) {
        const key = storage?.keyFromUrl(url)
        if (!key) continue
        try {
          await storage.delete({ key })
        } catch (err) {
          console.error('File deletion failed (row removed):', err.message)
        }
      }
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run tests/building-delete.service.test.js`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
cd "/Users/gazon/Documents/Network graph map/backend"
git add tests/building-delete.service.test.js src/modules/buildings/building.service.js
git commit -m "feat: building delete service with best-effort storage cleanup"
```

---

### Task 2: Repository, route, and controller

**Files:**
- Modify: `backend/src/modules/buildings/building.repository.js` (add `delete` after `update`, ~line 23)
- Modify: `backend/src/modules/buildings/building.routes.js` (add route at end, after the photo delete route)
- Modify: `backend/src/modules/buildings/building.controller.js` (add `remove` after `removePhoto`, ~line 84)
- Test: `backend/tests/building-delete.route.test.js` (create)

**Interfaces:**
- Consumes: `buildingService.deleteBuilding(id)` from Task 1; existing `requireRole`, `audit`, `buildingRepository.findById`.
- Produces: `DELETE /api/v1/buildings/:id` → 204 on success, 401 unauthenticated, 403 non-admin, 404 unknown id. Task 3's frontend calls this endpoint.

- [ ] **Step 1: Write the failing route tests**

Create `backend/tests/building-delete.route.test.js` (same harness as `building-update.route.test.js` — real app + dev DB + signed JWTs):

```js
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('DELETE /api/v1/buildings/:id', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).delete('/api/v1/buildings/whatever')
    expect(res.status).toBe(401)
  })

  it('rejects SURVEYOR', async () => {
    const res = await request(createApp())
      .delete('/api/v1/buildings/whatever')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
    expect(res.status).toBe(403)
  })

  it('rejects MANAGER (admin only)', async () => {
    const res = await request(createApp())
      .delete('/api/v1/buildings/whatever')
      .set('Authorization', `Bearer ${tokenFor('MANAGER')}`)
    expect(res.status).toBe(403)
  })

  it('404s for an unknown id', async () => {
    const res = await request(createApp())
      .delete('/api/v1/buildings/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(404)
  })

  it('admin round-trip: 204 and the building (with children) is gone', async () => {
    const stamp = Date.now()
    const zone = await prisma.zone.findFirst()
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
    const building = await prisma.building.create({
      data: {
        buildingName: `DeleteTest-${stamp}`,
        formattedAddress: '1 Delete St',
        latitude: 18.5,
        longitude: 73.8,
        zoneId: zone.id,
        createdById: admin.id,
        details: { create: { floors: 3 } },
      },
    })

    const res = await request(createApp())
      .delete(`/api/v1/buildings/${building.id}`)
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
    expect(res.status).toBe(204)

    expect(await prisma.building.findUnique({ where: { id: building.id } })).toBeNull()
    expect(await prisma.buildingDetails.findUnique({ where: { buildingId: building.id } })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run tests/building-delete.route.test.js`
Expected: FAIL — the 404/round-trip cases return 404-from-router or 405 (route not defined); auth cases may already pass (middleware is router-wide). That's fine — the delete cases must fail.

- [ ] **Step 3: Implement repository, controller, route**

`building.repository.js` — add after the `update` line:

```js
  delete: (id) => prisma.building.delete({ where: { id } }),
```

`building.controller.js` — add after `removePhoto`:

```js
  async remove(req, res, next) {
    try {
      await buildingService.deleteBuilding(req.params.id)
      res.status(204).end()
    } catch (err) {
      next(err)
    }
  },
```

`building.routes.js` — add after the photo-delete route, before EOF:

```js
buildingRoutes.delete(
  '/:id',
  requireRole('ADMIN'),
  audit('Building', 'Delete', {
    load: (req) => buildingRepository.findById(req.params.id),
    describe: (req, old) => `Building '${old?.buildingName ?? req.params.id}' deleted`,
  }),
  buildingController.remove,
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run tests/building-delete.route.test.js`
Expected: 5 passed

- [ ] **Step 5: Run the full backend suite (regression)**

Run: `cd "/Users/gazon/Documents/Network graph map/backend" && npx vitest run`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
cd "/Users/gazon/Documents/Network graph map/backend"
git add tests/building-delete.route.test.js src/modules/buildings/building.repository.js src/modules/buildings/building.controller.js src/modules/buildings/building.routes.js
git commit -m "feat: DELETE /buildings/:id route, admin-only with audit log"
```

---

### Task 3: Frontend delete button on the building detail page

**Files:**
- Modify: `frontend/src/app/(app)/buildings/[id]/page.js`

**Interfaces:**
- Consumes: `DELETE /buildings/:id` via `apiClient` (baseURL already includes `/api/v1`); `Button` variant `dangerGhost`; `IconTrash` from `@/components/ui/icons`; `useRouter` from `next/navigation`; existing `role` value from `useAuthStore`.
- Produces: nothing consumed by later tasks (final task).

- [ ] **Step 1: Note the frontend caveat**

`frontend/AGENTS.md` warns this Next.js version differs from training data. This task only touches a `'use client'` component and uses `useRouter` from `next/navigation` — the exact pattern already used in `app/(app)/buildings/add/page.js:4`. No new Next.js APIs are introduced, so no doc reading is needed beyond confirming that pattern exists (it does).

- [ ] **Step 2: Implement the delete button**

In `frontend/src/app/(app)/buildings/[id]/page.js`:

Add imports (extend the existing import lines):

```js
import { useRouter } from 'next/navigation'
import { IconEdit, IconTrash } from '@/components/ui/icons'
```

(Replace the current separate `IconEdit` import at line 11; `IconPin` stays where it is.)

Inside `BuildingDetailPage`, after the `canEdit` line add:

```js
  const isAdmin = role === 'ADMIN'
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete "${building.buildingName}"? This permanently removes the building and all its photos.`,
      )
    )
      return
    setDeleting(true)
    try {
      await apiClient.delete(`/buildings/${id}`)
      router.push('/buildings')
    } catch {
      setDeleting(false)
      window.alert('Failed to delete the building. Please try again.')
    }
  }
```

Replace the `action={...}` prop of `PageHeader` with:

```js
        action={
          canEdit && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                <IconEdit className="h-4 w-4" strokeWidth={1.8} />
                Edit
              </Button>
              {isAdmin && (
                <Button variant="dangerGhost" loading={deleting} onClick={handleDelete}>
                  <IconTrash className="h-4 w-4" strokeWidth={1.8} />
                  Delete
                </Button>
              )}
            </div>
          )
        }
```

- [ ] **Step 3: Lint and build check**

Run: `cd "/Users/gazon/Documents/Network graph map/frontend" && npm run lint && npm run build`
Expected: no errors

- [ ] **Step 4: Manual verification against the running dev servers**

Do NOT restart any dev server. With the existing dev servers running:
1. Log in as an admin, open a test building's detail page → Delete button visible next to Edit.
2. Log in as a manager → Edit visible, Delete absent.
3. As admin, delete a throwaway test building → confirm dialog names the building; after confirm, redirected to `/buildings` and the building is gone from the list.

(If browser verification isn't possible in this session, verify via curl: `DELETE /api/v1/buildings/<id>` with an admin token returns 204, with a manager token 403.)

- [ ] **Step 5: Commit**

```bash
cd "/Users/gazon/Documents/Network graph map/frontend"
git add src/app/\(app\)/buildings/\[id\]/page.js
git commit -m "feat: admin-only delete button on building detail page"
```

---

## Self-Review Notes

- **Spec coverage:** hard delete + cascade (Task 2 round-trip test), R2 cleanup incl. documentUrl-without-photo-row (Task 1 tests), admin-only 403s for both MANAGER and SURVEYOR (Task 2), audit log (Task 2 route), 404 (Tasks 1+2), best-effort storage (Task 1), detail-page-only UI with confirm + redirect (Task 3). Toast/hook dropped — deviation recorded in Global Constraints with rationale.
- **Type consistency:** `deleteBuilding(id)` (Task 1) = controller call (Task 2); `buildingRepository.delete(id)` fake (Task 1) = real implementation (Task 2); endpoint path `/buildings/:id` (Task 2) = frontend call (Task 3).
