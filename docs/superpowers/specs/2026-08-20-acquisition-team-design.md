# Acquisition Team — ISP Survey Users

**Status:** Approved (2026-08-20) · decisions confirmed with the user
**Scope:** new role pair (agent + lead), contact capture, selfies, pincode
mapping, private data visibility, lead dashboard.

---

## 1. Goal

Add a second, independent field team to the platform — an **acquisition
team** that walks buildings, meets the decision-maker (chairman, secretary,
manager…), records who they met with photo proof, and logs the building.

They differ from today's coverage surveyors in three fundamental ways:

| | Coverage surveyor (today) | Acquisition agent (new) |
|---|---|---|
| Territory | assigned **zones** | assigned **city + pincodes** |
| Can see | every building in their zones | **only what they personally added** |
| Captures | building + survey details | building + **contact person + selfies** |

An **acquisition lead** runs the team: creates agent logins, and tracks each
agent's daily output on a dedicated dashboard. The lead never sees the
existing coverage registry either.

**Non-goal:** changing anything about how the current surveyors, zones,
operators, fiber or map work. This team runs alongside them.

---

## 2. Roles

Two new roles join `ADMIN | MANAGER | SURVEYOR`:

- **`ACQUISITION_AGENT`** — UI label *Acquisition agent*. The field user.
- **`ACQUISITION_LEAD`** — UI label *Acquisition lead*. Their team lead.

Hierarchy: `ADMIN → ACQUISITION_LEAD → ACQUISITION_AGENT`.

### Permission matrix

| Capability | Agent | Lead | Admin |
|---|---|---|---|
| Add building (with contact + selfies) | ✅ | ❌ | ✅ |
| See own added buildings | ✅ | ✅ (all agents') | ✅ |
| See coverage-team buildings | ❌ | ❌ | ✅ |
| See map / zones / operators / fiber | ❌ | ❌ | ✅ |
| Create + edit agent logins | ❌ | ✅ (agents only) | ✅ |
| Acquisition dashboard (per-agent stats) | ❌ | ✅ | ✅ |
| Edit/delete a logged building | own, before lock | ❌ | ✅ |

---

## 3. Territory: city + pincodes

Agents are **not** mapped to zones. They are mapped to:

- exactly **one city** (existing `City` model — Pune, PCMC, Sambhaji Nagar…)
- **one or more pincodes** (e.g. 411014, 411057)

Set at user creation and editable later. Stored as a new `UserPincode`
mapping (`userId + cityId + pincode`), so an agent can cover several
pincodes in a city and the assignment history stays queryable.

The agent's add-building form pre-fills their city and offers **their**
pincodes as a dropdown — they never type a pincode by hand or pick someone
else's.

---

## 4. Data model changes

**`Building`**
- `zoneId` becomes **nullable** — acquisition buildings have no coverage zone.
- new `cityId` (nullable, → `City`) and `pincode` (nullable, string).
- new `source` enum: `COVERAGE` (default, everything today) | `ACQUISITION`.

Everything existing keeps its zone and behaves identically; zone filters
simply don't match zone-less buildings.

**`BuildingContact`** (new, one per building)
- `contactName`, `contactPhone`, `contactEmail` (optional),
  `designation` (enum below), `designationOther` (free text when *Other*).

**Designations:** `CHAIRMAN | SECRETARY | MANAGER | OWNER | TREASURER |
COMMITTEE_MEMBER | WATCHMAN | OTHER`.

**`PhotoType`** gains two values:
- `SELFIE` — the agent's own selfie at the building (proof of visit)
- `CONTACT_PERSON` — photo of / with the contact person

**`UserPincode`** (new) — `userId`, `cityId`, `pincode`.

---

## 5. Agent experience

1. **Login → straight to "My buildings"** (their own list only). No map tab,
   no coverage registry, no zones/operators/fiber in the sidebar.
2. **Add building** reuses the existing 3-step flow (search → confirm
   location → details) with these changes:
   - city is fixed to theirs; **pincode** is a required dropdown of their
     assigned pincodes; no zone picker.
   - a required **Contact person** section: name, phone, designation
     (dropdown + Other), email (optional).
   - a required **Selfie** photo and a required **Contact person** photo,
     alongside the existing optional entrance/additional photos.
3. **Duplicate protection:** the nearby check still runs. Buildings they
   didn't add appear **masked** — "A building already exists here · 25 m"
   with no name, address, owner or status. Prevents duplicate visits
   without leaking the coverage registry.
4. **Their list** shows their buildings with contact name, designation,
   pincode and date; tapping one opens the full detail (including their
   selfies) — all read-only except their own edits.

---

## 6. Lead experience

A dedicated **Acquisition dashboard** (their landing page):

- **KPI row:** buildings logged today / this week / this month, active
  agents, total contacts captured.
- **Date-range filter** (Today · Yesterday · Last 7 days · Last 30 days ·
  custom from–to) driving everything on the page.
- **Per-agent table:** agent name, buildings logged in range, last activity
  timestamp, pincodes covered — sortable, clickable through to that agent's
  buildings for the same range.
- **Trend chart:** buildings logged per day across the range.
- **Team management:** create an agent (name, email, password, city,
  pincodes), edit their pincodes, deactivate. Leads may only create/edit
  `ACQUISITION_AGENT` users — never admins, managers or coverage surveyors.

The lead sees **acquisition buildings only** — the coverage registry, map,
zones, operators and fiber are absent from their navigation and blocked at
the API.

---

## 7. Visibility rules (enforced server-side)

| Actor | Building rows returned |
|---|---|
| `ACQUISITION_AGENT` | `createdById = self` **only** |
| `ACQUISITION_LEAD` | `source = ACQUISITION` (all agents) |
| `SURVEYOR` | unchanged: assigned zones + own |
| `MANAGER` | coverage rows (unchanged) |
| `ADMIN` | everything |

Enforced in the service layer like today's surveyor scoping — never trusted
from the client. Out-of-scope rows 404 rather than 403 so existence never
leaks.

---

## 8. Acceptance criteria

- [ ] Admin can create an acquisition lead; the lead can create agents with
      a city + pincodes; both can be edited later.
- [ ] Agent's add-building requires contact name, phone, designation, a
      selfie and a contact photo; pincode comes from their assignment.
- [ ] Agent sees only their own buildings — API returns nothing else, and
      the UI has no map/zones/operators/fiber.
- [ ] A nearby building added by anyone else shows only distance + "already
      exists", never identifying details.
- [ ] Lead's dashboard shows per-agent counts and a trend for any date
      range, and can drill into one agent's buildings.
- [ ] Lead cannot see, list or open any coverage building; cannot create
      non-agent users.
- [ ] Existing surveyors, managers, admins, zones, map and fiber behave
      exactly as before (regression-tested).

---

## 9. Build order

1. **Backend foundation** — roles, `UserPincode`, building `source`/`cityId`/
   `pincode`/nullable `zoneId`, `BuildingContact`, new photo types, migration.
2. **Backend rules** — scoping, agent create-building validation, lead user
   management, acquisition stats endpoint.
3. **Agent UI** — role-aware navigation, add-building extensions, my-buildings.
4. **Lead UI** — acquisition dashboard, agent management.
5. **Regression pass** — existing roles untouched.
