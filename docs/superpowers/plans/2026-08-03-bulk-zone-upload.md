# Bulk Zone Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins/managers bulk-create zones by uploading an .xlsx/.csv file with Name+City columns, with browser-side parsing, a validity preview, idempotent skip-existing semantics, and a single audit-log entry per import.

**Architecture:** New `POST /api/v1/zones/bulk` endpoint on the existing zones module (zod-validated JSON, sequential create-or-skip in the service). The frontend parses files in the browser (`read-excel-file` for .xlsx, `papaparse` for .csv, both dynamically imported) inside a new `ImportZonesModal` with pick → preview → result states, wired into the admin zones page.

**Tech Stack:** Express 5 + Prisma 6 (JS ESM), zod 4, vitest + supertest; Next.js app router (JS), read-excel-file, papaparse.

**Spec:** `docs/superpowers/specs/2026-08-03-bulk-zone-upload-design.md`

## Global Constraints

- Backend is plain JavaScript ESM; Prisma stays on v6. Response envelope `{ success: true, data }`.
- Bulk cap: **1–500 rows**; `name`/`city` trimmed, 1–100 chars (same as `createZoneSchema`).
- Skip reasons are exactly `"already exists"` and `"duplicate in file"`. Name matching is exact/case-sensitive.
- ONE audit entry per import: `audit('Zone', 'BulkCreate')`, description `Bulk zone import: N created, M skipped`.
- Frontend: parsers dynamically imported inside the modal; no sync `setState` in effect bodies (lint rule `react-hooks/set-state-in-effect`); Design.md tokens; icons only via `@/components/ui/icons`.
- Never kill the user's dev servers; temp servers on alternate ports, kill by PID.
- Backend and frontend are separate git repos — commit each change to its own repo. Work on `feature/bulk-zone-upload` branches.

---

### Task 1: Bulk schema + service logic

**Files:**
- Modify: `src/modules/zones/zone.schemas.js` (append)
- Modify: `src/modules/zones/zone.service.js` (add method)
- Test: `tests/zone-bulk.service.test.js`

**Interfaces:**
- Consumes: existing `zoneRepository.findByName(name)`, `zoneRepository.create(data)`.
- Produces: `bulkZoneSchema` (zod, `{ zones: [{name, city}] }`, 1–500) and `zoneService.bulkCreateZones(rows) -> { created: Zone[], skipped: {name, reason}[], total: number }`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import { createZoneService } from '../src/modules/zones/zone.service.js'
import { bulkZoneSchema } from '../src/modules/zones/zone.schemas.js'

function fakeZoneRepository(existingNames = []) {
  const created = []
  return {
    created,
    findByName: async (name) =>
      existingNames.includes(name) ? { id: `existing-${name}`, name } : null,
    create: async (data) => {
      const zone = { id: `z${created.length + 1}`, boundary: null, ...data }
      created.push(zone)
      return zone
    },
  }
}

describe('bulkZoneSchema', () => {
  it('rejects an empty zones array', () => {
    expect(bulkZoneSchema.safeParse({ zones: [] }).success).toBe(false)
  })

  it('rejects more than 500 rows', () => {
    const zones = Array.from({ length: 501 }, (_, i) => ({ name: `Z${i}`, city: 'Pune' }))
    expect(bulkZoneSchema.safeParse({ zones }).success).toBe(false)
  })

  it('trims and accepts valid rows', () => {
    const parsed = bulkZoneSchema.parse({ zones: [{ name: '  Wakad  ', city: ' Pune ' }] })
    expect(parsed.zones[0]).toEqual({ name: 'Wakad', city: 'Pune' })
  })

  it('rejects blank names', () => {
    expect(bulkZoneSchema.safeParse({ zones: [{ name: '   ', city: 'Pune' }] }).success).toBe(false)
  })
})

