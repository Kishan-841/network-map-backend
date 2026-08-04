import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.js'
import { statsController } from './stats.controller.js'

export const statsRoutes = Router()

// All roles may read: the service scopes surveyors to their own buildings.
statsRoutes.get('/dashboard', requireAuth, statsController.dashboard)
