import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import {
  assignBuildingsSchema,
  historyQuerySchema,
  searchBuildingsQuerySchema,
  checkInSchema,
  visitActivitySchema,
  checkOutSchema,
  createInquirySchema,
  activityQuerySchema,
  dashboardQuerySchema,
} from './sales.schemas.js'
import { salesController } from './sales.controller.js'

export const salesRoutes = Router()

salesRoutes.use(requireAuth)

// Any sales user (or an admin) may read their scoped buildings and history.
const SALES_ANY = requireRole('ADMIN', 'SALES_MANAGER', 'TEAM_LEADER', 'SALES_EXECUTIVE')
// Only those who run people may assign — executives never do.
const ASSIGNER = requireRole('ADMIN', 'SALES_MANAGER', 'TEAM_LEADER')

salesRoutes.get('/buildings', SALES_ANY, salesController.myBuildings)

salesRoutes.get('/team', ASSIGNER, salesController.team)

// Registry search to assign from — a manager (or admin) only; a team leader
// distributes their own pool instead.
salesRoutes.get(
  '/search-buildings',
  requireRole('ADMIN', 'SALES_MANAGER'),
  validateQuery(searchBuildingsQuerySchema),
  salesController.searchBuildings,
)

// Manager / team-leader dashboard: team totals + per-person activity.
salesRoutes.get('/dashboard', ASSIGNER, validateQuery(dashboardQuerySchema), salesController.dashboard)

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

// Field activity — any sales user (or admin) works a building in their scope;
// the service enforces the scope (404 otherwise).
salesRoutes.get('/visits', SALES_ANY, validateQuery(activityQuerySchema), salesController.listVisits)
salesRoutes.get('/visits/open', SALES_ANY, salesController.openVisit)
salesRoutes.post(
  '/visits',
  SALES_ANY,
  audit('BuildingVisit', 'CheckIn', { describe: () => 'Checked in to a building' }),
  validateBody(checkInSchema),
  salesController.checkIn,
)
salesRoutes.post(
  '/visits/:id/activities',
  SALES_ANY,
  audit('VisitActivity', 'LogActivity', { describe: (req) => `${req.body?.type ?? 'Activity'} logged` }),
  validateBody(visitActivitySchema),
  salesController.addActivity,
)
salesRoutes.post(
  '/visits/:id/checkout',
  SALES_ANY,
  audit('BuildingVisit', 'CheckOut', { describe: () => 'Checked out of a building' }),
  validateBody(checkOutSchema),
  salesController.checkOut,
)

salesRoutes.get('/inquiries', SALES_ANY, validateQuery(activityQuerySchema), salesController.listInquiries)
salesRoutes.post(
  '/inquiries',
  SALES_ANY,
  audit('CustomerInquiry', 'CreateInquiry', {
    describe: (req) => `Inquiry for ${req.body?.customerName ?? 'a customer'}`,
  }),
  validateBody(createInquirySchema),
  salesController.createInquiry,
)
