/**
 * Who runs the partner network, in one place.
 *
 * PARTNER_STAFF reach partners, invites, partner leads, the network overview
 * and the staff rate card. A partner manager works only the partners they
 * onboarded (and those partners' leads and invites); the others — admin and
 * sales manager — see the whole network (the owner's rule, 6 Oct).
 *
 * PARTNER_APPROVERS approve or reject partners and handle what that needs:
 * their documents and their bank details (full account number included — the
 * owner gave the sales manager the same reach as an admin here).
 */
export const PARTNER_STAFF = ['ADMIN', 'PARTNER_MANAGER', 'SALES_MANAGER']
export const PARTNER_APPROVERS = ['ADMIN', 'SALES_MANAGER']

/** True when the actor may see only what they themselves onboarded. */
export const ownPartnersOnly = (actor) => actor?.role === 'PARTNER_MANAGER'
