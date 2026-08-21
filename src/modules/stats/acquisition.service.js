/**
 * Acquisition-team analytics for the lead dashboard: how much each agent
 * logged in a date range. Reads only ACQUISITION rows — the coverage
 * registry is never touched here.
 */
import { Prisma } from '@prisma/client'

export function createAcquisitionService({ prisma }) {
  const rangeWhere = ({ dateFrom, dateTo, agentId, cityId }) => ({
    source: 'ACQUISITION',
    ...(agentId && { createdById: agentId }),
    ...(cityId && { cityId }),
    ...((dateFrom || dateTo) && {
      createdAt: {
        ...(dateFrom && { gte: new Date(dateFrom) }),
        ...(dateTo && { lte: new Date(`${dateTo}T23:59:59.999Z`) }),
      },
    }),
  })

  const startOf = (days) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - days)
    return d
  }

  return {
    async getAcquisitionStats({ dateFrom, dateTo, agentId, cityId } = {}) {
      const where = rangeWhere({ dateFrom, dateTo, agentId, cityId })

      // Previous window of equal length — powers the "vs previous" delta.
      const prevWindow = (() => {
        if (!dateFrom || !dateTo) return null
        const from = new Date(dateFrom)
        const to = new Date(`${dateTo}T23:59:59.999Z`)
        const span = to.getTime() - from.getTime()
        return { gte: new Date(from.getTime() - span - 1), lte: new Date(from.getTime() - 1) }
      })()

      const [
        inRange,
        today,
        week,
        month,
        agents,
        perAgent,
        contacts,
        homePass,
        designations,
        pincodes,
        previous,
      ] = await Promise.all([
        prisma.building.count({ where }),
        prisma.building.count({
          where: { source: 'ACQUISITION', createdAt: { gte: startOf(0) } },
        }),
        prisma.building.count({
          where: { source: 'ACQUISITION', createdAt: { gte: startOf(6) } },
        }),
        prisma.building.count({
          where: { source: 'ACQUISITION', createdAt: { gte: startOf(29) } },
        }),
        prisma.user.findMany({
          where: {
            role: 'ACQUISITION_AGENT',
            ...(agentId && { id: agentId }),
            // Agents are mapped to a city through their pincode assignment.
            ...(cityId && { pincodes: { some: { cityId } } }),
          },
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
            pincodes: { select: { pincode: true } },
          },
          orderBy: { name: 'asc' },
        }),
        prisma.building.groupBy({
          by: ['createdById'],
          where,
          _count: { _all: true },
          _max: { createdAt: true },
        }),
        prisma.buildingContact.count({ where: { building: where } }),
        // Flats reached — the number the business actually cares about.
        prisma.buildingDetails.aggregate({
          _sum: { homePass: true },
          where: { building: where },
        }),
        // Who agents are actually meeting (decision-maker quality).
        prisma.buildingContact.groupBy({
          by: ['designation'],
          where: { building: where },
          _count: { _all: true },
        }),
        // Which pincodes are being worked.
        prisma.building.groupBy({
          by: ['pincode'],
          where,
          _count: { _all: true },
        }),
        prevWindow
          ? prisma.building.count({ where: { source: 'ACQUISITION', createdAt: prevWindow } })
          : Promise.resolve(null),
      ])

      const statsById = new Map(
        perAgent.map((row) => [row.createdById, { count: row._count._all, last: row._max.createdAt }]),
      )

      // Per-day trend for the chart (dates with zero rows are simply absent).
      // Values are BOUND, never interpolated — no string-built SQL.
      const conditions = [Prisma.sql`"source" = 'ACQUISITION'`]
      if (dateFrom) conditions.push(Prisma.sql`"createdAt" >= ${new Date(dateFrom)}`)
      if (dateTo) {
        conditions.push(Prisma.sql`"createdAt" <= ${new Date(`${dateTo}T23:59:59.999Z`)}`)
      }
      if (agentId) conditions.push(Prisma.sql`"createdById" = ${agentId}`)
      if (cityId) conditions.push(Prisma.sql`"cityId" = ${cityId}`)
      const trendRows = await prisma.$queryRaw`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS count
        FROM "Building"
        WHERE ${Prisma.join(conditions, ' AND ')}
        GROUP BY 1 ORDER BY 1`

      return {
        totalInRange: inRange,
        today,
        last7Days: week,
        last30Days: month,
        contactsCaptured: contacts,
        homePassReached: homePass._sum.homePass ?? 0,
        previousRangeTotal: previous,
        byDesignation: designations
          .map((d) => ({ designation: d.designation, count: d._count._all }))
          .sort((a, b) => b.count - a.count),
        byPincode: pincodes
          .filter((p) => p.pincode)
          .map((p) => ({ pincode: p.pincode, count: p._count._all }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
        activeAgents: agents.filter((a) => a.isActive).length,
        agents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          email: agent.email,
          isActive: agent.isActive,
          pincodes: agent.pincodes.map((p) => p.pincode),
          buildings: statsById.get(agent.id)?.count ?? 0,
          lastActivity: statsById.get(agent.id)?.last ?? null,
        })),
        trend: trendRows,
      }
    },
  }
}
