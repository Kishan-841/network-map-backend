import { parseRequestInfo } from './request-info.js'
import { systemLogService } from './system-log.service.js'

export function createAudit(recordLog) {
  return function audit(module, action, opts = {}) {
    return async (req, res, next) => {
      let oldValue = null
      if (opts.load) {
        try {
          oldValue = (await opts.load(req)) ?? null
        } catch {
          oldValue = null
        }
      }

      // Stash the JSON body so the finish handler can read ids and error messages.
      const originalJson = res.json.bind(res)
      res.json = (body) => {
        res.locals.auditBody = body
        return originalJson(body)
      }

      res.on('finish', () => {
        const body = res.locals.auditBody
        const failed = res.statusCode >= 400
        const recordId = opts.recordId?.(req, body) ?? req.params.id ?? body?.data?.id ?? null
        const buildingId =
          opts.buildingId?.(req, body) ??
          (module === 'Building' ? recordId : req.body?.buildingId ?? null)
        recordLog({
          userId: req.user?.id ?? null,
          module,
          action,
          description: opts.describe?.(req, oldValue, body) ?? `${module} ${action.toLowerCase()}`,
          oldValue: failed ? null : oldValue,
          // A failed request changed nothing, and on failure req.body is the
          // raw (unvalidated) payload — never persist it (log-spam / poisoning).
          newValue: !failed && req.body && Object.keys(req.body).length ? req.body : null,
          recordId,
          buildingId,
          ...parseRequestInfo(req),
          requestUrl: req.originalUrl,
          httpMethod: req.method,
          status: failed ? 'FAILED' : 'SUCCESS',
          statusCode: res.statusCode,
          errorMessage: failed ? body?.error?.message ?? null : null,
        })
      })

      next()
    }
  }
}

export const audit = createAudit((entry) => systemLogService.recordLog(entry))
