import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateQuery } from '../../middleware/validate.js'
import { dashboardQuerySchema, acquisitionQuerySchema } from './stats.schemas.js'
import { statsController } from './stats.controller.js'

export const statsRoutes = Router()

// All roles may read: the service scopes surveyors to their own buildings.
statsRoutes.get(
  '/dashboard',
  requireAuth,
  validateQuery(dashboardQuerySchema),
  statsController.dashboard,
)

// Acquisition team analytics — leads and admins only.
statsRoutes.get(
  '/acquisition',
  requireAuth,
  requireRole('ADMIN', 'ACQUISITION_LEAD'),
  validateQuery(acquisitionQuerySchema),
  statsController.acquisition,
)
