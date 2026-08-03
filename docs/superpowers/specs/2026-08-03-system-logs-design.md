# System Logs (Audit Trail) — Design

**Date:** 2026-08-03
**Status:** Approved
**Source spec:** `system-logs.md` (project root), adapted to this codebase per decisions below.

## Overview

An admin-only audit trail that automatically records every mutating action and all
authentication events across the application, with a searchable, filterable, paginated
table UI in the existing admin section.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Module scope | Existing modules only: Auth, User, Zone, Building, BuildingType, Upload. Generic `module` string field so future modules plug in without schema changes. |
| Capture trigger | All mutating API calls (POST/PATCH/PUT/DELETE) + auth events (login, logout, failed login). GET requests are not logged. |
| Capture mechanism | Annotated per-route audit middleware (`audit(module, action, opts)`) with optional `load()` for old-value snapshots. |
| Export | None. Table + pagination only (deviation from source spec, per user). |
| Retention | Keep forever. No deletion path exists. |
| Session ID | Dropped — stateless JWT, no server-side sessions. `userId + timestamp + ipAddress` covers the forensic need. |

## Access control

Only `ADMIN` may read logs (`requireAuth` + `requireRole('ADMIN')`). MANAGER and
SURVEYOR get 403. No role can update or delete logs — those routes do not exist.

## Data model

New Prisma model, append-only. User fields are denormalized snapshots (no FK to
`User`) so log entries survive user deletion/rename and record who the user was at
the time of the action.

```prisma
model SystemLog {
  id           String   @id @default(cuid())
  userId       String?   // null for failed logins with unknown email
  userName     String?
  userEmail    String?
  userRole     String?
  module       String    // Auth | User | Zone | Building | BuildingType | Upload
  action       String    // Login | Logout | FailedLogin | Create | Update | Delete | ...
  description  String    // human-readable, e.g. "Building 'Tower A' updated"
  oldValue     Json?     // sanitized pre-change snapshot (updates/deletes)
  newValue     Json?     // sanitized request body (creates/updates)
  recordId     String?   // affected record id
  buildingId   String?   // related building where applicable
  ipAddress    String?
  device       String?   // Desktop | Mobile | Tablet
  browser      String?
  os           String?
  requestUrl   String
  httpMethod   String
  status       String    // SUCCESS | FAILED
  statusCode   Int?
  errorMessage String?   // populated when status = FAILED
  createdAt    DateTime @default(now())

  @@index([createdAt])
  @@index([userId])
  @@index([module, action])
}
```

Timestamps are stored in UTC (Postgres default) and rendered in the viewer's local
timezone in the browser.

## Backend

New module `src/modules/system-logs/` following the existing pattern
(routes / controller / service / repository) plus the audit middleware.

### Audit middleware — `audit(module, action, opts)`

Mounted per-route on every mutating endpoint:

```js
buildingRoutes.patch('/:id',
  audit('Building', 'Update', {
    load: (req) => buildingRepository.findById(req.params.id),
  }),
  buildingController.update)
```

Behavior:

- If `opts.load` is provided (updates/deletes), it runs before the handler and the
  result is stored as `oldValue`.
- Listens for the response `finish` event, then writes the log entry
  **fire-and-forget**: logging never blocks or fails the actual request. Write
  errors are logged to the server console only.
- `newValue` = request body; `oldValue` = loaded snapshot. Both pass through a
  sanitizer that strips `password`, `passwordHash`, and any key matching `/token/i`.
- Status ≥ 400 → `status: 'FAILED'` with `errorMessage` taken from the JSON error
  response; otherwise `SUCCESS`. Failed operations are logged the same as successes.
- `description` is built from module + action + a best-effort record name
  (`opts.describe(req, oldValue)` override available per route).
- IP from `req.ip` (`trust proxy` is already enabled in production).
- Device/Browser/OS parsed from the `User-Agent` header via `ua-parser-js`
  (plain-JS dependency, consistent with the JS-only backend and Prisma 6 pin).

### Auth events (explicit calls)

The middleware cannot identify a user before login succeeds, so the auth service
logs explicitly through the same log-writing service:

- **Login success** — userId, name, email, role recorded.
- **Failed login** — attempted email recorded in `description`/`newValue.email`,
  `userId` null, `status: 'FAILED'`.
- **Logout** — new `POST /api/v1/auth/logout` endpoint (requires auth) whose only
  job is recording the logout event before the frontend discards the token.

### Read API

```
GET /api/v1/system-logs            ADMIN only
  ?page=1&pageSize=50
  &dateFrom=&dateTo=               ISO dates, inclusive range on createdAt
  &userId=&role=&module=&action=&status=&ipAddress=
  &search=                         case-insensitive match on userName, userEmail,
                                   description, recordId, ipAddress
```

Response: `{ success: true, data: { items, total, page, pageSize } }`, ordered
`createdAt desc`. Filters combine with AND; `search` ORs across its fields.

### Immutability

Application-level: the module exposes only create (internal) and read (admin).
No update or delete route exists for `SystemLog` anywhere in the API.

## Frontend

New page `src/app/(app)/admin/system-logs/page.js` + a "System Logs" nav link in
the existing admin layout. Follows Design.md tokens (emerald/slate/Inter/Lucide)
and the structure of the existing admin pages (users, zones, building-types).

- **Filter bar:** date range (from/to), user, module, action, status dropdowns,
  and a debounced free-text search box. Module/action options come from shared
  constants; the user dropdown reuses the existing admin users list endpoint.
- **Table** (50 rows/page, server-side pagination): Timestamp (local tz) · User
  (name + role badge) · Module · Action · Description · IP Address · Status.
- **Expandable rows:** clicking a row reveals old/new values (side-by-side JSON),
  device/browser/OS, request URL, HTTP method, and error message. Keeps the table
  scannable while every captured field stays accessible.
- No export controls.

## Testing

Backend (vitest, existing setup):

- Middleware: entry written on success; `load()` snapshot stored as `oldValue`;
  password/token fields stripped; 4xx/5xx logged as FAILED with error message;
  response not delayed by log write.
- Auth: login success, failed login, and logout each produce a log entry.
- Access control: GET returns 403 for MANAGER and SURVEYOR, 200 for ADMIN.
- List endpoint: pagination, each filter, combined filters, and search.

Frontend: manual + Playwright pass (page renders, filters narrow results,
pagination works, row expansion shows details), matching how prior features were
validated.

## Out of scope

- Floors, Rooms, Tenants, Maintenance modules (do not exist in this app).
- Export (Excel/CSV/PDF), retention/purge jobs, log archival.
- Logging GET requests, page views, or client-side button clicks.
