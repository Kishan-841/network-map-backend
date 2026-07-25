import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { statsController } from './stats.controller.js'

export const statsRoutes = Router()

statsRoutes.get(
  '/dashboard',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  statsController.dashboard,
)
