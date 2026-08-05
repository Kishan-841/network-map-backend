import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { validateQuery } from '../../middleware/validate.js'
import { dashboardQuerySchema } from './stats.schemas.js'
import { statsController } from './stats.controller.js'

export const statsRoutes = Router()

// All roles may read: the service scopes surveyors to their own buildings.
statsRoutes.get(
  '/dashboard',
  requireAuth,
  validateQuery(dashboardQuerySchema),
  statsController.dashboard,
)
