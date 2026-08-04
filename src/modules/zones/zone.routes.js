import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import {
  createZoneSchema,
  updateZoneSchema,
  bulkZoneSchema,
  listZonesQuerySchema,
} from './zone.schemas.js'
import { zoneController } from './zone.controller.js'
import { audit } from '../system-logs/audit.js'
import { zoneRepository } from './zone.repository.js'

export const zoneRoutes = Router()

zoneRoutes.use(requireAuth)
zoneRoutes.get('/', validateQuery(listZonesQuerySchema), zoneController.list)
zoneRoutes.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  audit('Zone', 'Create', { describe: (req) => `Zone '${req.body?.name ?? 'unknown'}' created` }),
  validateBody(createZoneSchema),
  zoneController.create,
)
zoneRoutes.post(
  '/bulk',
  requireRole('ADMIN', 'MANAGER'),
  audit('Zone', 'BulkCreate', {
    describe: (req, old, body) =>
      body?.data
        ? `Bulk zone import: ${body.data.created.length} created, ${body.data.skipped.length} skipped`
        : 'Bulk zone import',
  }),
  validateBody(bulkZoneSchema),
  zoneController.bulk,
)
zoneRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('Zone', 'Update', {
    load: (req) => zoneRepository.findById(req.params.id),
    describe: (req, old) => `Zone '${old?.name ?? req.params.id}' updated`,
  }),
  validateBody(updateZoneSchema),
  zoneController.update,
)
zoneRoutes.delete(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  audit('Zone', 'Delete', {
    load: (req) => zoneRepository.findById(req.params.id),
    describe: (req, old) => `Zone '${old?.name ?? req.params.id}' deleted`,
  }),
  zoneController.remove,
)
