# Operator-aware Dashboard — Design

**Date:** 2026-08-05
**Status:** Approved

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Charts | All four: status donut, buildings-by-operator bar, home-pass-by-operator bar, surveys-over-time line. |
| Chart tech | Recharts. |
| Count tiles | Operators tile = global count; Zones tile follows the operator filter. |
| Roles | Operator filter + charts for ADMIN/MANAGER only. Surveyors keep today's scoped view. |

## Backend

Extend `GET /api/v1/stats/dashboard` with an optional `operatorId` query param
(`statsQuerySchema = z.object({ operatorId: z.string().optional() })` via
`validateQuery`). One call returns everything the dashboard needs:

```jsonc
{
  "totalBuildings": 0,
  "byStatus": { "FEASIBLE": 0, "PERMISSION_PENDING": 0, "REJECTED": 0, "SURVEY_PENDING": 0 },
  "totalHomePass": 0,
  "totalPermissionCost": 0,
  "operatorCount": 0,               // always global
  "zoneCount": 0,                   // zones under operatorId, or all zones
  "byOperator": [{ "operatorId": "..", "name": "..", "buildings": 0, "homePass": 0 }],
  "overTime": [{ "date": "2026-08-01", "count": 0 }]  // last 30 days
}
```

Filtering rules in `getDashboardStats(actor, { operatorId })`:
- **KPIs** (`totalBuildings`, `byStatus`, `totalHomePass`, `totalPermissionCost`):
  building where merges surveyor scope (`createdById` for SURVEYOR) and, when
  `operatorId` is set, `zone: { operatorId }`. Nested aggregates use
  `building: { <that where> }`.
- **operatorCount**: `prisma.operator.count()` — global.
- **zoneCount**: `prisma.zone.count({ where: operatorId ? { operatorId } : {} })`.
- **Charts** (`byOperator`, `overTime`): computed only when NOT a surveyor
  (returned as `[]` for surveyors, which the UI never renders for them).
  - `byOperator`: raw SQL join Building→Zone→(BuildingDetails) grouped by
    operator, all operators (comparison ignores the operatorId filter). Static
    query, no interpolated input.
  - `overTime`: buildings per day over the last 30 days, respecting the same
    building where as the KPIs (so it honors `operatorId`). Parameterized only
    by a computed date cutoff and the operatorId (bound param, not string-built).

New `statsRepository` methods: `countOperators()`, `countZones(where)`,
`buildingsByOperator()` (raw), `buildingsOverTime(where, sinceDate)` (raw).
`getDashboardStats` gains the second `{ operatorId }` argument; controller passes
`req.validatedQuery`. Route stays `requireAuth` (service scopes surveyors).

## Frontend

- **`useDashboardStats(operatorId)`** — refetches when `operatorId` changes;
  returns `{ stats, loading, error }`.
- **`useOperators`** already exists (list for the dropdown).
- **Recharts** dependency. Four themed chart components under
  `src/components/dashboard/`:
  - `StatusDonut` (byStatus) · `OperatorBar` (byOperator, one for buildings, one
    for homePass) · `SurveysLine` (overTime). Colors from Design.md tokens
    (emerald/slate family via CSS vars); responsive via `ResponsiveContainer`;
    empty-state text when no data.
- **Dashboard page** (`src/app/(app)/dashboard/page.js`):
  - ADMIN/MANAGER: a top **Operator `<Select>`** ("All operators" default) sets
    `operatorId`. KPI tiles (buildings, home pass, permission cost) + **count
    tiles** (Operators → `/admin/operators` [global count], Zones →
    `/admin/zones` [filtered count]) + a **charts section** (donut + 2 bars +
    line). Recent list stays.
  - SURVEYOR: unchanged scoped view (no dropdown, no charts).
- The existing client-side stats fallback (computed from `useBuildings`) stays
  for the non-operator KPIs so the page still renders if `/stats` fails.

## Testing

Backend (vitest, fake repo): KPI filtering by `operatorId` (building where gains
`zone.operatorId`); surveyor scope still forces `createdById` and charts return
`[]`; `operatorCount` global vs `zoneCount` filtered; controller passes the
query through. A light route test confirms `?operatorId=` returns 200 with the
new fields. Frontend: eslint, build, live browser — pick an operator, KPIs +
charts update; count tiles redirect.

## Out of scope

- Persisting the selected operator across sessions; export of charts; per-zone
  drill-down; date-range picker on the dashboard (fixed last-30-days for the line).
