# Edit Building Details — Design

**Date:** 2026-08-04
**Status:** Approved (user pre-approved build in-session)

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Who edits | ADMIN + MANAGER (matches other management actions). Surveyors: no edit button, API 403. |
| Fields | Everything except location: buildingName, formattedAddress, zoneId, isLive, details (wings, floors, homePass, buildingType, remarks), permission (amountPaid, permissionStatus, permissionDate, renewalDate, ownerName, ownerMobile). latitude/longitude/placeId immutable. permission.documentUrl excluded (PhotoManager owns documents). |
| UX | One Edit button on the detail page header → modal with all editable fields (reuses ZoneSearchSelect); one save, one audit entry. |

## Backend

`PATCH /api/v1/buildings/:id` on the buildings module:

- Route: `requireRole('ADMIN', 'MANAGER')` + `audit('Building', 'Update', { load: findById, describe })` → System Logs records a full old→new diff.
- `updateBuildingSchema` (zod): all fields optional; top-level `.refine` requires at least one field. Strings trimmed with the same length caps as `createBuildingSchema`; `details`/`permission` partial nested objects; dates as `z.string().date()` nullable; `amountPaid` nonnegative number nullable.
- Service `updateBuilding(id, data)`: 404 if missing; if `zoneId` changes, 400 when the zone doesn't exist; nested `details`/`permission` are **upserted** (older buildings may lack the child rows); returns the full building (`fullInclude`).

## Frontend

- `EditBuildingModal` (`src/components/buildings/EditBuildingModal.js`): pre-filled form — name, address, ZoneSearchSelect, Building RFS toggle, structure fields, permission fields; PATCH on save; `onSaved` refreshes the detail page data.
- Detail page header gains an Edit button, rendered only for ADMIN/MANAGER.

## Testing

Service tests (upsert payload shape, unknown zone 400, missing building 404), route tests (401, 403 SURVEYOR, admin round-trip changing name+details+permission), eslint, live browser edit.
