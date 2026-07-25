import { createBuildingTypeService } from './building-type.service.js'
import { buildingTypeRepository } from './building-type.repository.js'

const buildingTypeService = createBuildingTypeService({ buildingTypeRepository })

export const buildingTypeController = {
  async list(req, res, next) {
    try {
      const types = await buildingTypeRepository.list()
      res.json({ success: true, data: types })
    } catch (err) {
      next(err)
    }
  },

  async create(req, res, next) {
    try {
      const type = await buildingTypeService.createType(req.body)
      res.status(201).json({ success: true, data: type })
    } catch (err) {
      next(err)
    }
  },

  async rename(req, res, next) {
    try {
      const type = await buildingTypeService.renameType(req.params.id, req.body)
      res.json({ success: true, data: type })
    } catch (err) {
      next(err)
    }
  },

  async remove(req, res, next) {
    try {
      await buildingTypeService.deleteType(req.params.id)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },
}
