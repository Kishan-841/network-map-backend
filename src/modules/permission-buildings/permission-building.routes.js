import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { listQuerySchema, visitSchema } from './permission-building.schemas.js'
import { permissionBuildingRepository } from './permission-building.repository.js'
import { createPermissionBuildingService } from './permission-building.service.js'

const service = createPermissionBuildingService({
  repo: permissionBuildingRepository,
  storage: getStorageProvider(),
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
