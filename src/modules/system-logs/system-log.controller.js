import { systemLogService } from './system-log.service.js'

export const systemLogController = {
  async list(req, res, next) {
    try {
      const data = await systemLogService.listLogs(req.validatedQuery)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },
}
