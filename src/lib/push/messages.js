/**
 * Every push notification the partner app can receive, in one place.
 *
 * A new kind (a payout was made, a lead was contacted…) is one entry here and
 * one route in the app's NOTIFICATION_ROUTES (mobile/lib/notificationRoutes.js)
 * — nothing else. `data.kind` is how the app knows where a tap should go.
 */

const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'Your customer'
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const CATALOGUE = {
  'lead.interested': ({ leadId, customerName }) => ({
    title: `Good news: ${firstName(customerName)} is interested`,
    body: "The customer you referred wants a Gazon connection. We're setting it up.",
    data: { kind: 'lead.interested', leadId },
  }),
  'lead.converted': ({ leadId, customerName, amount }) => ({
    title: `${firstName(customerName)} signed up 🎉`,
    body:
      amount != null && Number.isFinite(Number(amount))
        ? `You've earned ${rupees(amount)}. Tap to see it in your earnings.`
        : 'Your earning is on its way. Tap to see it.',
    data: { kind: 'lead.converted', leadId },
  }),
  'lead.contacted': ({ leadId, customerName }) => ({
    title: `We called ${firstName(customerName)}`,
    body: "We've spoken to the customer you referred and are following up.",
    data: { kind: 'lead.contacted', leadId },
  }),
  'lead.not_interested': ({ leadId, customerName }) => ({
    title: `${firstName(customerName)} decided not to go ahead`,
    body: 'The customer chose not to take a connection this time. Thanks for referring them.',
    data: { kind: 'lead.not_interested', leadId },
  }),
  'lead.unreachable': ({ leadId, customerName }) => ({
    title: `We couldn't reach ${firstName(customerName)}`,
    body: "We tried calling but couldn't get through. If you can, ask them to expect our call.",
    data: { kind: 'lead.unreachable', leadId },
  }),
  'lead.duplicate': ({ leadId, customerName }) => ({
    title: `${firstName(customerName)} was already referred`,
    body: "Someone told us about this customer first, so this lead isn't counted. Thanks anyway.",
    data: { kind: 'lead.duplicate', leadId },
  }),
  // A manager moved the lead back to NEW.
  'lead.requeued': ({ leadId, customerName }) => ({
    title: `${firstName(customerName)} is back in our queue`,
    body: 'Our team will call the customer again soon.',
    data: { kind: 'lead.requeued', leadId },
  }),

  // The admin's decision on the partner's documents.
  'partner.approved': () => ({
    title: "You're approved! 🎉",
    body: 'Your documents are verified. You can now add leads and start earning.',
    data: { kind: 'partner.approved' },
  }),
  'partner.rejected': () => ({
    title: 'Please upload your documents again',
    body: "We couldn't accept the photos you sent. Tap to upload clear ones.",
    data: { kind: 'partner.rejected' },
  }),
}

export const NOTIFICATION_KINDS = Object.keys(CATALOGUE)

export function buildNotification(kind, payload = {}) {
  const build = CATALOGUE[kind]
  if (!build) throw new Error(`Unknown notification kind: ${kind}`)
  return build(payload)
}
