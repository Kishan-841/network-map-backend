import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { listQuerySchema, visitSchema, approveSchema, rejectSchema } from './permission-building.schemas.js'
import { zoneRepository } from '../zones/zone.repository.js'
import { permissionBuildingRepository } from './permission-building.repository.js'
import { createPermissionBuildingService } from './permission-building.service.js'

const service = createPermissionBuildingService({
  repo: permissionBuildingRepository,
  storage: getStorageProvider(),
  zoneRepository,
})

const handle = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json({ success: true, data: await fn(req) })
  } catch (err) {
    next(err)
  }
}

export const permissionBuildingRoutes = Router()
permissionBuildingRoutes.use(requireAuth, requireRole('PERMISSION_EXECUTIVE', 'ADMIN'))

permissionBuildingRoutes.get(
  '/',
  validateQuery(listQuerySchema),
  handle((req) => service.list(req.validatedQuery ?? {}, req.user)),
)
// Above /:id — 'pending-count' is not an id.
permissionBuildingRoutes.get(
  '/pending-count',
  requireRole('ADMIN'),
  handle(() => service.pendingCount()),
)
permissionBuildingRoutes.get('/:id', handle((req) => service.get(req.params.id, req.user)))
permissionBuildingRoutes.post(
  '/:id/visits',
  // module 'Building' so the log row carries the building id like other building events.
  audit('Building', 'PermissionVisit', {
    describe: (req, old, body) =>
      body?.data?.visit?.statusAfter
        ? `Society visit update: ${body.data.visit.statusBefore ?? 'none'} → ${body.data.visit.statusAfter}`
        : 'Society visit update',
  }),
  validateBody(visitSchema),
  handle((req) => service.addVisit(req.params.id, req.body, req.user), 201),
)

// Phase 2 — ADMIN only. Each is one transaction under the building's row lock.
permissionBuildingRoutes.post(
  '/:id/approve',
  requireRole('ADMIN'),
  audit('Building', 'SocietyApprove', {
    describe: (req, old, body) =>
      `Society '${body?.data?.buildingName ?? req.params.id}' approved into zone ${body?.data?.zone?.name ?? req.body?.zoneId ?? ''}`.trim(),
  }),
  validateBody(approveSchema),
  handle((req) => service.approve(req.params.id, req.body, req.user)),
)
permissionBuildingRoutes.post(
  '/:id/reject',
  requireRole('ADMIN'),
  audit('Building', 'SocietyReject', {
    describe: (req, old, body) => `Society '${body?.data?.buildingName ?? req.params.id}' rejected: ${String(req.body?.reason ?? '').slice(0, 200)}`,
  }),
  validateBody(rejectSchema),
  handle((req) => service.reject(req.params.id, req.body, req.user)),
)
