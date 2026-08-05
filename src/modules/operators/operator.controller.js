import { operatorService } from './operator.service.js'

export const operatorController = {
  async list(req, res, next) {
    try {
      const query = req.validatedQuery ?? {}
      const data = query.page
        ? await operatorService.listOperatorsPaged(query)
        : await operatorService.listOperators()
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const operator = await operatorService.createOperator(req.body)
      res.status(201).json({ success: true, data: operator })
    } catch (err) {
      next(err)
    }
  },

  async update(req, res, next) {
    try {
      const operator = await operatorService.updateOperator(req.params.id, req.body)
      res.json({ success: true, data: operator })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await operatorService.deleteOperator(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },

  async import(req, res, next) {
    try {
      const result = await operatorService.importOperatorMapping(req.body.rows)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
}
