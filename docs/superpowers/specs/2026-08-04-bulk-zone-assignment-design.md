# Bulk Zone Assignment (Sheet Upload) — Design

**Date:** 2026-08-04
**Status:** Approved

## Decisions (user-approved)

| Question | Decision |
|---|---|
| User match key | Email (unique). Case-insensitive, trimmed. |
| Semantics | Sheet zones REPLACE the user's assignment set (same as Edit User). |
| Problem rows | Per-row skip + report. Reasons: `user not found`, `not a surveyor`, `zone(s) not found: X, Y`. A row with ANY unknown zone name skips entirely — a typo cannot silently shrink an assignment. |
| Sheet format | Columns `Email | Zones`; Zones = comma-separated zone names (CSV requires quotes around that cell). Optional header. .xlsx + .csv. Template downloadable. |

## Backend

`POST /api/v1/users/bulk-zones` — ADMIN only.

Body (zod): `{ assignments: [{ email: email string, zoneNames: string[] (1–200, trimmed) }] }`, 1–500 rows.

Service `bulkAssignZones(assignments)`:
- Load all zones once; resolve names case-insensitively (trimmed) to ids.
- Per row: user by email case-insensitively (`findByEmailInsensitive`); skip per the
  reasons above; otherwise `assignedZones: { set: ids }` (deduplicated).
- Duplicate emails within the file: last row wins (each applies in order).
- Returns `{ updated: [{ email, zones }], skipped: [{ email, reason }], total }`.

Audit: route annotated `audit('User', 'BulkZoneAssign')`, ONE entry per import —
`Bulk zone assignment: N updated, M skipped`.

## Frontend

Admin Users page: "Bulk assign zones" button → pick → preview → result modal
(same skeleton as the zones import). Shared spreadsheet parsing extracted to
`src/lib/spreadsheet.js` (used by both import modals). Client-side preview
validates shape only (email format, non-empty zones); the server does matching.
Result lists updated + skipped with reasons; users list refreshes after import
so zone chips update.

Template CSV: `Email,Zones` + example row `surveyor@isp.local,"Baner, Wakad West"`.

## Testing

Service: replace semantics (set op), each skip reason, case-insensitive email+zone
matching, in-file duplicate email last-wins. Route: 401, 403 (MANAGER and
SURVEYOR — assignment stays ADMIN-only like user PATCH), 400 invalid body, real
round-trip (create surveyor → assign 2 zones by sheet → verify → cleanup).
Frontend: eslint; live browser run with a sheet containing one good row, one bad
email, one bad zone name.
