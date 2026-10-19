import { ApiError } from '../../lib/api-error.js'
import {
  customerFieldErrors,
  customerIdentity,
  matchBuildingNames,
  matchWing,
  mergeCustomerUpdate,
  normaliseMobile,
} from '../../lib/customers.js'
import { mapLimit, redactConnection, summariseConnection } from '../../lib/olt-optical.js'

/**
 * Customers of a building (spec 2026-10-17).
 *
 * Reads ride the building's own read rule — the buildings service owns
 * `readScope`, so a customer list can never be wider than the building it
 * hangs on (out of scope → the same 404 the building read gives). Writes are
 * ADMIN-only at the route.
 *
 * `createCustomerService({ customerRepository, buildingService })`.
 */
export function createCustomerService({
  customerRepository,
  buildingService,
  getOpticalLookup = () => null,
  connectionDeadlineMs = 15000,
}) {
  const TEXT_FIELDS = [
    'username',
    'address',
    'email',
    'site',
    'operator',
    'networkZone',
    'planName',
    'status',
    'ponNumber',
    'olt',
  ]
  const NULLABLE_NUMBERS = ['planAmount', 'planValidityDays', 'ageingDays']
  const NULLABLE_DATES = ['planActivatedAt', 'planExpiresAt']

  /** Trim the text fields, '' → null, keep only the known columns. */
  function toData(input) {
    const data = {
      name: String(input.name ?? '').trim(),
      mobile: normaliseMobile(input.mobile),
      autoRenewal: input.autoRenewal ?? null,
      wingId: input.wingId ?? null,
    }
    for (const field of TEXT_FIELDS) {
      const value = input[field]
      data[field] = typeof value === 'string' && value.trim() !== '' ? value.trim() : null
    }
    for (const field of NULLABLE_NUMBERS) data[field] = input[field] ?? null
    for (const field of NULLABLE_DATES) data[field] = input[field] ?? null
    return data
  }

  /** A wing must exist and belong to the customer's own building. */
  async function assertWingInBuilding(wingId, buildingId) {
    if (!wingId) return
    const wing = await customerRepository.findWing(wingId)
    if (!wing || wing.buildingId !== buildingId) {
      throw ApiError.badRequest('That wing is not in this building')
    }
  }

  async function assertUsernameFree(username, exceptId) {
    const clash = await customerRepository.findByUsername(username)
    if (clash && clash.id !== exceptId) {
      throw ApiError.conflict('A customer with this username already exists')
    }
  }

  async function listCustomers({ buildingId }, actor) {
    // getBuilding throws 404 for a building the actor cannot read.
    const building = await buildingService.getBuilding(buildingId, actor)
    const [customers, wings] = await Promise.all([
      customerRepository.listByBuilding(buildingId),
      customerRepository.listWings(buildingId),
    ])
    return { customers, wings, building: { id: building.id, buildingName: building.buildingName } }
  }

  /**
   * One customer, for its detail page. The building it hangs on owns the read
   * rule, so an out-of-scope customer reads as the same 404 a building does.
   * The building's name rides along so the page needs no second request.
   */
  async function getCustomer(id, actor) {
    const customer = await customerRepository.findById(id)
    if (!customer) throw ApiError.notFound('Customer not found')
    const building = await buildingService.getBuilding(customer.buildingId, actor)
    const wings = await customerRepository.listWings(customer.buildingId)
    return {
      ...customer,
      wing: customer.wing ?? null,
      wings,
      building: { id: building.id, buildingName: building.buildingName },
    }
  }

  // Connection status from the OLT API (spec 2026-10-19). Reads follow the
  // building's read rule; only ADMIN keeps the device identifiers.
  const FAN_OUT = 5
  const COUNT_KEY = {
    online: 'online',
    offline: 'offline',
    not_seen: 'notSeen',
    not_linked: 'notLinked',
    no_username: 'noUsername',
    unavailable: 'unavailable',
  }
  const view = (connection, actor) => (actor?.role === 'ADMIN' ? connection : redactConnection(connection))
  const connectionOf = async (optical, username) =>
    summariseConnection(await optical.lookup(username)) // blank -> null -> no_username

  async function getBuildingConnections({ buildingId }, actor) {
    await buildingService.getBuilding(buildingId, actor) // 404 out of scope
    const optical = getOpticalLookup()
    if (!optical?.enabled) return { enabled: false }
    const customers = await customerRepository.listByBuilding(buildingId)
    // Overall deadline: lookups still running when it passes count as
    // unavailable; they may finish later and fill the lookup cache.
    const unavailable = () => summariseConnection({ unavailable: true })
    const done = new Array(customers.length).fill(null)
    let expired = false
    const work = mapLimit(customers, FAN_OUT, async (cu, i) => {
      if (expired) return null // not started in time: no new OLT call
      try {
        done[i] = await connectionOf(optical, cu.username)
      } catch {
        done[i] = unavailable()
      }
      return null
    }).catch(() => {})
    let timer
    const deadline = new Promise((resolve) => {
      timer = setTimeout(resolve, connectionDeadlineMs)
    })
    try {
      await Promise.race([work, deadline])
    } finally {
      clearTimeout(timer)
      expired = true
    }
    const list = done.map((d) => d ?? unavailable())
    const counts = { online: 0, offline: 0, notSeen: 0, notLinked: 0, noUsername: 0, unavailable: 0, weak: 0 }
    const connections = {}
    customers.forEach((cu, i) => {
      counts[COUNT_KEY[list[i].state]] += 1
      if (list[i].weak) counts.weak += 1
      connections[cu.id] = view(list[i], actor)
    })
    return { enabled: true, connections, counts }
  }

  async function getCustomerConnection(id, actor) {
    const customer = await getCustomer(id, actor) // 404 out of scope
    const optical = getOpticalLookup()
    if (!optical?.enabled) return { enabled: false }
    return { enabled: true, connection: view(await connectionOf(optical, customer.username), actor) }
  }

  async function createCustomer(body, actor) {
    const [buildingId] = await customerRepository.findBuildingIds([body.buildingId])
    if (!buildingId) throw ApiError.notFound('Building not found')
    const errors = customerFieldErrors(body)
    if (errors.length) throw ApiError.badRequest(errors[0])
    const data = toData(body)
    await assertWingInBuilding(data.wingId, buildingId)
    if (data.username) {
      await assertUsernameFree(data.username)
    } else {
      const duplicate = await customerRepository.findByBuildingAndMobile(buildingId, data.mobile)
      if (duplicate) {
        throw ApiError.conflict('A customer with this mobile number already exists in this building')
      }
    }
    return customerRepository.create({ ...data, buildingId, createdById: actor.id })
  }

  async function updateCustomer(id, body) {
    const existing = await customerRepository.findById(id)
    if (!existing) throw ApiError.notFound('Customer not found')
    const errors = customerFieldErrors({ ...existing, ...body })
    if (errors.length) throw ApiError.badRequest(errors[0])
    const data = toData({ ...existing, ...body })
    if (data.wingId !== existing.wingId) await assertWingInBuilding(data.wingId, existing.buildingId)
    if (data.username) {
      if (data.username !== existing.username) await assertUsernameFree(data.username, id)
    } else if (data.mobile !== existing.mobile || existing.username) {
      const clash = await customerRepository.findByBuildingAndMobile(existing.buildingId, data.mobile)
      if (clash && clash.id !== id) {
        throw ApiError.conflict('A customer with this mobile number already exists in this building')
      }
    }
    return customerRepository.update(id, data)
  }

  async function deleteCustomer(id) {
    const existing = await customerRepository.findById(id)
    if (!existing) throw ApiError.notFound('Customer not found')
    await customerRepository.remove(id)
    return existing
  }

  /** Every requested name → the registry rows it matches (0, 1 or many). */
  async function lookupBuildings(names) {
    const buildings = await customerRepository.listBuildingsForLookup()
    return matchBuildingNames(names, buildings)
  }

  /**
   * Bulk import — an upsert keyed on who the customer is (spec 2026-10-19).
   *
   * The promise to the owner: a blank cell never erases stored data, and
   * re-uploading the same file changes nothing. A row is matched by Username
   * (in any building), or — only when the row has no Username — by building +
   * mobile. A match is merged cell by cell (`mergeCustomerUpdate`); no match
   * is a new customer. A bad row is a *skip with a reason*, never a failed
   * file; a recoverable problem (unknown wing, bad email/mobile on an update)
   * is a *flag* and the rest of the row still applies.
   *
   * `dryRun` answers the same report and writes nothing — the preview.
   */
  async function importCustomers(rows, actor, { dryRun = false } = {}) {
    const requested = [...new Set(rows.map((row) => row.buildingId))]
    const buildingIds = await customerRepository.findBuildingIds(requested)
    const knownBuildings = new Set(buildingIds)
    const usernames = [
      ...new Set(rows.map((row) => String(row.username ?? '').trim()).filter(Boolean)),
    ]
    const [wingsByBuilding, storedHere, storedByUsername] = await Promise.all([
      customerRepository.listWingsForBuildings(buildingIds),
      customerRepository.listForImport(buildingIds),
      customerRepository.listByUsernames(usernames),
    ])

    const byUsername = new Map()
    for (const customer of [...storedHere, ...storedByUsername]) {
      if (customer.username && !byUsername.has(customer.username)) byUsername.set(customer.username, customer)
    }
    // Several stored customers can share a mobile in one building (two
    // connections, two Usernames); a row without a Username prefers the one
    // that has no Username either.
    const byMobile = new Map()
    for (const customer of storedHere) {
      const key = `${customer.buildingId}:${customer.mobile}`
      if (!byMobile.has(key)) byMobile.set(key, [])
      byMobile.get(key).push(customer)
    }
    const wingName = (buildingId, wingId) =>
      wingId ? (wingsByBuilding.get(buildingId)?.find((wing) => wing.id === wingId)?.name ?? null) : null

    const report = []
    const skipped = []
    const flagged = []
    const creates = []
    const updates = []
    const seenIdentities = new Set()
    const matchedIds = new Set()
    let unchangedCount = 0

    for (const row of rows) {
      const sheet = row.sheet ?? null
      const label = String(row.name ?? '').trim() || String(row.mobile ?? '').trim() || `row ${row.row}`
      const flags = []
      const skip = (reason) => {
        skipped.push({ row: row.row, sheet, name: label, reason })
        report.push({ row: row.row, sheet, outcome: 'skip', wingName: null, flags, reason })
      }
      const finish = (outcome, finalWingName) => {
        for (const note of flags) flagged.push({ row: row.row, sheet, name: label, note })
        report.push({ row: row.row, sheet, outcome, wingName: finalWingName, flags })
      }

      if (!knownBuildings.has(row.buildingId)) {
        skip('Building not found')
        continue
      }
      const cleaned = toData({ ...row, wingId: null })
      // No Username and no mobile → no identity; the field check below gives
      // the real reason ("Mobile number is missing"), not a false duplicate.
      if (cleaned.username || cleaned.mobile) {
        const identity = customerIdentity(row)
        if (seenIdentities.has(identity)) {
          skip('Duplicate in this file')
          continue
        }
        seenIdentities.add(identity)
      }

      const mobileCandidates = cleaned.mobile
        ? (byMobile.get(`${row.buildingId}:${cleaned.mobile}`) ?? []).filter((c) => !matchedIds.has(c.id))
        : []
      let match = null
      if (cleaned.username) {
        match = byUsername.get(cleaned.username) ?? null
        if (match && match.buildingId !== row.buildingId) {
          skip(`Username belongs to ${match.building?.buildingName ?? 'another building'}`)
          continue
        }
        // First upload of a billing sheet: a customer added by hand (no
        // Username) on the same number is this one — claim it, oldest first.
        // One that already has a different Username is a second connection.
        if (!match) match = mobileCandidates.find((customer) => !customer.username) ?? null
      } else {
        match = mobileCandidates.find((customer) => !customer.username) ?? mobileCandidates[0] ?? null
      }
      if (match && matchedIds.has(match.id)) {
        skip('Duplicate in this file')
        continue
      }

      // The wing is resolved only once the row is known to be kept, so a
      // skipped row never carries a wing flag.
      const wingsHere = wingsByBuilding.get(row.buildingId)

      if (match) {
        matchedIds.add(match.id)
        const wing = matchWing(row.wing, wingsHere, { update: true })
        if (wing.flag) flags.push(wing.flag)
        cleaned.wingId = wing.wingId
        // On an update a blank name/mobile simply means "leave alone"; only a
        // filled-but-wrong email or mobile needs saying, and it is dropped.
        const errors = customerFieldErrors({ ...row, name: 'x', mobile: row.mobile || match.mobile })
        if (errors.includes('Email address looks wrong')) {
          cleaned.email = null
          flags.push('Email address looks wrong — kept the old one')
        }
        if (errors.includes('Mobile number looks wrong')) {
          cleaned.mobile = null
          flags.push('Mobile number looks wrong — kept the old one')
        }
        const { data, changed } = mergeCustomerUpdate(match, cleaned)
        const finalWingId = data.wingId ?? match.wingId
        if (changed) {
          updates.push({ id: match.id, data })
          finish('update', wingName(row.buildingId, finalWingId))
        } else {
          unchangedCount += 1
          finish('unchanged', wingName(row.buildingId, finalWingId))
        }
        continue
      }

      const errors = customerFieldErrors(row)
      if (errors.length) {
        skip(errors[0])
        continue
      }
      const wing = matchWing(row.wing, wingsHere)
      if (wing.flag) flags.push(wing.flag)
      cleaned.wingId = wing.wingId
      creates.push({ ...cleaned, buildingId: row.buildingId, createdById: actor.id })
      finish('create', wingName(row.buildingId, cleaned.wingId))
    }

    const notInSheet = storedHere
      .filter((customer) => !matchedIds.has(customer.id))
      .map((customer) => ({
        id: customer.id,
        name: customer.name,
        mobile: customer.mobile,
        buildingName: customer.building?.buildingName ?? null,
        wingName: customer.wing?.name ?? null,
      }))

    if (!dryRun && (creates.length || updates.length)) {
      await customerRepository.applyImport({ creates, updates })
    }
    return {
      createdCount: creates.length,
      updatedCount: updates.length,
      unchangedCount,
      rows: report,
      skipped,
      flagged,
      notInSheet,
    }
  }

  return {
    listCustomers,
    getCustomer,
    getBuildingConnections,
    getCustomerConnection,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    lookupBuildings,
    importCustomers,
  }
}
