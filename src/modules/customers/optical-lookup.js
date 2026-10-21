import { env } from '../../config/env.js'
import { createOpticalLookup } from '../../lib/olt-optical.js'

// One OLT client for the process (it holds the 10-minute cache and the rate
// bucket). The controller and the background refresher both use this one, so
// they share the budget. Tests swap it with setOpticalLookupForTests(fake);
// null restores the one built from env.
const build = () => createOpticalLookup({ baseUrl: env.olt.apiUrl, apiKey: env.olt.apiKey })
let current = build()

export const getOpticalLookup = () => current
export function setOpticalLookupForTests(lookup) {
  current = lookup ?? build()
}
