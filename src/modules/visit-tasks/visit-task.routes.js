import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { salesRepository } from '../sales/sales.repository.js'
import { visitTaskRepository } from './visit-task.repository.js'
import { createPlanScope } from './plan-scope.js'
import { createVisitTaskService } from './visit-task.service.js'
import { importSchema, previewSchema } from './visit-task.schemas.js'

const scope = createPlanScope({ repo: visitTaskRepository, salesRepo: salesRepository })
export const visitTaskService = createVisitTaskService({ repo: visitTaskRepository, scope })

const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn(req) })
  } catch (err) {
    next(err)
  }
}
const PLANNER = requireRole('ADMIN', 'SALES_MANAGER', 'TEAM_LEADER')

export const visitTaskRoutes = Router()
visitTaskRoutes.use(requireAuth)
visitTaskRoutes.get('/assignees', PLANNER, handle((req) => visitTaskService.listAssignees(req.user)))
visitTaskRoutes.get('/buildings', PLANNER, handle((req) => visitTaskService.searchBuildings(req.query.q, req.user)))
visitTaskRoutes.get('/uploads', PLANNER, handle((req) => visitTaskService.listUploads(req.user)))
visitTaskRoutes.post('/preview', PLANNER, validateBody(previewSchema), handle((req) => visitTaskService.preview(req.body, req.user)))
visitTaskRoutes.post(
  '/import',
  PLANNER,
  audit('VisitTask', 'ImportTaskPlan', {
    describe: (req) => `Visit plan imported (${req.body?.rows?.length ?? 0} rows)`,
    recordId: (req, body) => body?.data?.uploadId ?? null,
    // A sheet can be 3,000 rows — log the outcome, not the whole payload.
    newValue: (req, body) => ({ fileName: req.body?.fileName ?? null, rows: req.body?.rows?.length ?? 0, ...(body?.data ?? {}) }),
  }),
  validateBody(importSchema),
  handle((req) => visitTaskService.import(req.body, req.user)),
)
