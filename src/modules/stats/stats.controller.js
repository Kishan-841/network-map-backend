import { createStatsService } from './stats.service.js'
import { statsRepository } from './stats.repository.js'

const statsService = createStatsService({ statsRepository })

export const statsController = {
  async dashboard(req, res, next) {
    try {
      const stats = await statsService.getDashboardStats()
      res.json({ success: true, data: stats })
    } catch (err) {
      next(err)
    }
  },
}
