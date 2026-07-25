import { env } from '../../config/env.js'
import { getStorageProvider } from '../../lib/storage/index.js'
import { createBuildingService } from './building.service.js'
import { buildingRepository } from './building.repository.js'

const buildingService = createBuildingService({
  buildingRepository,
  storage: getStorageProvider(),
})

export const buildingController = {
  async create(req, res, next) {
    try {
      const building = await buildingService.createBuilding(req.body, req.user.id)
      res.status(201).json({ success: true, data: building })
    } catch (err) {
      next(err)
    }
  },

  async list(req, res, next) {
    try {
      const buildings = await buildingService.listBuildings(req.validatedQuery ?? {})
      res.json({ success: true, data: buildings })
    } catch (err) {
      next(err)
    }
  },

  async nearby(req, res, next) {
    try {
      const { latitude, longitude, radius, name, placeId } = req.validatedQuery
      const buildings = await buildingService.findNearby({
        latitude,
        longitude,
        radiusMeters: radius ?? env.duplicateRadiusMeters,
        name,
        placeId,
      })
      res.json({ success: true, data: buildings })
    } catch (err) {
      next(err)
    }
  },

  async updateStatus(req, res, next) {
    try {
      const building = await buildingService.updateStatus(req.params.id, req.body)
      res.json({ success: true, data: building })
    } catch (err) {
      next(err)
    }
  },

  async addPhoto(req, res, next) {
    try {
      const photo = await buildingService.addPhoto(req.params.id, req.body, req.user)
      res.status(201).json({ success: true, data: photo })
    } catch (err) {
      next(err)
    }
  },

  async removePhoto(req, res, next) {
    try {
      await buildingService.removePhoto(req.params.id, req.params.photoId)
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  },

  async get(req, res, next) {
    try {
      const building = await buildingService.getBuilding(req.params.id)
      res.json({ success: true, data: building })
    } catch (err) {
      next(err)
    }
  },
}
