import { prisma } from '../../lib/prisma.js'

export const pushTokenRepository = {
  /** Upsert by token: a phone belongs to whoever registered it last. */
  upsert: ({ partnerId, token, platform }) =>
    prisma.partnerPushToken.upsert({
      where: { token },
      create: { partnerId, token, platform },
      update: { partnerId, platform, lastSeenAt: new Date() },
    }),
  /** Only the caller's own token — a stranger's sign-out cannot mute you. */
  removeForPartner: (partnerId, token) =>
    prisma.partnerPushToken.deleteMany({ where: { partnerId, token } }),
  listForPartner: (partnerId) =>
    prisma.partnerPushToken.findMany({
      where: { partnerId },
      // The language comes along, so the notification is written in it.
      select: { token: true, partner: { select: { preferredLanguage: true } } },
    }),
  /** Tokens Expo reported dead (the app was uninstalled). */
  removeTokens: (tokens) =>
    tokens.length ? prisma.partnerPushToken.deleteMany({ where: { token: { in: tokens } } }) : null,
}
