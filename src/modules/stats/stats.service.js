const FEASIBLE_STATUSES = ['FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING']

export function createStatsService({ statsRepository }) {
  return {
    async getDashboardStats() {
      const [totalBuildings, statusCounts, homePass, permissionCost] = await Promise.all([
        statsRepository.countBuildings(),
        statsRepository.countsByStatus(),
        statsRepository.sumHomePass(),
        statsRepository.sumPermissionCost(),
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
