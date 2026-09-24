import bcrypt from 'bcryptjs'
import { ApiError } from '../../lib/api-error.js'
import { prisma } from '../../lib/prisma.js'
import { toPublicUser } from '../auth/auth.service.js'
import { BUILDING_EDIT_ROLES, FIBER_ACCESS_ROLES } from '../../middleware/auth.js'

const BCRYPT_ROUNDS = 10

// Accepts the enum values and the friendly sheet labels, case-insensitive.
const BULK_ROLE_ALIASES = {
  SALES_MANAGER: 'SALES_MANAGER',
  'SALES MANAGER': 'SALES_MANAGER',
  TEAM_LEADER: 'TEAM_LEADER',
  'TEAM LEADER': 'TEAM_LEADER',
  SALES_EXECUTIVE: 'SALES_EXECUTIVE',
  'SALES EXECUTIVE': 'SALES_EXECUTIVE',
}
const BULK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function createUserService({ userRepository, zoneRepository, cityRepository }) {
  // Acquisition agents cover one city + a set of pincodes. Stored as rows so
  // an agent can hold several pincodes and the mapping stays queryable.
  async function pincodeAssignment({ cityId, pincodes, role, userId }) {
    if (role !== 'ACQUISITION_AGENT' || pincodes === undefined) return null
    if (pincodes.length > 0 && !cityId) {
      throw ApiError.badRequest('Select a city for the agent\'s pincodes')
    }
    if (cityId) {
      const city = await cityRepository.findById(cityId)
      if (!city) throw ApiError.badRequest('City does not exist')
    }
    const unique = [...new Set(pincodes)]
    return { cityId, pincodes: unique, userId }
  }

  // Leads run the acquisition team only — they must never create or touch
  // admins, managers or coverage surveyors.
  function assertMayManage(actor, targetRole) {
    if (actor?.role !== 'ACQUISITION_LEAD') return
    if (targetRole !== 'ACQUISITION_AGENT') {
      throw ApiError.forbidden('Acquisition leads can only manage acquisition agents')
    }
  }

  // The field-sales chain, sanitised: a non-sales role (and a SALES_MANAGER, who
  // reports to the admin) carries no manager/leader; a TEAM_LEADER's manager
  // must be a SALES_MANAGER; a SALES_EXECUTIVE's manager a SALES_MANAGER and its
  // leader a TEAM_LEADER. Always returns both keys so a role change clears stale
  // links.
  const SALES_ROLES = ['SALES_MANAGER', 'TEAM_LEADER', 'SALES_EXECUTIVE']
  async function salesHierarchy(role, managerId, teamLeaderId) {
    if (!SALES_ROLES.includes(role) || role === 'SALES_MANAGER') {
      return { managerId: null, teamLeaderId: null }
    }
    const out = {
      managerId: managerId ?? null,
      teamLeaderId: role === 'SALES_EXECUTIVE' ? (teamLeaderId ?? null) : null,
    }
    if (out.managerId) {
      const m = await userRepository.findById(out.managerId)
      if (!m || m.role !== 'SALES_MANAGER') throw ApiError.badRequest('Manager must be a sales manager')
    }
    if (out.teamLeaderId) {
      const t = await userRepository.findById(out.teamLeaderId)
      if (!t || t.role !== 'TEAM_LEADER') throw ApiError.badRequest('Team leader must be a team leader')
    }
    return out
  }

  // zoneIds -> Prisma relation op, or undefined when not applicable
  // (assignments are stored only for surveyors).
  async function zoneAssignment(zoneIds, role, op) {
    if (zoneIds === undefined || role !== 'SURVEYOR') return undefined
    // Dedupe first: countByIds is a distinct-row count, so a repeated id
    // (UI double-click / merged sheet) would otherwise fail the length check.
    const uniqueIds = [...new Set(zoneIds)]
    const found = await zoneRepository.countByIds(uniqueIds)
    if (found !== uniqueIds.length) throw ApiError.badRequest('One or more zones do not exist')
    return { [op]: uniqueIds.map((id) => ({ id })) }
  }

  // A role change can leave a fiber tick on someone who should no longer have
  // it. Return the new value for canManageFiber, or undefined to leave the
  // stored value alone. (Throwing an ApiError here refuses the role change.)
  function fiberAccessAfterRoleChange(current, nextRole) {
    // Cleared, not kept: a tick that survived a spell in another team would
    // come back to life the day they return — an access nobody chose to give.
    if (current.canManageFiber && !FIBER_ACCESS_ROLES.includes(nextRole)) return false
    return undefined
  }

  // The same reasoning for the building-edit grant, which only a surveyor holds.
  function buildingAccessAfterRoleChange(current, nextRole) {
    if (current.canEditBuildings && !BUILDING_EDIT_ROLES.includes(nextRole)) return false
    return undefined
  }

  return {
    async createUser({ password, zoneIds, cityId, pincodes, managerId, teamLeaderId, ...data }, actor) {
      assertMayManage(actor, data.role)
      const existing = await userRepository.findByEmail(data.email)
      if (existing) throw ApiError.conflict('A user with this email already exists')

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
      const assignedZones = await zoneAssignment(zoneIds, data.role, 'connect')
      const pin = await pincodeAssignment({ cityId, pincodes, role: data.role })
      const hierarchy = await salesHierarchy(data.role, managerId, teamLeaderId)
      const user = await userRepository.create({
        ...data,
        ...hierarchy,
        passwordHash,
        ...(assignedZones && { assignedZones }),
        ...(pin && {
          pincodes: {
            create: pin.pincodes.map((pincode) => ({ pincode, cityId: pin.cityId })),
          },
        }),
      })
      return toPublicUser(user)
    },

    /**
     * Bulk-create the field-sales hierarchy from a sheet. Each row is
     * {name, email, password, role, reportsToEmail}; a team leader's
     * reportsToEmail names their sales manager, an executive's names their team
     * leader (whose manager the executive inherits). References resolve against
     * rows in the same sheet AND existing users. All-or-nothing: if any row is
     * invalid, nothing is created and every error is returned; otherwise all are
     * created in dependency order (managers → leaders → executives) in one
     * transaction. Returns { created, errors }.
     */
    async bulkCreateUsers(rows) {
      const errors = []
      const push = (row, email, message) => errors.push({ row, email, message })

      // Normalise every row up front (trim, canonical role, lowercase keys).
      const norm = rows.map((r, i) => {
        const email = (r.email ?? '').trim()
        const reportsTo = (r.reportsToEmail ?? '').trim()
        return {
          rowNo: i + 1,
          name: (r.name ?? '').trim(),
          email,
          emailKey: email.toLowerCase(),
          password: r.password ?? '',
          roleRaw: (r.role ?? '').trim(),
          role: BULK_ROLE_ALIASES[(r.role ?? '').trim().toUpperCase()] ?? null,
          reportsTo,
          reportsToKey: reportsTo.toLowerCase(),
        }
      })

      // Per-row field checks, and an in-sheet index by email.
      const sheetByEmail = new Map()
      for (const row of norm) {
        if (!row.name) push(row.rowNo, row.email, 'Name is required')
        if (!row.email) push(row.rowNo, row.email, 'Email is required')
        else if (!BULK_EMAIL_RE.test(row.email)) push(row.rowNo, row.email, 'Email is not valid')
        if (row.password.length < 8 || !/[a-zA-Z]/.test(row.password) || !/[0-9]/.test(row.password))
          push(row.rowNo, row.email, 'Password needs at least 8 characters, a letter and a number')
        if (!row.role)
          push(row.rowNo, row.email, `Role "${row.roleRaw}" must be Sales manager, Team leader or Sales executive`)
        if (row.emailKey) {
          if (sheetByEmail.has(row.emailKey)) push(row.rowNo, row.email, 'This email appears more than once in the file')
          else sheetByEmail.set(row.emailKey, row)
        }
      }

      // Existing accounts (a bulk create never overwrites) and any external
      // referenced manager/leader — fetched once, case-insensitive.
      const wantEmails = new Set()
      for (const row of norm) {
        if (row.emailKey) wantEmails.add(row.emailKey)
        if (row.reportsToKey) wantEmails.add(row.reportsToKey)
      }
      const foundExisting = await Promise.all(
        [...wantEmails].map((e) => userRepository.findByEmailInsensitive(e)),
      )
      const existingByEmail = new Map()
      for (const u of foundExisting) if (u) existingByEmail.set(u.email.toLowerCase(), u)

      for (const row of norm) {
        if (row.emailKey && existingByEmail.has(row.emailKey))
          push(row.rowNo, row.email, 'A user with this email already exists')
      }

      // Resolve who each row reports to (sheet first, then an existing user) and
      // check the referenced role. Managers report to no one.
      const roleFor = (key) => sheetByEmail.get(key)?.role ?? existingByEmail.get(key)?.role ?? null
      for (const row of norm) {
        if (!row.role || row.role === 'SALES_MANAGER') continue
        const need = row.role === 'TEAM_LEADER' ? 'SALES_MANAGER' : 'TEAM_LEADER'
        const label = need === 'SALES_MANAGER' ? 'sales manager' : 'team leader'
        if (!row.reportsTo) {
          push(row.rowNo, row.email, `Reports to (${label} email) is required`)
        } else {
          const refRole = roleFor(row.reportsToKey)
          if (!refRole) push(row.rowNo, row.email, `Reports-to "${row.reportsTo}" is not in the file or the system`)
          else if (refRole !== need) push(row.rowNo, row.email, `Reports-to "${row.reportsTo}" must be a ${label}`)
        }
      }

      if (errors.length) {
        errors.sort((a, b) => a.row - b.row)
        return { created: [], errors }
      }

      // All valid — hash outside the transaction, then create in dependency
      // order so a reference is always to an already-created (or existing) user.
      const hashByEmail = new Map(
        await Promise.all(norm.map(async (r) => [r.emailKey, await bcrypt.hash(r.password, BCRYPT_ROUNDS)])),
      )
      // idByEmail: emailKey -> { id, managerId } for every referenceable user.
      const idByEmail = new Map()
      for (const [key, u] of existingByEmail) idByEmail.set(key, { id: u.id, managerId: u.managerId })

      const byRole = (role) => norm.filter((r) => r.role === role)
      const created = await prisma.$transaction(async (tx) => {
        const out = []
        const make = async (row, managerId, teamLeaderId) => {
          const u = await tx.user.create({
            data: {
              name: row.name,
              email: row.email,
              passwordHash: hashByEmail.get(row.emailKey),
              role: row.role,
              managerId,
              teamLeaderId,
            },
          })
          idByEmail.set(row.emailKey, { id: u.id, managerId })
          out.push(u)
        }
        for (const row of byRole('SALES_MANAGER')) await make(row, null, null)
        for (const row of byRole('TEAM_LEADER')) {
          const mgr = idByEmail.get(row.reportsToKey)
          await make(row, mgr.id, null)
        }
        for (const row of byRole('SALES_EXECUTIVE')) {
          const leader = idByEmail.get(row.reportsToKey)
          await make(row, leader.managerId ?? null, leader.id)
        }
        return out
      })

      return { created: created.map(toPublicUser), errors: [] }
    },

    async listUsers(actor) {
      const users = await userRepository.list()
      const scoped =
        actor?.role === 'ACQUISITION_LEAD'
          ? users.filter((u) => u.role === 'ACQUISITION_AGENT')
          : users
      return scoped.map(toPublicUser)
    },

    // Sheet-driven assignment: each row REPLACES that surveyor's zone set.
    // Rows with any unresolvable zone name are skipped whole — a typo must
    // never silently shrink an assignment.
    async bulkAssignZones(assignments) {
      const zones = await zoneRepository.list()
      const zoneIdByName = new Map(zones.map((zone) => [zone.name.trim().toLowerCase(), zone.id]))

      const updated = []
      const skipped = []
      for (const { email, zoneNames } of assignments) {
        const user = await userRepository.findByEmailInsensitive(email.trim())
        if (!user) {
          skipped.push({ email, reason: 'user not found' })
          continue
        }
        if (user.role !== 'SURVEYOR') {
          skipped.push({ email, reason: 'not a surveyor' })
          continue
        }
        const missing = zoneNames.filter(
          (name) => !zoneIdByName.has(name.trim().toLowerCase()),
        )
        if (missing.length > 0) {
          skipped.push({ email, reason: `zone(s) not found: ${missing.join(', ')}` })
          continue
        }
        const ids = [...new Set(zoneNames.map((name) => zoneIdByName.get(name.trim().toLowerCase())))]
        await userRepository.update(user.id, {
          assignedZones: { set: ids.map((id) => ({ id })) },
        })
        updated.push({ email: user.email, zones: ids.length })
      }
      return { updated, skipped, total: assignments.length }
    },

    async listUsersPaged({ page, pageSize, search, role }, actor) {
      const where = {
        // A lead's directory is their own team, nobody else.
        ...(actor?.role === 'ACQUISITION_LEAD' ? { role: 'ACQUISITION_AGENT' } : role && { role }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }),
      }
      const [items, total] = await Promise.all([
        userRepository.paged({ where, skip: (page - 1) * pageSize, take: pageSize }),
        userRepository.count(where),
      ])
      return {
        items: items.map(toPublicUser),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      }
    },

    async updateUser(id, { password, email, zoneIds, cityId, pincodes, managerId, teamLeaderId, ...data }, actor) {
      // Explicit existence check → 404 instead of a Prisma P2025 leaking as 500.
      const current = await userRepository.findById(id)
      if (!current) throw ApiError.notFound('User not found')
      // A lead may edit agents only, and may not promote one out of the team.
      assertMayManage(actor, current.role)
      if (data.role) assertMayManage(actor, data.role)
      // Changing to an email another account already uses → clean 409.
      if (email) {
        const existing = await userRepository.findByEmail(email)
        if (existing && existing.id !== id) {
          throw ApiError.conflict('A user with this email already exists')
        }
        data.email = email
      }
      if (data.role && data.role !== current.role) {
        const canManageFiber = fiberAccessAfterRoleChange(current, data.role)
        if (canManageFiber !== undefined) data.canManageFiber = canManageFiber
        const canEditBuildings = buildingAccessAfterRoleChange(current, data.role)
        if (canEditBuildings !== undefined) data.canEditBuildings = canEditBuildings
      }
      // Password is stored only as a hash, never plaintext.
      if (password) data.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

      // Sales hierarchy: recompute (and sanitise) when it is sent or the role
      // changes; otherwise leave it as-is. A move out of the sales roles clears
      // the links.
      const roleChanged = data.role && data.role !== current.role
      if (managerId !== undefined || teamLeaderId !== undefined || roleChanged) {
        const h = await salesHierarchy(
          data.role ?? current.role,
          managerId !== undefined ? managerId : current.managerId,
          teamLeaderId !== undefined ? teamLeaderId : current.teamLeaderId,
        )
        data.managerId = h.managerId
        data.teamLeaderId = h.teamLeaderId
      }

      // zoneIds replaces the full assignment set; omitting it leaves it unchanged.
      if (zoneIds !== undefined) {
        const targetRole = data.role ?? current.role
        const assignedZones = await zoneAssignment(zoneIds, targetRole, 'set')
        if (assignedZones) data.assignedZones = assignedZones
      }

      // pincodes replaces the agent's full set; omitting it leaves it as-is.
      const targetRoleForPin = data.role ?? current.role
      const pin = await pincodeAssignment({
        cityId: cityId === undefined ? current.pincodes?.[0]?.cityId : cityId,
        pincodes,
        role: targetRoleForPin,
      })
      if (pin) {
        data.pincodes = {
          deleteMany: {},
          create: pin.pincodes.map((pincode) => ({ pincode, cityId: pin.cityId })),
        }
      }

      const user = await userRepository.update(id, data)
      return toPublicUser(user)
    },

    // Per-user accesses, granted by an ADMIN one tick at a time. Each access
    // has its own list of roles that can hold it, and only the ticks named in
    // the request are touched — the others keep whatever they had.
    async setAccess(id, accesses) {
      const current = await userRepository.findById(id)
      if (!current) throw ApiError.notFound('User not found')
      const data = {}
      if (accesses.canManageFiber !== undefined) {
        if (!FIBER_ACCESS_ROLES.includes(current.role)) {
          throw ApiError.badRequest(
            'Fiber access can only be given to managers, surveyors and supervisors',
          )
        }
        data.canManageFiber = accesses.canManageFiber
      }
      if (accesses.canEditBuildings !== undefined) {
        if (!BUILDING_EDIT_ROLES.includes(current.role)) {
          throw ApiError.badRequest('Building editing can only be given to surveyors')
        }
        data.canEditBuildings = accesses.canEditBuildings
      }
      const user = await userRepository.update(id, data)
      return toPublicUser(user)
    },
  }
}
