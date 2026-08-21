import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateQuery } from '../../middleware/validate.js'
import { dashboardQuerySchema, acquisitionQuerySchema } from './stats.schemas.js'
import { statsController } from './stats.controller.js'

export const statsRoutes = Router()

// Coverage KPIs. Surveyors are scoped to their own buildings inside the
// service; the acquisition team has its own dashboard and must not read these.
statsRoutes.get(
  '/dashboard',
  requireAuth,
  requireRole('ADMIN', 'MANAGER', 'SURVEYOR'),
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
