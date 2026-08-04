const FEASIBLE_STATUSES = ['FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING']

export function createStatsService({ statsRepository }) {
  return {
    async getDashboardStats(actor) {
      // Surveyors see KPIs over their own buildings only.
      const scoped = actor?.role === 'SURVEYOR'
      const buildingWhere = scoped ? { createdById: actor.id } : undefined
      const nestedWhere = scoped ? { building: { createdById: actor.id } } : undefined
      const [totalBuildings, statusCounts, homePass, permissionCost] = await Promise.all([
        statsRepository.countBuildings(buildingWhere),
        statsRepository.countsByStatus(buildingWhere),
        statsRepository.sumHomePass(nestedWhere),
        statsRepository.sumPermissionCost(nestedWhere),
      ])

      const byStatus = Object.fromEntries(FEASIBLE_STATUSES.map((status) => [status, 0]))
      for (const row of statusCounts) {
        byStatus[row.feasibleStatus] = row._count._all
      }

      return {
        totalBuildings,
        byStatus,
        totalHomePass: homePass ?? 0,
        totalPermissionCost: Number(permissionCost ?? 0),
      }
    },
  }
}