describe('bulkCreateZones', () => {
  it('creates new zones and reports them', async () => {
    const repo = fakeZoneRepository()
    const service = createZoneService({ zoneRepository: repo })
    const result = await service.bulkCreateZones([
      { name: 'Wakad West', city: 'Pune' },
      { name: 'Baner', city: 'Pune' },
    ])
    expect(result.created).toHaveLength(2)
    expect(result.skipped).toHaveLength(0)
    expect(result.total).toBe(2)
    expect(repo.created.map((z) => z.name)).toEqual(['Wakad West', 'Baner'])
  })

  it('skips names that already exist in the DB', async () => {
    const repo = fakeZoneRepository(['Baner'])
    const service = createZoneService({ zoneRepository: repo })
    const result = await service.bulkCreateZones([
      { name: 'Baner', city: 'Pune' },
      { name: 'Aundh', city: 'Pune' },
    ])
    expect(result.created.map((z) => z.name)).toEqual(['Aundh'])
    expect(result.skipped).toEqual([{ name: 'Baner', reason: 'already exists' }])
    expect(result.total).toBe(2)
  })

  it('first occurrence wins for duplicates within the file', async () => {
    const repo = fakeZoneRepository()
    const service = createZoneService({ zoneRepository: repo })
    const result = await service.bulkCreateZones([
      { name: 'Wakad', city: 'Pune' },
      { name: 'Wakad', city: 'Mumbai' },
    ])
    expect(result.created).toHaveLength(1)
    expect(result.created[0].city).toBe('Pune')
    expect(result.skipped).toEqual([{ name: 'Wakad', reason: 'duplicate in file' }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/zone-bulk.service.test.js`
Expected: FAIL — `bulkZoneSchema` not exported, `bulkCreateZones` undefined.

- [ ] **Step 3: Append schema to `zone.schemas.js`**

```js
export const bulkZoneSchema = z.object({
  zones: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        city: z.string().trim().min(1).max(100),
      }),
    )
    .min(1)
    .max(500),
})
```

- [ ] **Step 4: Add `bulkCreateZones` to the service object in `zone.service.js`**

```js
    // Sequential create-or-skip; re-uploading the same file is idempotent.
    async bulkCreateZones(rows) {
      const created = []
      const skipped = []
      const seenNames = new Set()
      for (const { name, city } of rows) {
        if (seenNames.has(name)) {
          skipped.push({ name, reason: 'duplicate in file' })
          continue
        }
        seenNames.add(name)
        const existing = await zoneRepository.findByName(name)
        if (existing) {
          skipped.push({ name, reason: 'already exists' })
          continue
        }
        created.push(await zoneRepository.create({ name, city }))
      }
      return { created, skipped, total: rows.length }
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/zone-bulk.service.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/zones/zone.schemas.js src/modules/zones/zone.service.js tests/zone-bulk.service.test.js
git commit -m "feat: bulk zone create schema and service (skip-existing, first-wins)"
```

---

### Task 2: Route + controller + audit + route tests

**Files:**
- Modify: `src/modules/zones/zone.controller.js` (add `bulk`)
- Modify: `src/modules/zones/zone.routes.js` (add POST /bulk)
- Test: `tests/zones-bulk.route.test.js`

**Interfaces:**
- Consumes: `bulkZoneSchema`, `zoneService.bulkCreateZones` (Task 1); existing `audit` middleware (`audit(module, action, opts)` — `opts.describe(req, oldValue, resBody)`).
- Produces: `POST /api/v1/zones/bulk` (ADMIN/MANAGER) → `{ success: true, data: { created, skipped, total } }`.

- [ ] **Step 1: Write the failing route test**

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'

const tokenFor = (role) =>
  jwt.sign({ sub: `test-${role.toLowerCase()}`, role }, env.jwtSecret, { expiresIn: '1h' })

describe('POST /api/v1/zones/bulk', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).post('/api/v1/zones/bulk').send({ zones: [] })
    expect(res.status).toBe(401)
  })

  it('rejects SURVEYOR', async () => {
    const res = await request(createApp())
      .post('/api/v1/zones/bulk')
      .set('Authorization', `Bearer ${tokenFor('SURVEYOR')}`)
      .send({ zones: [{ name: 'X', city: 'Y' }] })
    expect(res.status).toBe(403)
  })

  it('rejects an invalid body', async () => {
    const res = await request(createApp())
      .post('/api/v1/zones/bulk')
      .set('Authorization', `Bearer ${tokenFor('ADMIN')}`)
      .send({ zones: [] })
    expect(res.status).toBe(400)
  })

  it('creates new zones, skips repeats, and writes one audit entry', async () => {
    const stamp = Date.now()
    const nameA = `BulkA-${stamp}`
    const nameB = `BulkB-${stamp}`
    const payload = { zones: [{ name: nameA, city: 'Pune' }, { name: nameB, city: 'Pune' }] }
    const auth = ['Authorization', `Bearer ${tokenFor('ADMIN')}`]

    const first = await request(createApp()).post('/api/v1/zones/bulk').set(...auth).send(payload)
    expect(first.status).toBe(200)
    expect(first.body.data.created).toHaveLength(2)
    expect(first.body.data.skipped).toHaveLength(0)
    expect(first.body.data.total).toBe(2)

    // Idempotent re-upload: everything skips.
    const second = await request(createApp()).post('/api/v1/zones/bulk').set(...auth).send(payload)
    expect(second.status).toBe(200)
    expect(second.body.data.created).toHaveLength(0)
    expect(second.body.data.skipped).toEqual([
      { name: nameA, reason: 'already exists' },
      { name: nameB, reason: 'already exists' },
    ])

    // One BulkCreate audit entry per import (2 imports above).
    await vi.waitFor(async () => {
      const entries = await prisma.systemLog.findMany({
        where: { module: 'Zone', action: 'BulkCreate' },
        orderBy: { createdAt: 'desc' },
        take: 2,
      })
      expect(entries).toHaveLength(2)
      expect(entries[1].description).toBe('Bulk zone import: 2 created, 0 skipped')
      expect(entries[0].description).toBe('Bulk zone import: 0 created, 2 skipped')
    })

    // Cleanup the zones this test created (they have no buildings).
    await prisma.zone.deleteMany({ where: { name: { in: [nameA, nameB] } } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/zones-bulk.route.test.js`
Expected: FAIL — POST /bulk returns 404.

- [ ] **Step 3: Add `bulk` to `zone.controller.js`**

```js
  async bulk(req, res, next) {
    try {
      const result = await zoneService.bulkCreateZones(req.body.zones)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
```

- [ ] **Step 4: Add the route in `zone.routes.js`** (after the single-create registration; imports for `audit`, `bulkZoneSchema` already partially exist — extend the schema import)

```js
zoneRoutes.post(
  '/bulk',
  requireRole('ADMIN', 'MANAGER'),
  audit('Zone', 'BulkCreate', {
    describe: (req, old, body) =>
      body?.data
        ? `Bulk zone import: ${body.data.created.length} created, ${body.data.skipped.length} skipped`
        : 'Bulk zone import',
  }),
  validateBody(bulkZoneSchema),
  zoneController.bulk,
)
```

- [ ] **Step 5: Run tests to verify they pass, then the full suite**

Run: `npx vitest run tests/zones-bulk.route.test.js` → PASS (4 tests)
Run: `npm test` → all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/zones/zone.controller.js src/modules/zones/zone.routes.js tests/zones-bulk.route.test.js
git commit -m "feat: POST /zones/bulk with single BulkCreate audit entry"
```

---

### Task 3: ImportZonesModal component (frontend)

**Files (frontend repo):**
- Modify: `package.json` — `npm install read-excel-file papaparse`
- Modify: `src/components/ui/icons.js` — add `Upload as IconUpload,` inside the lucide re-export block
- Create: `src/components/admin/ImportZonesModal.js`

**Interfaces:**
- Consumes: `Modal` (`{ open, onClose, title, children }`), `Button` (`variant`, `fullWidth`, `disabled`, `loading`), `apiClient`, `getApiErrorMessage`.
- Produces: `<ImportZonesModal open onClose onImported />` — `onImported()` fires after a successful import so the page can refresh its list.

- [ ] **Step 1: Install parsers**

Run: `npm install read-excel-file papaparse`

- [ ] **Step 2: Add the icon re-export** (in the `export { ... } from 'lucide-react'` block)

```js
  Upload as IconUpload,
```

- [ ] **Step 3: Implement `ImportZonesModal.js`**

```js
'use client'

import { useRef, useState } from 'react'
import { apiClient, getApiErrorMessage } from '@/lib/api-client'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { IconUpload, IconOkCircle, IconWarn } from '@/components/ui/icons'

const MAX_ROWS = 500
const MAX_LEN = 100

/** Parse .xlsx/.csv into [[cellA, cellB], ...] of trimmed strings. */
async function parseFile(file) {
  const ext = file.name.toLowerCase().split('.').pop()
  let rows
  if (ext === 'xlsx') {
    const readXlsxFile = (await import('read-excel-file')).default
    rows = await readXlsxFile(file)
  } else if (ext === 'csv') {
    const Papa = (await import('papaparse')).default
    const result = await new Promise((resolve, reject) =>
      Papa.parse(file, { skipEmptyLines: 'greedy', complete: resolve, error: reject }),
    )
    rows = result.data
  } else {
    throw new Error('Unsupported file type — upload a .xlsx or .csv file')
  }
  return rows.map((row) => [row?.[0], row?.[1]].map((cell) => String(cell ?? '').trim()))
}

/** Rows -> {name, city, row, error?}; drops an auto-detected header row. */
function validateRows(rawRows) {
  let rows = rawRows.map((cells, index) => ({ cells, row: index + 1 }))
  const first = rows[0]?.cells
  if (first && /^name$/i.test(first[0]) && /^city$/i.test(first[1])) rows = rows.slice(1)
  return rows
    .filter(({ cells }) => cells[0] || cells[1]) // ignore fully blank lines
    .map(({ cells: [name, city], row }) => {
      let error = null
      if (!name) error = 'Name is missing'
      else if (name.length > MAX_LEN) error = `Name is over ${MAX_LEN} characters`
      else if (!city) error = 'City is missing'
      else if (city.length > MAX_LEN) error = `City is over ${MAX_LEN} characters`
      return { name, city, row, error }
    })
}

function downloadTemplate() {
  const blob = new Blob(['Name,City\nWakad West,Pune\nBaner,Pune\n'], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'zones-template.csv'
  link.click()
  URL.revokeObjectURL(url)
}

export function ImportZonesModal({ open, onClose, onImported }) {
  const fileInputRef = useRef(null)
  const [rows, setRows] = useState(null) // null = pick state
  const [result, setResult] = useState(null) // set = result state
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const validRows = rows?.filter((r) => !r.error) ?? []

  function reset() {
    setRows(null)
    setResult(null)
    setError(null)
    setBusy(false)
  }

  function close() {
    reset()
    onClose()
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setError(null)
    try {
      const parsed = validateRows(await parseFile(file))
      if (parsed.length === 0) throw new Error('No rows found in the file')
      if (parsed.filter((r) => !r.error).length > MAX_ROWS)
        throw new Error(`Too many rows — up to ${MAX_ROWS} zones per file. Please split the file.`)
      setRows(parsed)
    } catch (err) {
      setError(err.message || 'Could not read the file')
    }
  }

  async function handleImport() {
    setBusy(true)
    setError(null)
    try {
      const res = await apiClient.post('/zones/bulk', {
        zones: validRows.map(({ name, city }) => ({ name, city })),
      })
      setResult(res.data.data)
      onImported()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Import failed — please re-upload (existing zones are skipped)'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="Import zones from Excel">
      {/* Pick state */}
      {!rows && !result && (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-normal text-muted">
            Upload a .xlsx or .csv file with two columns: <b>Name</b> and <b>City</b>. A header
            row is optional. Existing zone names are skipped, so re-uploading is safe.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            onChange={handleFile}
            className="hidden"
          />
          <Button fullWidth onClick={() => fileInputRef.current?.click()}>
            <IconUpload className="h-4.5 w-4.5" /> Choose file
          </Button>
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-sm font-medium text-fiber underline-offset-2 hover:underline"
          >
            Download template (.csv)
          </button>
        </div>
      )}

      {/* Preview state */}
      {rows && !result && (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-normal text-muted">
            {validRows.length} of {rows.length} rows are valid.
          </p>
          <div className="max-h-72 overflow-y-auto rounded-btn border border-line">
            {rows.map((r) => (
              <div
                key={r.row}
                className="flex items-center gap-2 border-b border-line/60 px-3 py-2 text-sm last:border-b-0"
              >
                {r.error ? (
                  <IconWarn className="h-4 w-4 shrink-0 text-bad" />
                ) : (
                  <IconOkCircle className="h-4 w-4 shrink-0 text-ok" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{r.name || '—'}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{r.city || '—'}</span>
                {r.error && <span className="shrink-0 text-xs text-bad">row {r.row}: {r.error}</span>}
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={reset}>
              Back
            </Button>
            <Button fullWidth disabled={validRows.length === 0} loading={busy} onClick={handleImport}>
              Import {validRows.length} zone{validRows.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      )}

      {/* Result state */}
      {result && (
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium">
            {result.created.length} created · {result.skipped.length} skipped
          </p>
          {result.skipped.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-btn border border-line">
              {result.skipped.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2 text-sm last:border-b-0"
                >
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="shrink-0 text-xs text-muted">{s.reason}</span>
                </div>
              ))}
            </div>
          )}
          <Button fullWidth onClick={close}>
            Done
          </Button>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-btn bg-bad-tint px-4 py-3 text-sm font-normal text-bad">{error}</p>
      )}
    </Modal>
  )
}
```

- [ ] **Step 4: Lint the new file**

Run: `npx eslint src/components/admin/ImportZonesModal.js`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/ui/icons.js src/components/admin/ImportZonesModal.js
git commit -m "feat: zones Excel/CSV import modal with preview and result states"
```

---

### Task 4: Wire the modal into the zones page

**Files (frontend repo):**
- Modify: `src/app/(app)/admin/zones/page.js`

**Interfaces:**
- Consumes: `ImportZonesModal` (Task 3), existing `fetchZones` callback.

- [ ] **Step 1: Add imports** (top of file, alongside existing ui imports)

```js
import { ImportZonesModal } from '@/components/admin/ImportZonesModal'
import { IconUpload } from '@/components/ui/icons'
```

(Extend the existing `icons` import line rather than adding a second one.)

- [ ] **Step 2: Add modal state + trigger in `AdminZonesPage`**

Add state next to the existing useState calls:

```js
  const [importOpen, setImportOpen] = useState(false)
```

Insert the trigger button between `<PageHeader …/>` and `<ZoneForm …/>`:

```js
      <div className="mb-3 flex justify-end">
        <button
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-2 rounded-btn border border-line bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:border-fiber/50"
        >
          <IconUpload className="h-4 w-4" /> Import from Excel
        </button>
      </div>
```

Add the modal just before the closing `</main>`:

```js
      <ImportZonesModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={fetchZones}
      />
```

- [ ] **Step 3: Lint**

Run: `npx eslint "src/app/(app)/admin/zones/page.js"`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/admin/zones/page.js"
git commit -m "feat: import-from-excel entry point on admin zones page"
```

---

### Task 5: Live verification + finish

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test` → all PASS.

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build` → compiles clean.

- [ ] **Step 3: Live end-to-end**

Generate test files in the scratchpad: a `zones-test.csv` (`Name,City` header + 3 rows, one blank name) and a real `.xlsx` with the same content (script it with a small Node script using `read-excel-file`'s sibling or generate via a spreadsheet lib in scratchpad only — or verify .xlsx manually in the browser). Against running servers (temp ports if the user's servers are down):

1. Zones page → Import from Excel → template download works.
2. Upload the CSV → preview shows 2 valid + 1 invalid (blank name, with row number).
3. Import → result "2 created, 0 skipped"; zone list refreshes and shows them.
4. Re-upload the same file → result "0 created, 2 skipped (already exists)".
5. Upload the .xlsx variant → same behavior.
6. System logs page → one `Zone · BulkCreate` entry per import with the right description.
7. Clean up test zones via the UI delete button.

- [ ] **Step 4: Report results honestly, then use superpowers:finishing-a-development-branch**
