# Phase 5 – Document Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage documents/photos on existing buildings — attach (permission letter updates the permission record), delete (ADMIN/MANAGER only, file removed from storage), with client-side image compression before upload.

**Architecture:** `StorageProvider` gains `delete({ key })` and `keyFromUrl(url)` so removal stays provider-agnostic. Photo add/remove live in the buildings service (photos are building sub-resources: `POST/DELETE /buildings/:id/photos[/:photoId]`). Compression happens client-side in `lib/upload.js` via canvas — PDFs pass through untouched.

**Tech Stack:** Existing stack; no new dependencies.

## Global Constraints

- Delete policy (user decision): `requireRole('ADMIN', 'MANAGER')` on photo deletion. Any authenticated user may add.
- `PERMISSION_LETTER` add → upsert `Permission.documentUrl`; deletion of that photo clears `documentUrl` when it matches.
- Storage file deletion is best-effort: DB row removal must succeed even if the file is already gone.
- Compression: images > 300 KB are resized to max 1920 px and re-encoded JPEG quality 0.8 client-side (PRD challenge #6). PDFs and small images untouched.
- Documents accent color (Design.md): purple `#7C3AED` for document UI touches.
- Envelope/layering rules unchanged. Commit after every task.

---

### Task 1: Backend — StorageProvider delete

**Files:**
- Modify: `backend/src/lib/storage/local-storage-provider.js`
- Test: `backend/tests/local-storage-provider.test.js` (extend)

**Interfaces:**
- Produces: provider `delete({ key })` (resolves even when missing), `keyFromUrl(url) → key | null` (null for foreign URLs).

- [ ] **Step 1: Extend the failing test**

Append to `backend/tests/local-storage-provider.test.js` (inside the describe):

```js
  it('deletes a stored file by key and tolerates missing files', async () => {
    const provider = createLocalStorageProvider({
      rootDir: TEST_ROOT,
      baseUrl: 'http://localhost:4000/uploads',
    })
    const { key } = await provider.save({ buffer: Buffer.from('bye'), extension: 'png' })
    await provider.delete({ key })
    await expect(readFile(path.join(TEST_ROOT, key))).rejects.toThrow()
    await expect(provider.delete({ key })).resolves.toBeUndefined() // second delete is a no-op
  })

  it('maps a public url back to its storage key', () => {
    const provider = createLocalStorageProvider({
      rootDir: TEST_ROOT,
      baseUrl: 'http://localhost:4000/uploads',
    })
    expect(provider.keyFromUrl('http://localhost:4000/uploads/2026/07/abc.jpg')).toBe('2026/07/abc.jpg')
    expect(provider.keyFromUrl('https://elsewhere.com/x.jpg')).toBeNull()
  })
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/local-storage-provider.test.js` → FAIL (`delete` not a function).

- [ ] **Step 3: Implement** — add to the returned object in `local-storage-provider.js` (import `rm` from `node:fs/promises`):

```js
    async delete({ key }) {
      await rm(path.join(rootDir, key), { force: true })
    },

    keyFromUrl(url) {
      const prefix = `${baseUrl}/`
      return url.startsWith(prefix) ? url.slice(prefix.length) : null
    },
```

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit** — `git add backend && git commit -m "feat(backend): StorageProvider delete and url-to-key mapping"`

---

### Task 2: Backend — photo add/remove on buildings

**Files:**
- Modify: `backend/src/modules/buildings/building.repository.js`
- Modify: `backend/src/modules/buildings/building.service.js`
- Modify: `backend/src/modules/buildings/building.schemas.js`
- Modify: `backend/src/modules/buildings/building.controller.js`
- Modify: `backend/src/modules/buildings/building.routes.js`
- Test: `backend/tests/building-photos.service.test.js`

**Interfaces:**
- Consumes: `getStorageProvider()` (injected into the service factory as `storage` for testability — update factory signature to `createBuildingService({ buildingRepository, storage })`, storage optional/defaulted).
- Produces: service `addPhoto(buildingId, { type, url })`, `removePhoto(buildingId, photoId)`. Repository: `createPhoto(data)`, `findPhotoById(id)`, `deletePhoto(id)`, `upsertPermissionDocument(buildingId, documentUrl)`, `clearPermissionDocument(buildingId, url)`. Routes: `POST /buildings/:id/photos` (auth), `DELETE /buildings/:id/photos/:photoId` (ADMIN, MANAGER). `addPhotoSchema = { type: enum, url: string }`.

- [ ] **Step 1: Write the failing service test**

`backend/tests/building-photos.service.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

function fakeRepo({ building = { id: 'b1' }, photo } = {}) {
  return {
    findById: vi.fn(async (id) => (id === building?.id ? building : null)),
    createPhoto: vi.fn(async (data) => ({ id: 'p1', ...data })),
    findPhotoById: vi.fn(async () => photo ?? null),
    deletePhoto: vi.fn(async () => {}),
    upsertPermissionDocument: vi.fn(async () => {}),
    clearPermissionDocument: vi.fn(async () => {}),
  }
}

const fakeStorage = () => ({ delete: vi.fn(async () => {}), keyFromUrl: (url) => url.includes('/uploads/') ? url.split('/uploads/')[1] : null })

describe('building service photos', () => {
  it('adds a photo to an existing building', async () => {
    const repo = fakeRepo()
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })
    const photo = await service.addPhoto('b1', { type: 'ENTRANCE', url: '/uploads/a.jpg' })
    expect(repo.createPhoto).toHaveBeenCalledWith({ buildingId: 'b1', type: 'ENTRANCE', url: '/uploads/a.jpg' })
    expect(photo.id).toBe('p1')
  })

  it('404s when the building does not exist', async () => {
    const service = createBuildingService({ buildingRepository: fakeRepo({ building: null }), storage: fakeStorage() })
    await expect(service.addPhoto('nope', { type: 'ENTRANCE', url: 'x' })).rejects.toMatchObject({ status: 404 })
  })

  it('updates permission.documentUrl when adding a PERMISSION_LETTER', async () => {
    const repo = fakeRepo()
    const service = createBuildingService({ buildingRepository: repo, storage: fakeStorage() })
    await service.addPhoto('b1', { type: 'PERMISSION_LETTER', url: '/uploads/letter.pdf' })
    expect(repo.upsertPermissionDocument).toHaveBeenCalledWith('b1', '/uploads/letter.pdf')
  })

  it('removes a photo, deletes the stored file, clears matching permission doc', async () => {
    const photo = { id: 'p9', buildingId: 'b1', type: 'PERMISSION_LETTER', url: 'http://x/uploads/2026/07/l.pdf' }
    const repo = fakeRepo({ photo })
    const storage = fakeStorage()
    const service = createBuildingService({ buildingRepository: repo, storage })
    await service.removePhoto('b1', 'p9')
    expect(repo.deletePhoto).toHaveBeenCalledWith('p9')
    expect(storage.delete).toHaveBeenCalledWith({ key: '2026/07/l.pdf' })
    expect(repo.clearPermissionDocument).toHaveBeenCalledWith('b1', photo.url)
  })

  it('404s when removing a photo that belongs to another building', async () => {
    const photo = { id: 'p9', buildingId: 'OTHER', url: 'u' }
    const service = createBuildingService({ buildingRepository: fakeRepo({ photo }), storage: fakeStorage() })
    await expect(service.removePhoto('b1', 'p9')).rejects.toMatchObject({ status: 404 })
  })

  it('still removes the DB row when file deletion fails', async () => {
    const photo = { id: 'p9', buildingId: 'b1', type: 'ENTRANCE', url: 'http://x/uploads/z.jpg' }
    const repo = fakeRepo({ photo })
    const storage = { delete: vi.fn(async () => { throw new Error('disk') }), keyFromUrl: () => 'z.jpg' }
    const service = createBuildingService({ buildingRepository: repo, storage })
    await service.removePhoto('b1', 'p9')
    expect(repo.deletePhoto).toHaveBeenCalledWith('p9')
  })
})
```

- [ ] **Step 2: Run to verify failure**, then **Step 3: Implement**

Repository additions:

```js
  createPhoto: (data) => prisma.photo.create({ data }),
  findPhotoById: (id) => prisma.photo.findUnique({ where: { id } }),
  deletePhoto: (id) => prisma.photo.delete({ where: { id } }),
  upsertPermissionDocument: (buildingId, documentUrl) =>
    prisma.permission.upsert({
      where: { buildingId },
      update: { documentUrl },
      create: { buildingId, documentUrl },
    }),
  clearPermissionDocument: (buildingId, url) =>
    prisma.permission.updateMany({
      where: { buildingId, documentUrl: url },
      data: { documentUrl: null },
    }),
```

Service factory becomes `createBuildingService({ buildingRepository, storage })` (default `storage = getStorageProvider()` lazily in controller wiring, NOT at import time in the service module — keep the service pure). Add:

```js
    async addPhoto(buildingId, { type, url }) {
      const building = await buildingRepository.findById(buildingId)
      if (!building) throw ApiError.notFound('Building not found')
      const photo = await buildingRepository.createPhoto({ buildingId, type, url })
      if (type === 'PERMISSION_LETTER') {
        await buildingRepository.upsertPermissionDocument(buildingId, url)
      }
      return photo
    },

    async removePhoto(buildingId, photoId) {
      const photo = await buildingRepository.findPhotoById(photoId)
      if (!photo || photo.buildingId !== buildingId) throw ApiError.notFound('Photo not found')

      await buildingRepository.deletePhoto(photoId)
      if (photo.type === 'PERMISSION_LETTER') {
        await buildingRepository.clearPermissionDocument(buildingId, photo.url)
      }

      const key = storage?.keyFromUrl(photo.url)
      if (key) {
        try {
          await storage.delete({ key })
        } catch (err) {
          console.error('File deletion failed (row removed):', err.message)
        }
      }
    },
```

Schema: `export const addPhotoSchema = z.object({ type: z.enum(['ENTRANCE', 'PERMISSION_LETTER', 'ADDITIONAL']), url: z.string().min(1).max(500) })`

Controller wiring: `const buildingService = createBuildingService({ buildingRepository, storage: getStorageProvider() })` plus `addPhoto`/`removePhoto` handlers (201 for add, `{ success: true, data: null }` for remove). Routes:

```js
buildingRoutes.post('/:id/photos', validateBody(addPhotoSchema), buildingController.addPhoto)
buildingRoutes.delete('/:id/photos/:photoId', requireRole('ADMIN', 'MANAGER'), buildingController.removePhoto)
```

- [ ] **Step 4: Full suite green**, **Step 5: Commit** — `feat(backend): photo add/remove on buildings with storage cleanup`

---

### Task 3: Frontend — client-side image compression

**Files:**
- Modify: `frontend/src/lib/upload.js`

**Interfaces:**
- Produces: `uploadFile(file)` unchanged signature; internally compresses via `compressImage(file)` (exported for reuse). Images ≤300 KB or non-images skip compression.

- [ ] **Step 1: Implement**

```js
import { apiClient } from '@/lib/api-client'

const COMPRESS_THRESHOLD_BYTES = 300 * 1024
const MAX_DIMENSION_PX = 1920
const JPEG_QUALITY = 0.8

/** Downscale/re-encode camera images before upload (PRD: compression for large documents). */
export async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.size <= COMPRESS_THRESHOLD_BYTES) return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob || blob.size >= file.size) return file // compression didn't help
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
}

export async function uploadFile(file) {
  const prepared = await compressImage(file)
  const formData = new FormData()
  formData.append('file', prepared)
  const res = await apiClient.post('/uploads', formData)
  return res.data.data.url
}
```

- [ ] **Step 2: Commit** — `feat(frontend): client-side image compression before upload`

---

### Task 4: Frontend — document management on the detail page

**Files:**
- Create: `frontend/src/components/buildings/PhotoManager.js`
- Modify: `frontend/src/app/(app)/buildings/[id]/page.js`

**Interfaces:**
- Consumes: `POST /buildings/:id/photos`, `DELETE /buildings/:id/photos/:photoId`, `uploadFile`, `useAuthStore` (role gate for delete), design tokens; documents accent purple `#7C3AED`.
- Produces: `<PhotoManager building onChanged />` — grid of photos/documents with type chips, add flow (type select + file), delete with confirm for ADMIN/MANAGER.

Implementation follows the fiber-ops design language (bg-card, border-line, mono eyebrows). Add uses a labeled file input per type; delete asks `confirm()` then calls the API and `onChanged()` refetches.

- [ ] **Step 1: Implement PhotoManager and integrate into the detail page** (replace the existing static photo grid; page passes a refetch callback).
- [ ] **Step 2: Verify in dev server** — add and delete photos on an existing building via UI/API.
- [ ] **Step 3: Commit** — `feat(frontend): document & photo management on building detail`

---

### Task 5: End-to-end verification

- [ ] Full backend suite green; API add photo → appears in GET detail; PERMISSION_LETTER updates permission.documentUrl; delete as SURVEYOR → 403; as ADMIN → row + file gone; frontend routes 200; finish branch.
