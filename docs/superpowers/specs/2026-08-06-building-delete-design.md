# Building Delete (Admin-only, with R2 file cleanup)

**Date:** 2026-08-06
**Status:** Approved

## Goal

Admins can permanently delete a building. The delete removes the building and
all its child records from the database and removes every uploaded file
(photos and permission letter) from Cloudflare R2. No other role can delete
buildings.

## Decisions

- **Hard delete.** The building row and its cascaded children (details,
  permission, photos) are permanently removed. The audit log keeps the record
  of who deleted what and when.
- **Admin only.** `requireRole('ADMIN')` — managers and surveyors receive 403.
- **UI on the detail page only.** No delete affordance on list cards; deleting
  requires opening the building first.
- **DB-first, storage best-effort.** Files are deleted from R2 *after* the DB
  delete succeeds. A failed R2 delete is logged and never fails the request —
  the same trade-off `removePhoto` already makes (an orphaned file is cheap; a
  DB row pointing at a missing file breaks the UI).

## Backend

### Route (`building.routes.js`)

```
DELETE /api/buildings/:id
```

- `requireRole('ADMIN')`
- `audit('Building', 'Delete', { load: findById, describe: "Building '<name>' deleted" })`
- Controller returns **204 No Content** on success.

### Service (`building.service.js`)

`deleteBuilding(id)`:

1. `buildingRepository.findById(id)` (full include already loads photos +
   permission). Throw `ApiError.notFound` if missing.
2. Collect file URLs into a `Set`: every `photos[].url` plus
   `permission.documentUrl` if set. (The permission letter can exist as a
   documentUrl without a photo row when set at create time — cleaning only
   `photos[]` would leak that file. The Set dedupes the common case where it
   appears in both places.)
3. `buildingRepository.delete(id)` — Prisma `onDelete: Cascade` removes
   details, permission, and photo rows.
4. For each collected URL: `storage.keyFromUrl(url)` → if a key,
   `storage.delete({ key })` in a try/catch that logs failures
   (`console.error`) and continues.

### Repository (`building.repository.js`)

```js
delete: (id) => prisma.building.delete({ where: { id } })
```

## Frontend

- **Detail page** (`app/(app)/buildings/[id]/page.js`): red "Delete" button
  next to Edit, rendered only when `role === 'ADMIN'` (stricter than the
  existing `canEdit`, which includes MANAGER). Styling follows Design.md
  destructive conventions.
- **Confirmation dialog** naming the building ("Delete 'Sunrise Towers'? This
  permanently removes the building and all its photos."). On confirm: call the
  DELETE endpoint, show a success toast, redirect to `/buildings`.
- **Hook** (`hooks/useBuildings.js`): `useDeleteBuilding` mutation following
  the existing mutation patterns; invalidates the buildings list query on
  success.

## Error handling

- Missing building → 404 (service).
- Non-admin → 403 (middleware; never reaches the service).
- R2 deletion failure → logged server-side, request still succeeds (204).
- Frontend surfaces API errors in the dialog via the existing error pattern.

## Testing

Backend (existing vitest structure, fake storage provider):

- Admin delete → 204, row gone, `storage.delete` called once per distinct file
  (photos + permission documentUrl, deduped).
- Building with permission `documentUrl` but no photo row → that file is still
  deleted from storage.
- `storage.delete` throws → request still succeeds, building still deleted.
- Unknown id → 404.
- MANAGER and SURVEYOR → 403 (route-level role test).

Frontend: covered by manual verification against the dev server (matches how
existing detail-page features were verified).

## Out of scope

- Soft delete / restore.
- Bulk delete.
- Delete from list cards or the map view.
