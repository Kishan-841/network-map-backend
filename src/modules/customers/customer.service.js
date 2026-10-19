import { ApiError } from '../../lib/api-error.js'
import { customerFieldErrors, matchBuildingNames, normaliseMobile } from '../../lib/customers.js'

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
export function createCustomerService({ customerRepository, buildingService }) {
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
   * Bulk import. A row is skipped — never a failed file — when its building is
   * gone, a field is unusable, or the mobile already exists in that building
   * (including a duplicate inside this same file).
   */
  async function importCustomers(rows, actor) {
    const buildingIds = [...new Set(rows.map((row) => row.buildingId))]
    const knownBuildings = new Set(await customerRepository.findBuildingIds(buildingIds))
    const stored = await customerRepository.listMobilesForBuildings(buildingIds)
    const seen = new Set(stored.map((row) => `${row.buildingId}:${row.mobile}`))

    const skipped = []
    const accepted = []
    for (const row of rows) {
      const label = String(row.name ?? '').trim() || String(row.mobile ?? '').trim() || `row ${row.row}`
      const skip = (reason) => skipped.push({ row: row.row, name: label, reason })

      if (!knownBuildings.has(row.buildingId)) {
        skip('Building not found')
        continue
      }
      const errors = customerFieldErrors(row)
      if (errors.length) {
        skip(errors[0])
        continue
      }
      const data = { ...toData(row), wingId: null } // wing matching is the import's next step
      const key = `${row.buildingId}:${data.mobile}`
      if (seen.has(key)) {
        skip('Already recorded in this building')
        continue
      }
      seen.add(key)
      accepted.push({ ...data, buildingId: row.buildingId, createdById: actor.id })
    }

    if (accepted.length) await customerRepository.createMany(accepted)
    return { createdCount: accepted.length, skipped }
  }

  return {
    listCustomers,
    getCustomer,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    lookupBuildings,
    importCustomers,
  }
}
