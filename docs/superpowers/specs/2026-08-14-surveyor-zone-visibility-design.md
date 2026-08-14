# Surveyor Zone Visibility

**Date:** 2026-08-14
**Status:** Approved

## Problem

Surveyors only see buildings they created. When an admin (or anyone else)
adds a building in a surveyor's assigned zone, the surveyor can't see it,
assumes it doesn't exist, and adds a duplicate.

## Decision

Surveyor **read scope** changes from "buildings I created" to:

> buildings in my assigned zones **OR** buildings I created

The `createdById` half keeps a surveyor's own work visible if they're later
unassigned from a zone (their write permissions are ownership-based, so the
record must stay reachable).

**Write rules are unchanged:** surveyors still create only in assigned zones,
still manage photos only on their own buildings, still can't set permission
records, still can't edit/delete buildings.

Applied consistently in all four read surfaces:

1. **List** (`listBuildings`) — replace the forced `where.createdById` with
   the zone-or-own filter. Because `search` already uses top-level `OR`, the
   scope filter goes in `where.AND` so the two compose as AND.
2. **Detail** (`getBuilding`) — 404 only when the building is neither in an
   assigned zone nor the surveyor's own.
3. **Nearby duplicate check** (`findNearby`) — buildings in assigned zones
   are no longer masked; full details return (they're now visible in the
   list anyway). Buildings outside assigned zones stay masked.
4. **Dashboard stats** (`getDashboardStats`) — the surveyor `buildingWhere`
   becomes the same zone-or-own filter, so KPIs match the visible list.
   `createStatsService` gains a `userRepository` dependency for
   `assignedZoneIds`.

## Implementation notes

- `userRepository.assignedZoneIds(userId)` already exists and is already used
  by `createBuilding`; the service factories already receive `userRepository`
  (stats does not yet — inject it).
- The Prisma scope fragment, used identically in buildings + stats:
  `{ OR: [{ zoneId: { in: assignedIds } }, { createdById: actor.id }] }`.
- `findNearby` and `getBuilding` compare `building.zoneId` against the id
  list; one `assignedZoneIds` fetch per request.
- No frontend changes: the UI renders whatever the API returns.
- No schema/migration changes.

## Testing

Update existing scope tests and add new cases (vitest, fake repos):

- List: surveyor sees an admin-created building in an assigned zone; does NOT
  see buildings in unassigned zones (other creators); still sees own building
  in an unassigned zone; search + scope compose (AND).
- Detail: 200 for assigned-zone foreign building; 404 for unassigned-zone
  foreign building; 200 for own.
- Nearby: assigned-zone foreign building returns unmasked; unassigned-zone
  foreign building stays masked.
- Stats: surveyor counts include assigned-zone buildings (fake repo asserts
  the where clause shape).
- Existing tests asserting own-only scope are updated to the new rule — that
  behavior change is the point of this feature.

## Out of scope

- Any change to write permissions or zone assignment management.
- Manager scoping (managers/admins already see everything).
