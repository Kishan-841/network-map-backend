# ISP Building Feasibility & Coverage System — Architecture Design

Date: 2026-07-22
Status: Approved
Source of truth: `PRD.md` (this document records architecture decisions; the PRD defines requirements)

## 1. Overview

Mobile-first web application for ISP field survey teams to capture buildings,
GPS coordinates, permissions, and feasibility status, visualized on an
interactive map. Built phase by phase per the PRD; this design covers the
system-wide architecture and Phase 1 in detail.

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo layout | Monorepo: `backend/` (Express) + `frontend/` (Next.js App Router) | PRD mandates separate Express API; future clients (mobile, admin) share it |
| Database | Local Homebrew PostgreSQL 15 | User's environment choice |
| Geo radius queries | Haversine + indexed bounding-box pre-filter on plain lat/lng columns | Zero extra deps; handles 100k+ point-radius searches; swappable for PostGIS later behind the repository layer |
| Language | JavaScript (no TypeScript) | PRD mandate |
| Auth | JWT access token, 7-day expiry, `Authorization: Bearer` header | Field teams cannot re-login mid-survey; internal tool risk profile |
| User provisioning | No self-registration. Seed script creates first Admin; Admins create users via API | PRD Phase 6 lists user management under Administration |
| File storage | `StorageProvider` abstraction: `LocalStorageProvider` now, S3/R2 later | PRD mandate: minimal-change swap |
| Map services | `MapProvider` abstraction (frontend): `NominatimProvider` now, `GooglePlacesProvider` in production | PRD mandate: minimal-change swap |

## 3. Repo Structure

```
network-graph-map/
├── PRD.md
├── docs/superpowers/specs/
├── backend/
│   ├── prisma/schema.prisma
│   ├── uploads/                  # local file storage (gitignored)
│   └── src/
│       ├── config/               # env parsing, constants (radius default, GPS accuracy threshold)
│       ├── middleware/           # auth, roles, error handler, zod validation
│       ├── modules/<feature>/    # routes → controller → service → repository per module
│       │   ├── auth/  buildings/  zones/  users/  uploads/
│       ├── lib/                  # prisma client, geo utils, storage/ providers
│       ├── app.js                # express app assembly
│       └── server.js             # entrypoint
└── frontend/
    └── src/
        ├── app/                  # App Router pages
        ├── components/ui|map|buildings/
        ├── hooks/                # useGeolocation, useNearbyBuildings, ...
        ├── lib/                  # axios instance, map-providers/
        ├── stores/               # Zustand
        └── schemas/              # Zod validation schemas
```

Backend layering: **routes** declare endpoints + validation, **controllers**
translate HTTP ⇄ service calls, **services** hold business logic,
**repositories** hold Prisma/data access. React components contain no business
logic; hooks and services do.

## 4. Data Model (Prisma)

- `User`: id, name, email (unique), passwordHash, role enum `ADMIN | MANAGER | SURVEYOR`, isActive, timestamps
- `Zone`: id, name, city — admin-managed lookup
- `Building`: id, placeId (nullable, unique), buildingName, formattedAddress,
  latitude, longitude (compound index `(latitude, longitude)`), zoneId → Zone,
  feasibleStatus enum `FEASIBLE | PERMISSION_PENDING | REJECTED | SURVEY_PENDING`,
  surveyStatus enum `PENDING | COMPLETED`, createdBy → User, timestamps
- `BuildingDetails` (1–1 Building): wings, floors, homePass, buildingType, remarks
- `Permission` (1–1 Building): amountPaid, permissionStatus, permissionDate,
  renewalDate, ownerName, ownerMobile, documentUrl
- `Photo` (1–N Building): type enum `ENTRANCE | PERMISSION_LETTER | ADDITIONAL`, url

Future network assets (poles, fiber routes, cabinets) become sibling tables
reusing the same conventions (lat/lng, zoneId, createdBy); no polymorphic
asset table until actually needed.

## 5. API Conventions

- Base path `/api/v1`
- Response envelope: `{ success: true, data }` / `{ success: false, error: { code, message, details? } }`
- Zod validation at route boundary; centralized error middleware maps known
  errors → HTTP codes (400 validation, 401 auth, 403 role, 404, 409 duplicate)
- Auth middleware: `requireAuth`, `requireRole(...roles)`

## 6. Phase Plan (per PRD)

1. **Foundation**: monorepo scaffold, Prisma schema + migration, seed (admin
   user + sample zones), auth module (login, JWT, roles), user CRUD (admin),
   mobile-first UI shell (login page, authenticated layout, bottom nav)
2. **Add Building Flow**: GPS capture, nearby search via MapProvider,
   auto-fill, manual entry form, save
3. **Duplicate Prevention**: radius search endpoint, warning dialog flow
4. **Map Dashboard**: Leaflet map, colored markers, detail sheet, filters, search
5. **Document Management**: Multer uploads via StorageProvider, photo/document association
6. **Administration**: zones/users/types management, KPI dashboard

Each phase: explain → implement → wait for approval (PRD mandate).

## 7. Error Handling & Testing

- Backend: centralized error middleware; async handlers wrapped; Prisma known
  errors translated (e.g. unique violation → 409)
- Frontend: axios interceptor for 401 → redirect to login; form errors via
  React Hook Form + Zod resolver
- Testing: backend service/repository unit tests with Vitest as modules are
  built; GPS/geolocation mocked in frontend hook tests

## 8. Non-Goals (now)

- PostGIS, offline sync, marker clustering, cloud storage, Google APIs —
  all designed-for but deferred per PRD roadmap.
