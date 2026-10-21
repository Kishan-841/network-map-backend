import { ApiError } from '../../lib/api-error.js'
import {
  customerFieldErrors,
  customerIdentity,
  matchBuildingNames,
  matchWing,
  mergeCustomerUpdate,
  normaliseMobile,
} from '../../lib/customers.js'
import {
  CSV_CAP,
  customerListOrderBy,
  customerListWhere,
  customersCsv,
  expiryWhere,
  oltDownWhere,
  oltReachableOf,
  REFRESH_STALE_MS,
  toListRow,
} from '../../lib/customer-list.js'
import { NO_CONNECTION, mapLimit, pendingConnection, redactConnection, snapshotOf, summariseConnection } from '../../lib/olt-optical.js'

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
  getOltReachability = () => null,
  connectionDeadlineMs = 15000,
  refreshDeadlineMs = 10000,
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
    olt_down: 'oltDown',
    not_linked: 'notLinked',
    no_username: 'noUsername',
    unavailable: 'unavailable',
    pending: 'pending',
  }
  const view = (connection, actor) => (actor?.role === 'ADMIN' ? connection : redactConnection(connection))
  const connectionOf = async (optical, username, opts) =>
    summariseConnection(await optical.lookup(username, opts)) // blank -> null -> no_username

  /**
   * Names of the OLTs the monitoring cannot reach (spec 2026-10-21-customers-refresh §1).
   * Never fatal: anything wrong → an empty set (everything reads as before).
   */
  async function downOlts() {
    try {
      return (await getOltReachability()?.unreachableOlts()) ?? new Set()
    } catch {
      return new Set()
    }
  }

  /** A live Connection plus whether its OLT is reachable (null = no OLT). */
  const withReachability = (connection, down) => ({
    ...connection,
    oltReachable: oltReachableOf(connection.best?.olt, down),
  })
  /** The count bucket: not_seen on an unreachable OLT is "OLT not reachable", not "not seen". */
  const countKey = (connection) =>
    connection.state === 'not_seen' && connection.oltReachable === false ? 'oltDown' : COUNT_KEY[connection.state]

  /**
   * Run fn over items, FAN_OUT at a time, for at most deadlineMs. Returns one
   * entry per item: fn's result, or null when it did not finish in time
   * (items not started by then are never started — no new OLT call).
   * fn must not throw (wrap it); a throw leaves its slot null.
   */
  async function withDeadline(items, deadlineMs, fn) {
    const done = new Array(items.length).fill(null)
    let expired = false
    const work = mapLimit(items, FAN_OUT, async (item, i) => {
      if (expired) return null
      done[i] = await fn(item, i)
      return null
    }).catch(() => {})
    let timer
    const deadline = new Promise((resolve) => {
      timer = setTimeout(resolve, deadlineMs)
    })
    try {
      await Promise.race([work, deadline])
    } finally {
      clearTimeout(timer)
      expired = true
    }
    // A copy: lookups still running may fill `done` later; the caller must not see that.
    return [...done]
  }

  // Keep the last known status on the row. Awaited (one transaction) but never
  // fatal: a failed save is logged by customer id only and the answer still goes out.
  async function saveSnapshots(pairs) {
    const entries = pairs.map(([id, c]) => ({ id, snapshot: snapshotOf(c) })).filter((e) => e.snapshot)
    if (!entries.length) return
    try {
      await customerRepository.saveConnectionSnapshots(entries)
    } catch (e) {
      console.error(`customer connection snapshot not saved (${entries.map((x) => x.id).join(',')}): ${e?.message ?? e}`)
    }
  }

  async function getBuildingConnections({ buildingId }, actor) {
    await buildingService.getBuilding(buildingId, actor) // 404 out of scope
    const optical = getOpticalLookup()
    if (!optical?.enabled) return { enabled: false }
    const customers = await customerRepository.listByBuilding(buildingId)
    const downPromise = downOlts()
    // Overall deadline: lookups still running when it passes count as
    // pending (not checked yet); they may finish later and fill the lookup cache.
    const unavailable = () => summariseConnection({ unavailable: true })
    const done = await withDeadline(customers, connectionDeadlineMs, async (cu) => {
      try {
        return await connectionOf(optical, cu.username)
      } catch {
        return unavailable()
      }
    })
    const list = done.map((d) => d ?? pendingConnection())
    await saveSnapshots(customers.map((cu, i) => [cu.id, list[i]]))
    const down = await downPromise
    const counts = { online: 0, offline: 0, notSeen: 0, oltDown: 0, notLinked: 0, noUsername: 0, unavailable: 0, pending: 0, weak: 0 }
    const connections = {}
    customers.forEach((cu, i) => {
      const connection = withReachability(list[i], down)
      counts[countKey(connection)] += 1
      if (connection.weak) counts.weak += 1
      connections[cu.id] = view(connection, actor)
    })
    return { enabled: true, connections, counts }
  }

  async function getCustomerConnection(id, actor) {
    const customer = await getCustomer(id, actor) // 404 out of scope
    const optical = getOpticalLookup()
    if (!optical?.enabled) return { enabled: false }
    const [connection, down] = await Promise.all([connectionOf(optical, customer.username), downOlts()])
    await saveSnapshots([[customer.id, connection]])
    return { enabled: true, connection: view(withReachability(connection, down), actor) }
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
    // A new (or cleared) Username makes the stored OLT answer about the old one wrong.
    if ((data.username ?? null) !== (existing.username ?? null)) Object.assign(data, NO_CONNECTION)
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
          if ('username' in data && (data.username ?? null) !== (match.username ?? null)) Object.assign(data, NO_CONNECTION)
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

  // ── Every customer the actor may see (spec 2026-10-21) ──

  /**
   * The buildings (with customers) this actor may read: the building read
   * rule applied to lean rows, once per request. A role it allows nothing
   * gets an empty list downstream, never a 403.
   */
  async function scopedBuildings(actor) {
    const canRead = await buildingService.readScope(actor)
    const rows = await customerRepository.listBuildingsWithCustomers()
    // Always an explicit `buildingId IN` list, even for ADMIN — a scope check
    // never relies on "nothing changed since the building query".
    return rows.filter((b) => canRead(b))
  }

  /** The scope narrowed by the zone / building filters — never widened. */
  function narrowedIds(buildings, query) {
    return buildings
      .filter((b) => (!query.zoneId || b.zoneId === query.zoneId) && (!query.buildingId || b.id === query.buildingId))
      .map((b) => b.id)
  }

  async function listAllCustomers(query, actor) {
    const now = new Date()
    const [buildings, down] = await Promise.all([scopedBuildings(actor), downOlts()])
    const where = customerListWhere(query, narrowedIds(buildings, query), now, down)
    const oltDown = oltDownWhere(down)
    const scopeWhere = { buildingId: { in: buildings.map((b) => b.id) } }
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 50
    const and = (extra) => ({ AND: [where, extra] })

    const [rows, total, byState, weak, expiring7d, oltDownCount, networkZones, operators, billingStatuses, planNames] =
      await Promise.all([
        customerRepository.listPage({
          where,
          orderBy: customerListOrderBy(query.sort),
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        customerRepository.count(where),
        customerRepository.countByConnState(where),
        customerRepository.count(and({ connWeak: true })),
        customerRepository.count(and(expiryWhere('7d', now))),
        oltDown ? customerRepository.count(and(oltDown)) : 0,
        customerRepository.distinctValues('networkZone', scopeWhere),
        customerRepository.distinctValues('operator', scopeWhere),
        customerRepository.distinctValues('status', scopeWhere),
        customerRepository.distinctValues('planName', scopeWhere),
      ])

    const zones = new Map()
    for (const b of buildings) if (b.zone) zones.set(b.zone.id, b.zone)
    return {
      rows: rows.map((row) => toListRow(row, down)),
      total,
      page,
      pageSize,
      counts: {
        total,
        online: byState.online ?? 0,
        offline: byState.offline ?? 0,
        // not_seen on an unreachable OLT is counted as oltDown instead.
        notSeen: Math.max(0, (byState.not_seen ?? 0) - oltDownCount),
        oltDown: oltDownCount,
        weak,
        expiring7d,
      },
      facets: {
        zones: [...zones.values()]
          .map((z) => ({ id: z.id, name: z.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        networkZones,
        operators,
        billingStatuses,
        planNames,
        buildings: buildings.map((b) => ({ id: b.id, buildingName: b.buildingName })),
      },
    }
  }

  /** The export: same filter and sort, up to CSV_CAP rows. */
  async function exportCustomersCsv(query, actor) {
    const [buildings, down] = await Promise.all([scopedBuildings(actor), downOlts()])
    const where = customerListWhere(query, narrowedIds(buildings, query), new Date(), down)
    const rows = await customerRepository.listPage({
      where,
      orderBy: customerListOrderBy(query.sort),
      skip: 0,
      take: CSV_CAP + 1,
    })
    const truncated = rows.length > CSV_CAP
    return { csv: customersCsv(rows.slice(0, CSV_CAP).map((row) => toListRow(row, down))), truncated }
  }

  /**
   * Fresh status for the rows on screen (spec 2026-10-21-customers-refresh §2).
   * Ids outside the actor's building scope are dropped silently. A customer
   * with a Username is looked up when its snapshot is older than
   * REFRESH_STALE_MS (or missing), or always with `force` — which also skips
   * the lookup's 10-minute memory cache. Same shared lookup (bucket, cache,
   * de-dup) as every other OLT read; FAN_OUT at a time, refreshDeadlineMs overall.
   * Answers are saved as snapshots; rows that got no answer in time, or a
   * rate-limited / unavailable one, keep their stored snapshot and are listed
   * in `pending`. Rows come back in the list row shape, in the order asked.
   */
  async function refreshCustomers({ ids, force = false }, actor) {
    const wanted = [...new Set(ids)]
    const [buildings, down] = await Promise.all([scopedBuildings(actor), downOlts()])
    const loadRows = () =>
      buildings.length
        ? customerRepository.listPage({
            where: { AND: [{ id: { in: wanted } }, { buildingId: { in: buildings.map((b) => b.id) } }] },
            orderBy: [{ id: 'asc' }],
            skip: 0,
            take: wanted.length,
          })
        : Promise.resolve([])
    let rows = await loadRows()

    const optical = getOpticalLookup()
    const pending = []
    if (optical?.enabled) {
      const cutoff = Date.now() - REFRESH_STALE_MS
      const due = rows.filter(
        (row) =>
          String(row.username ?? '').trim() &&
          (force || !row.connCheckedAt || new Date(row.connCheckedAt).getTime() < cutoff),
      )
      const done = await withDeadline(due, refreshDeadlineMs, async (row) => {
        try {
          return await connectionOf(optical, row.username, force ? { fresh: true } : undefined)
        } catch {
          return summariseConnection({ unavailable: true })
        }
      })
      const pairs = []
      due.forEach((row, i) => {
        const connection = done[i]
        if (connection && snapshotOf(connection)) pairs.push([row.id, connection])
        else pending.push(row.id)
      })
      if (pairs.length) {
        await saveSnapshots(pairs)
        rows = await loadRows()
      }
    }

    const order = new Map(wanted.map((id, i) => [id, i]))
    rows.sort((a, b) => order.get(a.id) - order.get(b.id))
    pending.sort((a, b) => order.get(a) - order.get(b))
    return { rows: rows.map((row) => toListRow(row, down)), pending }
  }

  return {
    listAllCustomers,
    exportCustomersCsv,
    refreshCustomers,
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
