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
// Coverage-only: zone rows carry boundary polygons and operator links — the
// acquisition team must never receive the coverage network layout.
zoneRoutes.get(
  '/',
  // SALES_MANAGER reads it to filter the registry by zone when assigning to
  // their team (read-only; zone writes stay ADMIN). A TEAM_LEADER reads
  // their own zones' outlines for the Sales map.
  requireRole('ADMIN', 'MANAGER', 'SURVEYOR', 'SUPERVISOR', 'SALES_MANAGER', 'TEAM_LEADER'),
  validateQuery(listZonesQuerySchema),
  zoneController.list,
)
zoneRoutes.post(
  '/',
  requireRole('ADMIN'),
  audit('Zone', 'Create', { describe: (req) => `Zone '${req.body?.name ?? 'unknown'}' created` }),
  validateBody(createZoneSchema),
  zoneController.create,
)
zoneRoutes.post(
  '/bulk',
  requireRole('ADMIN'),
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
  requireRole('ADMIN'),
  audit('Zone', 'Update', {
    load: (req) => zoneRepository.findById(req.params.id),
    describe: (req, old) => `Zone '${old?.name ?? req.params.id}' updated`,
  }),
  validateBody(updateZoneSchema),
  zoneController.update,
)
zoneRoutes.delete(
  '/:id',
  requireRole('ADMIN'),
  audit('Zone', 'Delete', {
    load: (req) => zoneRepository.findById(req.params.id),
    describe: (req, old) => `Zone '${old?.name ?? req.params.id}' deleted`,
  }),
  zoneController.remove,
)
