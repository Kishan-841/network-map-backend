import { HOME_PASS_TIERS } from '../../lib/home-pass-tier.js'
import { COVERAGE_REGISTRY } from '../../lib/building-source.js'
import { readsByZone } from '../../lib/zone-scope-roles.js'

const FEASIBLE_STATUSES = ['FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING']
const OVER_TIME_DAYS = 30

export function createStatsService({ statsRepository, userRepository }) {
  return {
    async getDashboardStats(actor, { operatorId, cityId } = {}) {
      // Surveyors and managers count only their zones plus their own rows.
      const scoped = readsByZone(actor?.role)

      // KPI where merges surveyor ownership and the operator filter (operator is
      // reached through the building's zone).
      // Coverage KPIs count coverage buildings. Without this the acquisition
      // team's rows inflate every total here while the buildings list (which
      // defaults to COVERAGE) shows a different number.
      // The coverage registry includes societies an ADMIN approved (phase 2);
      // both ORs sit inside AND so neither overwrites the other.
      const buildingWhere = { AND: [COVERAGE_REGISTRY] }
      if (scoped) {
        // Same zone-or-own read scope the buildings list uses (spec 2026-08-14).
        const assigned = await userRepository.assignedZoneIds(actor.id)
        buildingWhere.AND.push({ OR: [{ zoneId: { in: assigned } }, { createdById: actor.id }] })
      }
      if (operatorId) buildingWhere.zone = { operatorId }
      if (cityId) buildingWhere.zone = { ...buildingWhere.zone, operator: { cityId } }
      const where = buildingWhere
      const nestedWhere = { building: buildingWhere }

      const [
        totalBuildings,
        statusCounts,
        liveCounts,
        homePass,
        permissionCost,
        operatorCount,
        zoneCount,
        tierCounts,
        tierHomePass,
        unratedBuildings,
      ] = await Promise.all([
        statsRepository.countBuildings(where),
        statsRepository.countsByStatus(where),
        statsRepository.countsByLive(where),
        statsRepository.sumHomePass(nestedWhere),
        statsRepository.sumPermissionCost(nestedWhere),
        statsRepository.countOperators(),
        statsRepository.countZones({
          ...(operatorId && { operatorId }),
          ...(cityId && { operator: { cityId } }),
        }),
        // Size mix: how the estate splits across the home-pass tiers, and how
        // much home pass sits in each — a handful of buildings in the top tier
        // can outweigh everything below it, which a count alone would hide.
        Promise.all(HOME_PASS_TIERS.map((tier) => statsRepository.countBuildingsInHomePassRange(where, tier))),
        Promise.all(HOME_PASS_TIERS.map((tier) => statsRepository.sumHomePassInRange(where, tier))),
        statsRepository.countBuildingsUnrated(where),
      ])

      const byHomePassTier = HOME_PASS_TIERS.map((tier, i) => ({
        key: tier.key,
        label: tier.label,
        min: tier.min,
        max: tier.max,
        buildings: tierCounts[i],
        homePass: tierHomePass[i],
      }))

      const byStatus = Object.fromEntries(FEASIBLE_STATUSES.map((status) => [status, 0]))
      for (const row of statusCounts) byStatus[row.feasibleStatus] = row._count._all

      // Live = fiber connection is live (the green/red map marker).
      const byLive = { live: 0, notLive: 0 }
      for (const row of liveCounts) {
        byLive[row.isLive ? 'live' : 'notLive'] = row._count._all
      }

      // Company-wide charts are ADMIN only — zone-scoped readers never see them.
      let byOperator = []
      let overTime = []
      if (!scoped) {
        const since = new Date(Date.now() - OVER_TIME_DAYS * 24 * 60 * 60 * 1000)
        ;[byOperator, overTime] = await Promise.all([
          statsRepository.buildingsByOperator(),
          statsRepository.buildingsOverTime({
            sinceDate: since,
            operatorId: operatorId ?? null,
            cityId: cityId ?? null,
          }),
        ])
      }

      return {
        totalBuildings,
        byStatus,
        byLive,
        totalHomePass: homePass ?? 0,
        totalPermissionCost: Number(permissionCost ?? 0),
        operatorCount,
        zoneCount,
        byHomePassTier,
        unratedBuildings,
        byOperator: byOperator.map((row) => ({ ...row, homePass: Number(row.homePass) })),
        overTime,
      }
    },
  }
}
