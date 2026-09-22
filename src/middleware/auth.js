import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { ApiError } from '../lib/api-error.js'
import { userRepository } from '../modules/users/user.repository.js'

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized())

  let payload
  try {
    payload = jwt.verify(token, env.jwtSecret)
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token'))
  }

  try {
    // Re-read the user each request so deactivation and role changes take
    // effect immediately instead of lingering until the token expires.
    const user = await userRepository.findById(payload.sub)
    if (!user || !user.isActive) return next(ApiError.unauthorized())
    req.user = {
      id: user.id,
      role: user.role,
      canManageFiber: user.canManageFiber === true,
      canEditBuildings: user.canEditBuildings === true,
      // The zones they work. Fiber, POP and closure visibility reads these,
      // and `findById` already loads them — no extra query per request.
      zoneIds: (user.assignedZones ?? []).map((zone) => zone.id),
    }
    next()
  } catch (err) {
    next(err)
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized())
  if (!roles.includes(req.user.role)) return next(ApiError.forbidden())
  next()
}

// Drawing fiber is a per-user grant, not a role privilege: an ADMIN ticks the
// users who may do it (Users → Assign accesses). The role list still applies
// to a ticked user, so a flag left behind on someone moved to another team — or
// set by hand in the database — opens nothing.
export const FIBER_ACCESS_ROLES = ['MANAGER', 'SURVEYOR', 'SUPERVISOR']

export const mayManageFiber = (actor) =>
  actor?.role === 'ADMIN' ||
  (actor?.canManageFiber === true && FIBER_ACCESS_ROLES.includes(actor?.role))

export const requireFiberWrite = (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized())
  if (!mayManageFiber(req.user)) return next(ApiError.forbidden())
  next()
}

/**
 * Editing buildings. ADMIN, MANAGER and SUPERVISOR always could; a SURVEYOR
 * needs the per-user grant an ADMIN ticks on Users → Assign accesses, and even
 * then only for buildings they logged themselves — that ownership check lives
 * in the building service, next to the row it is about.
 */
export const BUILDING_EDIT_ROLES = ['SURVEYOR']
const ALWAYS_EDIT_BUILDINGS = ['ADMIN', 'MANAGER', 'SUPERVISOR']

export const mayEditBuildings = (actor) =>
  ALWAYS_EDIT_BUILDINGS.includes(actor?.role) ||
  (actor?.canEditBuildings === true && BUILDING_EDIT_ROLES.includes(actor?.role))

export const requireBuildingEdit = (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized())
  if (!mayEditBuildings(req.user)) return next(ApiError.forbidden())
  next()
}

/**
 * Assigning an OLT + PON port to buildings in bulk. Deliberately wider than
 * building editing: EVERY coverage role may do it, a SURVEYOR without the edit
 * tick included (the user's choice). It stays safe because the service scopes
 * the buildings to the actor and, for a non-admin, refuses anything but one
 * zone with an OLT in that zone — a surveyor can only map their own zone.
 */
export const OLT_ASSIGN_ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'SURVEYOR']

export const mayAssignOlt = (actor) => OLT_ASSIGN_ROLES.includes(actor?.role)

export const requireOltAssign = (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized())
  if (!mayAssignOlt(req.user)) return next(ApiError.forbidden())
  next()
}
