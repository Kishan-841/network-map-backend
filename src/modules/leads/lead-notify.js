/**
 * What a partner hears when one of their leads moves, decided in ONE place.
 *
 * A lead's status changes in two places — a manager picking a status
 * (lead.service changeStatus) and a call outcome (lead-call.service logCall).
 * Both call this after the change is saved, so no path can forget to notify.
 *
 * Fire-and-forget: the request that changed the status never waits for, or
 * fails because of, a notification.
 */
// Every status a lead can move to has words for the partner. Re-picking the
// SAME status sends nothing (checked below).
const KIND_FOR = {
  NEW: 'lead.requeued',
  CONTACTED: 'lead.contacted',
  INTERESTED: 'lead.interested',
  CONVERTED: 'lead.converted',
  NOT_INTERESTED: 'lead.not_interested',
  UNREACHABLE: 'lead.unreachable',
  DUPLICATE: 'lead.duplicate',
}

export function createLeadMilestones({ notifyPartner }) {
  return function notifyLeadMilestone({ lead, fromStatus, toStatus, earning }) {
    const kind = KIND_FOR[toStatus]
    if (!kind || fromStatus === toStatus || !lead?.partnerId) return
    const payload = { leadId: lead.id, customerName: lead.customerName }
    if (toStatus === 'CONVERTED' && earning?.amount != null) payload.amount = earning.amount
    Promise.resolve()
      .then(() => notifyPartner(lead.partnerId, kind, payload))
      .catch((err) => console.error('[push] lead milestone failed:', err?.message))
  }
}
