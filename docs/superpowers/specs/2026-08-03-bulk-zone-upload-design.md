# Bulk Zone Upload (Excel/CSV) — Design

**Date:** 2026-08-03
**Status:** Approved

## Overview

Admins/managers can create zones in bulk by uploading an Excel (.xlsx) or CSV file
on the admin zones page. The browser parses the file, shows a validity preview,
and submits clean JSON to a new bulk endpoint. Boundaries remain map-drawn
afterwards — the file carries only Name and City.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| File columns | `Name`, `City` only. Optional header row, auto-detected. |
| Existing zone name | Skip and report ("already exists"). Re-uploading the same file is safe/idempotent. |
| Invalid rows | Valid rows import; invalid rows reported per-row with reason. Invalid rows are filtered client-side in the preview and never sent. |
| Formats | `.xlsx` and `.csv`. |
| Parse location | Browser (preview-before-import); backend stays JSON-only. |

## Backend

`POST /api/v1/zones/bulk` on the existing zones module. Auth: `requireAuth` +
`requireRole('ADMIN', 'MANAGER')` (same as single zone create).

Request (zod-validated):

```json
{ "zones": [ { "name": "Wakad West", "city": "Pune" } ] }
```

- `zones`: array, min 1, max 500.
- `name`, `city`: trimmed strings, 1–100 chars (same limits as `createZoneSchema`).

Service behavior (sequential, per row):

- Name not in DB → create with `boundary: null`.
- Name exists in DB → skip, reason `"already exists"`.
- Name repeated within the file → first occurrence wins; later ones skip with
  reason `"duplicate in file"`.
- Name matching is exact (case-sensitive), consistent with the DB unique
  constraint on `Zone.name`.

Response:

```json
{
  "created": [{ "id": "…", "name": "Wakad West", "city": "Pune" }],
  "skipped": [{ "name": "Baner", "reason": "already exists" }],
  "total": 12
}
```

Wrapped in the standard `{ success: true, data }` envelope.

**Audit:** the route is annotated `audit('Zone', 'BulkCreate', …)` producing ONE
system-log entry per import — description
`"Bulk zone import: N created, M skipped"` — not one entry per row, so the
system log stays readable. `newValue` carries the submitted rows (capped by the
existing sanitizer/JSON storage; no sensitive fields exist here).

## Frontend

Admin zones page (`src/app/(app)/admin/zones/page.js`): an "Import from Excel"
button beside the existing add-zone control, opening a modal with three states:

1. **Pick file** — `<input type="file" accept=".xlsx,.csv">`, helper text
   describing the expected columns (`Name | City`), and a "Download template"
   link that generates a two-line sample CSV client-side (no server round-trip).
2. **Preview** — parsed rows in a table with per-row validity: valid rows get a
   green check; invalid rows (blank/too-long name or city) get a red mark and
   reason plus their source row number. Header row auto-detected (first row is
   treated as a header when its cells case-insensitively match "name"/"city").
   Footer: "Import N zones" (sends only valid rows), disabled at 0 valid rows.
3. **Result** — created/skipped counts, with skipped names + reasons listed.
   The zone list refreshes after import.

Parsers, dynamically imported inside the modal (not in the page bundle):

- `.xlsx` → `read-excel-file`
- `.csv` → `papaparse`

## Error handling

- Unparseable or empty file → inline modal error; nothing is sent.
- More than 500 valid rows → modal error asking to split the file (matches API cap).
- API/network failure → modal shows the error. Because the server processes rows
  independently, a mid-import failure may have created earlier rows; the user is
  told to simply re-upload — idempotent skipping makes that safe.

## Testing

Backend (vitest):

- Schema: rejects empty array, >500 rows, blank/oversized fields.
- Service (fake repository): creates new names, skips existing with
  "already exists", first-wins + "duplicate in file" for in-file repeats,
  result shape `{ created, skipped, total }`.
- Route: 401 unauthenticated, 403 SURVEYOR, real round-trip creating + skipping
  against the dev DB, and one `Zone BulkCreate` system-log entry written.

Frontend: eslint clean; live verification with a real `.xlsx` and `.csv`
(generated in scratchpad), including re-uploading the same file to confirm all
rows report "already exists".

## Out of scope

- Boundary/polygon data in the file (drawn on the map afterwards).
- Updating existing zones from the file.
- Server-side file parsing; imports from URLs/Google Sheets.
