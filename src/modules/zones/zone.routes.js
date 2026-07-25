import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { createZoneSchema, updateZoneSchema } from './zone.schemas.js'
import { zoneController } from './zone.controller.js'

export const zoneRoutes = Router()

zoneRoutes.use(requireAuth)
zoneRoutes.get('/', zoneController.list)
zoneRoutes.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  validateBody(createZoneSchema),
  zoneController.create,
)
zoneRoutes.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  validateBody(updateZoneSchema),
  zoneController.update,
)
zoneRoutes.delete('/:id', requireRole('ADMIN', 'MANAGER'), zoneController.remove)
