# PRD.md
# ISP Building Feasibility & Coverage Mapping System

## 1. Project Overview

### Objective
Build a mobile-first web application for ISP field survey teams to capture, manage, and visualize buildings where fiber connectivity exists or can be deployed.

The system becomes the single source of truth for:
- Which buildings are already surveyed
- Which are feasible for fiber deployment
- Which have pending permissions
- Home pass potential
- Permission documents
- Exact building locations

---

## 2. Goals

- Eliminate spelling mistakes in building names.
- Capture accurate GPS coordinates.
- Prevent duplicate building entries.
- Visualize all surveyed buildings on a map.
- Reduce dependency on manual feasibility checks.
- Provide a scalable foundation for future network assets (poles, fiber routes, POPs, cabinets).

---

## 3. Tech Stack

### Frontend
- Next.js (App Router)
- Tailwind CSS
- Zustand
- React Hook Form
- Zod
- Leaflet + OpenStreetMap (Development)
- Google Maps JavaScript API (Production)

### Backend
- Node.js
- Express.js
- Prisma ORM
- PostgreSQL
- Multer
- JWT Authentication

### Storage
- Local storage during development
- S3-compatible storage (Cloudflare R2 / AWS S3) for production

---

## 4. Development Strategy

### Development
- Leaflet
- OpenStreetMap tiles
- Nominatim Search API
- Browser Geolocation API

### Production
Replace only:
- Nominatim Search
with
- Google Places Autocomplete
- Google Place Details

Everything else remains unchanged.

---

# Phase 1 – Foundation

## Authentication
- Login
- Roles
- JWT

Roles:
- Admin
- Survey Team
- Manager

---

## Database Design

### Building

- id
- placeId (nullable)
- buildingName
- formattedAddress
- latitude
- longitude
- zoneId
- feasibleStatus
- surveyStatus
- createdBy
- createdAt
- updatedAt

### Building Details

- buildingId
- wings
- floors
- homePass
- buildingType
- remarks

### Permission

- buildingId
- amountPaid
- permissionStatus
- permissionDate
- renewalDate
- ownerName
- ownerMobile
- documentUrl

### Photos

- buildingId
- entrancePhoto
- permissionLetter
- additionalPhotos

---

# Phase 2 – Add Building Flow

## Workflow

Employee arrives at building

↓

Clicks "Add Building"

↓

Browser requests GPS permission

↓

Current location obtained

↓

Search nearby buildings

↓

Employee selects building

↓

Auto-fill
- Building Name
- Address
- Latitude
- Longitude
- Place ID

↓

Manual entry
- Zone
- Wings
- Floors
- Home Pass
- Building Type
- Remarks
- Amount Paid

↓

Upload
- Permission Letter
- Photos

↓

Save

---

## Google/OpenStreetMap Search Rules

If building exists in map provider

Use:
- Name
- Address
- Lat
- Long
- Place ID

If building not found

Allow manual creation

Still capture GPS automatically.

---

# Phase 3 – Duplicate Prevention

Before saving

Search own database within configurable radius (default 100 m).

If building exists

Display warning

Possible Existing Building

Allow user to:
- Open existing
- Continue only with confirmation

Primary unique key:
- Google Place ID (production)
- Coordinate + name heuristic (development)

---

# Phase 4 – Map Dashboard

Display buildings on interactive map.

Marker colors

🟢 Feasible

🟡 Permission Pending

🔴 Rejected

🔵 Survey Pending

Clicking marker opens:

- Building Name
- Zone
- Home Pass
- Wings
- Floors
- Permission Status
- Amount Paid
- Documents
- Photos
- Survey History

Filters:
- Zone
- Status
- Surveyor
- Date
- Radius

Search by:
- Building
- Address
- Zone

---

# Phase 5 – Document Management

Upload:
- Permission Letter (PDF/Image)
- Entrance Photo
- Optional Supporting Photos

Future:
- Cloud object storage
- Version history

---

# Phase 6 – Administration

Manage:
- Zones
- Users
- Building Types
- Status values

Dashboard KPIs
- Total Buildings
- Feasible
- Pending
- Rejected
- Total Home Pass
- Total Permission Cost

---

# Future Roadmap

The system should evolve into a Network Asset Management platform.

Future assets:
- Fiber Routes
- Poles
- Junction Boxes
- Splice Closures
- POPs
- Cabinets
- OLTs

Buildings become one asset type among many.

---

# Challenges & Mitigations

## 1. GPS Accuracy
Issue:
Indoor GPS can be inaccurate.

Solution:
Display GPS accuracy.
Warn users above threshold (e.g. >20 m).

---

## 2. Missing Buildings

Some buildings won't exist in map data.

Solution:
Manual building creation with automatic GPS.

---

## 3. Duplicate Buildings

Solution:
- Place ID uniqueness
- Radius search
- Confirmation dialog

---

## 4. Wrong Building Selection

Solution:
Show map preview.
Allow slight marker adjustment before save.

---

## 5. Offline Areas

Future enhancement:
Offline draft storage and later synchronization.

---

## 6. Large Documents

Use compression.
Store files outside database.

---

## 7. Map Performance

Enable marker clustering for thousands of buildings.

---

## 8. Google API Cost

Only call Google when adding a new building.

After saving:
Serve all subsequent data from your own database.

Cache:
- Place ID
- Coordinates
- Address

---

# UX Principles

- Mobile-first
- One-handed operation
- Minimum typing
- GPS-first
- Search-first
- Prevent duplicates before creation
- Fast field workflow

---

# Success Criteria

- Accurate building names
- Accurate coordinates
- Duplicate reduction
- Fast surveys
- Instant feasibility visibility
- Scalable architecture
