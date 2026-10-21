import { env } from '../../config/env.js'
import { createOpticalLookup } from '../../lib/olt-optical.js'
import { createOltReachability } from '../../lib/olt-reachability.js'

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

// Which OLTs the monitoring cannot reach (one /olts call per 10 min). Its one
// request takes a token from the shared lookup's bucket and reports a 429 to
// it, so the whole process spends one key budget. Tests swap it with
// setOltReachabilityForTests(fake); null restores the env-built one.
const buildReachability = () =>
  createOltReachability({
    baseUrl: env.olt.apiUrl,
    apiKey: env.olt.apiKey,
    acquire: async () => (current.acquire ? current.acquire() : true),
    notePause: (res) => current.notePause?.(res),
  })
let reachability = buildReachability()

export const getOltReachability = () => reachability
export function setOltReachabilityForTests(fake) {
  reachability = fake ?? buildReachability()
}
