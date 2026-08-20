import { createStatsService } from './stats.service.js'
import { createAcquisitionService } from './acquisition.service.js'
import { prisma } from '../../lib/prisma.js'
import { statsRepository } from './stats.repository.js'
import { userRepository } from '../users/user.repository.js'

const statsService = createStatsService({ statsRepository, userRepository })

const acquisitionService = createAcquisitionService({ prisma })

export const statsController = {
  async acquisition(req, res, next) {
    try {
      const data = await acquisitionService.getAcquisitionStats(req.validatedQuery ?? {})
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async dashboard(req, res, next) {
    try {
      const stats = await statsService.getDashboardStats(req.user, req.validatedQuery ?? {})
      res.json({ success: true, data: stats })
    } catch (err) {
      next(err)
    }
  },
}
