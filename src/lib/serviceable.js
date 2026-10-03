/**
 * THE definition of "we can connect this building".
 *
 * isLive means the fibre is lit today. Chosen over feasibleStatus because a
 * partner is promising a customer service: a building that is merely surveyed
 * and viable still needs construction, and telling a partner "yes" for one of
 * those has them promise something we cannot deliver.
 *
 * Lives in one file so the search list, the referral gate and the feasibility
 * check can never disagree about what a partner is being told.
 */
export const isServiceable = (building) => building?.isLive === true
