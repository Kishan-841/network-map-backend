import { createStatsService } from './stats.service.js'
import { statsRepository } from './stats.repository.js'
import { userRepository } from '../users/user.repository.js'

const statsService = createStatsService({ statsRepository, userRepository })

export const statsController = {
  async dashboard(req, res, next) {
    try {
      const stats = await statsService.getDashboardStats(req.user, req.validatedQuery ?? {})
      res.json({ success: true, data: stats })
    } catch (err) {
      next(err)
    }
  },
}
