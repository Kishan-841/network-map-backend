import { env } from '../../config/env.js'
import { createOpticalLookup } from '../../lib/olt-optical.js'
import { createOltReachability } from '../../lib/olt-reachability.js'

// One OLT client for the process (it holds the 10-minute cache and the rate
// bucket). The controller and the background refresher both use this one, so
// they share the budget. Tests swap it with setOpticalLookupForTests(fake);
// null restores the one built from env.
// Under NODE_ENV=test both are built DISABLED (no url, no key), so no test can
// reach the real OLT API by accident; a test that needs one injects a fake.
const IS_TEST = process.env.NODE_ENV === 'test'
const oltUrl = IS_TEST ? '' : env.olt.apiUrl
const oltKey = IS_TEST ? '' : env.olt.apiKey
const build = () => createOpticalLookup({ baseUrl: oltUrl, apiKey: oltKey })
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
    baseUrl: oltUrl,
    apiKey: oltKey,
    acquire: async () => (current.acquire ? current.acquire() : true),
    notePause: (res) => current.notePause?.(res),
  })
let reachability = buildReachability()

export const getOltReachability = () => reachability
export function setOltReachabilityForTests(fake) {
  reachability = fake ?? buildReachability()
}
