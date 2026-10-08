import { z } from 'zod'
import { HOME_PASS_TIERS } from '../../lib/home-pass-tier.js'

// UNRATED is a filterable state too — "nobody has measured this yet" is a
// worklist, not an absence.
const tierSchema = z.enum([...HOME_PASS_TIERS.map((t) => t.key), 'UNRATED'])

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

export const PHOTO_TYPES = [
  'ENTRANCE',
  'PERMISSION_LETTER',
  'ADDITIONAL',
  'SELFIE',
  'CONTACT_PERSON',
]

// Society-permission capture (Permission Executive). Values validated here, no
// DB enums (a new value is a code edit, like closure kinds / fiber types).
export const PERMISSION_STATUSES = ['ACCEPTED', 'FOLLOW_UP', 'DENIED']
export const SOCIETY_OFFERS = ['PAYMENT', 'DEMO']
export const PAYMENT_TYPES = ['ONE_TIME', 'RECURRING']

/**
 * The note a Permission Executive (or an admin) writes with every change to a
 * society: the first add, a visit update, a details edit. Optional in the
 * schemas — the service demands it where it applies, with a message that says
 * so rather than the generic validation error.
 */
export const remarkSchema = z.string().trim().max(1000)

export const addPhotoSchema = z.object({
  type: z.enum(PHOTO_TYPES),
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

/**
 * Bulk go-live. Either an explicit list of ids, or the SAME filter shape the
 * list uses — the filter form is what makes "select all 800 in Zone A" work
 * without the client ever holding 800 rows.
 */
export const bulkStatusSchema = z
  .object({
    isLive: z.boolean(),
    ids: z.array(z.string().min(1)).min(1).max(1000).optional(),
    filter: z
      .object({
        source: z.enum(['COVERAGE', 'ACQUISITION', 'PERMISSION']).optional(), // PERMISSION = approved societies
        pincode: z.string().optional(),
        zoneId: z.string().optional(),
        operatorId: z.string().optional(),
        cityId: z.string().optional(),
        status: z.enum(['FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING']).optional(),
        createdById: z.string().optional(),
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
        search: z.string().max(200).optional(),
        tier: tierSchema.optional(),
      })
      .optional(),
  })
  .refine((data) => Boolean(data.ids) !== Boolean(data.filter), {
    message: 'Provide either ids or a filter, not both',
  })

// Bulk delete acts on the ticked rows only — never a whole filter, because a
// delete cannot be undone. ADMIN-only at the route.
export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
})

// Map the ticked buildings to one OLT + one or more PON ports. ids only (no
// filter). The zone rules and the PON range are validated in the service
// against the OLT. A legacy singular `ponPort` (old frontend, deploy window)
// folds into `ponPorts`.
export const bulkOltSchema = z.preprocess(
  (v) => {
    if (v && typeof v === 'object' && v.ponPorts === undefined && v.ponPort != null) {
      const { ponPort, ...rest } = v
      return { ...rest, ponPorts: [ponPort] }
    }
    return v
  },
  z.object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    oltId: z.string().min(1),
    ponPorts: z.array(z.number().int().min(1)).min(1),
  }),
)

export const listQuerySchema = z.object({
  source: z.enum(['COVERAGE', 'ACQUISITION', 'PERMISSION']).optional(), // PERMISSION = approved societies
  pincode: z.string().optional(),
  zoneId: z.string().optional(),
  operatorId: z.string().optional(),
  cityId: z.string().optional(),
  status: z.enum(['FEASIBLE', 'PERMISSION_PENDING', 'REJECTED', 'SURVEY_PENDING']).optional(),
  createdById: z.string().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  search: z.string().max(200).optional(),
  tier: tierSchema.optional(),
  // Live / not-live filter. Query strings are text, so accept 'true'/'false'
  // (or real booleans, for the service tests) and normalise to a boolean.
  isLive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().int().positive().max(50000).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(500).optional(),
})

// A building's photo set: one entrance photo and one permission letter at most.
const photosSchema = z
  .array(
    z.object({
      type: z.enum(PHOTO_TYPES),
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

// Admin/Manager edit — location (lat/lng/placeId) is immutable and the
// permission documentUrl belongs to the photo manager, so neither appears here.
// `contact`, `photos` (the full desired set) and `remark` apply only to a
// PERMISSION building (society permissions) — the service refuses them elsewhere.
export const updateBuildingSchema = z
  .object({
    buildingName: z.string().trim().min(1).max(200),
    formattedAddress: z.string().trim().min(1).max(500),
    zoneId: z.string().min(1),
    isLive: z.boolean(),
    // The map pin can be nudged to the correct spot from the edit form.
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
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
        societyOffer: z.enum(SOCIETY_OFFERS).nullable(),
        paymentType: z.enum(PAYMENT_TYPES).nullable(),
        demoCount: z.number().int().nonnegative().nullable(),
      })
      .partial(),
    contact: z.lazy(() => contactSchema),
    photos: photosSchema,
    remark: remarkSchema,
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

export const DESIGNATIONS = [
  'CHAIRMAN',
  'SECRETARY',
  'MANAGER',
  'OWNER',
  'TREASURER',
  'COMMITTEE_MEMBER',
  'WATCHMAN',
  'OTHER',
]

export const contactSchema = z
  .object({
    contactName: z.string().trim().min(1).max(120),
    contactPhone: z.string().trim().min(6).max(20),
    contactEmail: z.string().trim().email().max(150).nullish(),
    designation: z.enum(DESIGNATIONS),
    designationOther: z.string().trim().max(100).nullish(),
  })
  .refine((c) => c.designation !== 'OTHER' || Boolean(c.designationOther?.trim()), {
    message: 'Describe the designation when choosing Other',
    path: ['designationOther'],
  })

export const createBuildingSchema = z.object({
  placeId: z.string().min(1).nullish(),
  buildingName: z.string().min(1).max(200),
  formattedAddress: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  // Coverage buildings carry a zone; acquisition buildings carry a pincode.
  zoneId: z.string().min(1).nullish(),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/).nullish(),
  contact: contactSchema.nullish(),
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
      permissionStatus: z.enum(PERMISSION_STATUSES).optional(),
      societyOffer: z.enum(SOCIETY_OFFERS).optional(),
      paymentType: z.enum(PAYMENT_TYPES).optional(),
      demoCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
  photos: photosSchema.optional(),
  // Compulsory for a Permission Executive (the first visit's note); ignored
  // for every other role.
  remark: remarkSchema.optional(),
})
