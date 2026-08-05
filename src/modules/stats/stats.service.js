const FEASIBLE_STATUSES = ['FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING']
const OVER_TIME_DAYS = 30

export function createStatsService({ statsRepository }) {
  return {
    async getDashboardStats(actor, { operatorId } = {}) {
      const scoped = actor?.role === 'SURVEYOR'

      // KPI where merges surveyor ownership and the operator filter (operator is
      // reached through the building's zone).
      const buildingWhere = {}
      if (scoped) buildingWhere.createdById = actor.id
      if (operatorId) buildingWhere.zone = { operatorId }
      const hasBuildingWhere = Object.keys(buildingWhere).length > 0
      const where = hasBuildingWhere ? buildingWhere : undefined
      const nestedWhere = hasBuildingWhere ? { building: buildingWhere } : undefined

      const [totalBuildings, statusCounts, homePass, permissionCost, operatorCount, zoneCount] =
        await Promise.all([
          statsRepository.countBuildings(where),
          statsRepository.countsByStatus(where),
          statsRepository.sumHomePass(nestedWhere),
          statsRepository.sumPermissionCost(nestedWhere),
          statsRepository.countOperators(),
          statsRepository.countZones(operatorId ? { operatorId } : {}),
        ])

      const byStatus = Object.fromEntries(FEASIBLE_STATUSES.map((status) => [status, 0]))
      for (const row of statusCounts) byStatus[row.feasibleStatus] = row._count._all

      // Charts are ADMIN/MANAGER only — surveyors never see them.
      let byOperator = []
      let overTime = []
      if (!scoped) {
        const since = new Date(Date.now() - OVER_TIME_DAYS * 24 * 60 * 60 * 1000)
        ;[byOperator, overTime] = await Promise.all([
          statsRepository.buildingsByOperator(),
          statsRepository.buildingsOverTime({ sinceDate: since, operatorId: operatorId ?? null }),
        ])
      }

      return {
        totalBuildings,
        byStatus,
        totalHomePass: homePass ?? 0,
        totalPermissionCost: Number(permissionCost ?? 0),
        operatorCount,
        zoneCount,
        byOperator: byOperator.map((row) => ({ ...row, homePass: Number(row.homePass) })),
        overTime,
      }
    },
  }
}
