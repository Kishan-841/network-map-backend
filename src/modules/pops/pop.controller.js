import { popService } from './pop.service.js'

export const popController = {
  async list(req, res, next) {
    try {
      res.json({ success: true, data: await popService.listPops(req.user) })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const pop = await popService.createPop(req.body, req.user)
      res.status(201).json({ success: true, data: pop })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      res.json({ success: true, data: await popService.updatePop(req.params.id, req.body, req.user) })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await popService.deletePop(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },

  async createOlt(req, res, next) {
    try {
      const olt = await popService.createOlt(req.params.id, req.body)
      res.status(201).json({ success: true, data: olt })
    } catch (err) {
      next(err)
    }
  },

  async updateOlt(req, res, next) {
    try {
      const olt = await popService.updateOlt(req.params.id, req.params.oltId, req.body)
      res.json({ success: true, data: olt })
    } catch (err) {
      next(err)
    }
  },

  async deleteOlt(req, res, next) {
    try {
      await popService.deleteOlt(req.params.id, req.params.oltId)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },
}
