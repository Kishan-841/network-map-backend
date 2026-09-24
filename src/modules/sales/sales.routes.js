import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { assignBuildingsSchema, historyQuerySchema } from './sales.schemas.js'
import { salesController } from './sales.controller.js'

export const salesRoutes = Router()

salesRoutes.use(requireAuth)

// Any sales user (or an admin) may read their scoped buildings and history.
const SALES_ANY = requireRole('ADMIN', 'SALES_MANAGER', 'TEAM_LEADER', 'SALES_EXECUTIVE')
// Only those who run people may assign — executives never do.
const ASSIGNER = requireRole('ADMIN', 'SALES_MANAGER', 'TEAM_LEADER')

salesRoutes.get('/buildings', SALES_ANY, salesController.myBuildings)

salesRoutes.get('/team', ASSIGNER, salesController.team)

salesRoutes.get('/assignments', SALES_ANY, validateQuery(historyQuerySchema), salesController.history)

salesRoutes.post(
  '/assignments',
  ASSIGNER,
  audit('BuildingAssignment', 'AssignBuildings', {
    describe: (req, _old, body) =>
      body?.data ? `${body.data.count} building(s) assigned` : 'Buildings assigned',
  }),
  validateBody(assignBuildingsSchema),
  salesController.assign,
)
