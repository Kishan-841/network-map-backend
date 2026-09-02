import { prisma } from '../../lib/prisma.js'

export const earningRepository = {
  findByLeadId: (leadId) => prisma.partnerEarning.findUnique({ where: { leadId } }),
  create: (data) => prisma.partnerEarning.create({ data }),
  deleteByLeadId: (leadId) => prisma.partnerEarning.deleteMany({ where: { leadId } }),

  /**
   * What is owed, grouped the way it is paid: per partner, per month.
   *
   * Raw SQL because Prisma's groupBy cannot group on a derived value, and the
   * month has to come from date_trunc on earnedAt. Parameterised — never
   * interpolated — even though nothing here is user input today.
   */
  async owedByPartnerMonth() {
    const rows = await prisma.$queryRaw`
      SELECT e."partnerId"                                  AS "partnerId",
             to_char(date_trunc('month', e."earnedAt"), 'YYYY-MM') AS month,
             p.name                                         AS "partnerName",
             p.mobile                                       AS "partnerMobile",
             SUM(e.amount)::int                             AS amount,
             COUNT(*)::int                                  AS count
        FROM "PartnerEarning" e
        JOIN "Partner" p ON p.id = e."partnerId"
       WHERE e.status = 'AWAITING_PAYMENT'
       GROUP BY e."partnerId", date_trunc('month', e."earnedAt"), p.name, p.mobile
    `
    return rows
  },

  /** Payments already recorded, newest first — for checking against a bank. */
  async paidByPartnerMonth(limit = 200) {
    return prisma.$queryRaw`
      SELECT e."partnerId"                                  AS "partnerId",
             to_char(date_trunc('month', e."earnedAt"), 'YYYY-MM') AS month,
             p.name                                         AS "partnerName",
             SUM(e.amount)::int                             AS amount,
             COUNT(*)::int                                  AS count,
             MAX(e."paidAt")                                AS "paidAt",
             MAX(u.name)                                    AS "paidByName"
        FROM "PartnerEarning" e
        JOIN "Partner" p ON p.id = e."partnerId"
        LEFT JOIN "User" u ON u.id = e."paidById"
       WHERE e.status = 'PAID'
       GROUP BY e."partnerId", date_trunc('month', e."earnedAt"), p.name
       ORDER BY MAX(e."paidAt") DESC
       LIMIT ${limit}
    `
  },

  /**
   * Settle one partner-month.
   *
   * The AWAITING_PAYMENT filter is the whole safety property: an earning
   * already paid is never re-stamped, so pressing this twice cannot overwrite
   * who recorded the first payment or when.
   */
  async markMonthPaid({ partnerId, month, byUserId }) {
    const start = new Date(`${month}-01T00:00:00.000Z`)
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
    return prisma.partnerEarning.updateMany({
      where: {
        partnerId,
        status: 'AWAITING_PAYMENT',
        earnedAt: { gte: start, lt: end },
      },
      data: { status: 'PAID', paidAt: new Date(), paidById: byUserId },
    })
  },

  /** Everything a partner has earned, newest first; the service groups it. */
  listForPartner: (partnerId) =>
    prisma.partnerEarning.findMany({
      where: { partnerId },
      orderBy: { earnedAt: 'desc' },
      include: { lead: { select: { customerName: true } } },
    }),
}
