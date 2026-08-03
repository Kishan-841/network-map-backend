import { Router } from 'express'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateQuery } from '../../middleware/validate.js'
import { listLogsQuerySchema } from './system-log.schemas.js'
import { systemLogController } from './system-log.controller.js'

// Read-only by design: audit logs are immutable, so no other verbs exist here.
export const systemLogRoutes = Router()

systemLogRoutes.use(requireAuth, requireRole('ADMIN'))
systemLogRoutes.get('/', validateQuery(listLogsQuerySchema), systemLogController.list)
