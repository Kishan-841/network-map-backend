import { z } from 'zod'

export const updateStatusSchema = z
  .object({
    feasibleStatus: z
      .enum(['FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING'])
      .optional(),
    surveyStatus: z.enum(['PENDING', 'COMPLETED']).optional(),
    isLive: z.boolean().optional(),
  })
  .refine((data) => data.feasibleStatus || data.surveyStatus || data.isLive !== undefined, {
    message: 'Provide at least one field to update',
  })

export const addPhotoSchema = z.object({
  type: z.enum(['ENTRANCE', 'PERMISSION_LETTER', 'ADDITIONAL']),
  url: z.string().min(1).max(500),
})

export const bulkBuildingsSchema = z.object({
  rows: z
    .array(
      z.object({
        buildingName: z.string().trim().min(1).max(150),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        zone: z.string().trim().min(1).max(100),
        operator: z.string().trim().max(100).nullish(),
        homePass: z.number().int().min(0).nullish(),
        remark: z.string().trim().max(500).nullish(),
      }),
    )
    .min(1)
    .max(500),
})

export const listQuerySchema = z.object({
  zoneId: z.string().optional(),
  operatorId: z.string().optional(),
  cityId: z.string().optional(),
  status: z.enum(['FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING']).optional(),
  createdById: z.string().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  search: z.string().max(200).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().int().positive().max(50000).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(500).optional(),
})

// Admin/Manager edit — location (lat/lng/placeId) is immutable and the
// permission documentUrl belongs to the photo manager, so neither appears here.
export const updateBuildingSchema = z
  .object({
    buildingName: z.string().trim().min(1).max(200),
    formattedAddress: z.string().trim().min(1).max(500),
    zoneId: z.string().min(1),
    isLive: z.boolean(),
    details: z
      .object({
        wings: z.number().int().positive().nullable(),
        floors: z.number().int().positive().nullable(),
        homePass: z.number().int().nonnegative().nullable(),
        buildingType: z.string().max(50).nullable(),
        remarks: z.string().max(1000).nullable(),
      })
      .partial(),
    permission: z
      .object({
        amountPaid: z.number().nonnegative().nullable(),
        permissionStatus: z.string().max(50).nullable(),
        permissionDate: z.string().date().nullable(),
        renewalDate: z.string().date().nullable(),
        ownerName: z.string().max(100).nullable(),
        ownerMobile: z.string().max(20).nullable(),
      })
      .partial(),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  })

export const nearbyQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().positive().max(5000).optional(),
  name: z.string().optional(),
  placeId: z.string().optional(),
})

export const createBuildingSchema = z.object({
  placeId: z.string().min(1).nullish(),
  buildingName: z.string().min(1).max(200),
  formattedAddress: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  zoneId: z.string().min(1),
  isLive: z.boolean().optional(), // fiber connection already live?
  details: z
    .object({
      wings: z.number().int().positive().optional(),
      floors: z.number().int().positive().optional(),
      homePass: z.number().int().nonnegative().optional(),
      buildingType: z.string().max(50).optional(),
      remarks: z.string().max(1000).optional(),
    })
    .optional(),
  permission: z
    .object({
      amountPaid: z.number().nonnegative().optional(),
      documentUrl: z.string().max(500).optional(),
    })
    .optional(),
  photos: z
    .array(
      z.object({
        type: z.enum(['ENTRANCE', 'PERMISSION_LETTER', 'ADDITIONAL']),
        url: z.string().min(1).max(500),
      }),
    )
    .max(20)
    .refine(
      (photos) =>
        ['ENTRANCE', 'PERMISSION_LETTER'].every(
          (type) => photos.filter((photo) => photo.type === type).length <= 1,
        ),
      { message: 'Only one entrance photo and one permission letter per building' },
    )
    .optional(),
})
