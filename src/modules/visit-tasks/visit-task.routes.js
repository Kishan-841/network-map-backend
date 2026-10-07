import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody, validateQuery } from '../../middleware/validate.js'
import { audit } from '../system-logs/audit.js'
import { salesRepository } from '../sales/sales.repository.js'
import { visitTaskRepository } from './visit-task.repository.js'
import { createPlanScope } from './plan-scope.js'
import { createVisitTaskService } from './visit-task.service.js'
import { importSchema, previewSchema, rangeQuerySchema, taskPatchSchema, taskSchema } from './visit-task.schemas.js'

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
const SALES_ANY = requireRole('ADMIN', 'SALES_MANAGER', 'TEAM_LEADER', 'SALES_EXECUTIVE')

export const visitTaskRoutes = Router()
visitTaskRoutes.use(requireAuth)
// validateQuery writes to req.validatedQuery (Express 5's req.query is a getter).
visitTaskRoutes.get('/', SALES_ANY, validateQuery(rangeQuerySchema), handle((req) => visitTaskService.listTasks(req.validatedQuery, req.user)))
visitTaskRoutes.get('/overdue', SALES_ANY, validateQuery(rangeQuerySchema), handle((req) => visitTaskService.listOverdue(req.validatedQuery, req.user)))
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

// Single tasks — registered after every literal path so '/:id' never shadows one.
const loadTask = (req) => visitTaskRepository.findTask(req.params.id)
visitTaskRoutes.post(
  '/',
  PLANNER,
  audit('VisitTask', 'TaskCreate', { describe: () => 'Visit task added' }),
  validateBody(taskSchema),
  async (req, res, next) => {
    try {
      res.status(201).json({ success: true, data: await visitTaskService.createTask(req.body, req.user) })
    } catch (err) {
      next(err)
    }
  },
)
visitTaskRoutes.patch(
  '/:id',
  PLANNER,
  audit('VisitTask', 'TaskUpdate', { load: loadTask, describe: (req) => `Visit task ${req.params.id} changed` }),
  validateBody(taskPatchSchema),
  handle((req) => visitTaskService.updateTask(req.params.id, req.body, req.user)),
)
visitTaskRoutes.delete(
  '/:id',
  PLANNER,
  audit('VisitTask', 'TaskDelete', { load: loadTask, describe: (req) => `Visit task ${req.params.id} deleted` }),
  handle((req) => visitTaskService.deleteTask(req.params.id, req.user)),
)
