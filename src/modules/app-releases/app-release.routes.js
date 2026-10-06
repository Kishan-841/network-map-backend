import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { validateBody } from '../../middleware/validate.js'
import { appVersionLimiter } from '../../middleware/rate-limit.js'
import { audit } from '../system-logs/audit.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { appReleaseRepository } from './app-release.repository.js'
import { createAppReleaseService } from './app-release.service.js'

const service = createAppReleaseService({ repo: appReleaseRepository, storage: getStorageProvider() })

const versionSchema = z.object({ version: z.string().trim() }).strict()
const registerSchema = z.object({ version: z.string().trim(), notes: z.string().max(500).optional() }).strict()
const minimumSchema = z.object({ minimumSupportedVersion: z.string().trim() }).strict()

const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn(req) })
  } catch (err) {
    next(err)
  }
}

/** Public: the app asks this before anyone signs in. */
export const appVersionRoutes = Router()
appVersionRoutes.get('/', appVersionLimiter, handle(() => service.current()))

/** ADMIN: release APKs and set the minimum version. */
export const appReleaseRoutes = Router()
appReleaseRoutes.use(requireAuth, requireRole('ADMIN'))
appReleaseRoutes.get('/', handle(() => service.list()))
appReleaseRoutes.post('/upload-url', validateBody(versionSchema), handle((req) => service.uploadUrl(req.body.version)))
appReleaseRoutes.post(
  '/',
  audit('AppRelease', 'Create', { describe: (req) => `App version ${req.body?.version} released` }),
  validateBody(registerSchema),
  handle((req) => service.register(req.body, req.user)),
)
appReleaseRoutes.put(
  '/minimum',
  audit('AppRelease', 'SetMinimum', {
    recordId: () => 'singleton',
    describe: (req) => `Minimum app version set to ${req.body?.minimumSupportedVersion}`,
  }),
  validateBody(minimumSchema),
  handle((req) => service.setMinimum(req.body.minimumSupportedVersion, req.user)),
)
