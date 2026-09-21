import { z } from 'zod'

// What the survey sheet offers. Kept as plain strings rather than DB enums:
// the list is a purchasing decision, and a new rack size should be one edit
// here, not a migration.
export const RACK_SIZES = ['3U', '4U', '7U', '12U', '16U', '20U', '22U', '27U', '30U', '32U', '35U', '40U']
export const RACK_CONDITIONS = ['OK', 'DAMAGED']
// 0 counts: a UPS with no batteries left in it is a thing worth recording.
export const UPS_BATTERY_COUNTS = [0, 1, 2, 4]
export const FMS_PORT_COUNTS = [12, 24, 48, 96]
export const SWITCH_SPEEDS = ['1G', '10G']
export const OLT_TYPES = ['GPON', 'EPON']

// Good enough to catch a typo, not a validator masquerading as a firewall:
// IPv4, or a host:port / CIDR suffix people write on a sheet.
const ipAddress = z
  .string()
  .trim()
  .regex(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?(:\d{1,5})?$/, 'Must look like 10.0.0.1')
  .max(64)

const coord = { latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }

// zoneId is required here and optional in the partial below: every NEW POP
// must say where it sits, because who may see it follows its zone.
// The rest of the survey sheet. Every one of these is optional: a POP can be
// dropped on the map in the field and filled in properly later.
const popSheet = {
  serverLocation: z.string().trim().max(200).nullish(),
  rackSize: z.enum(RACK_SIZES).nullish(),
  rackCondition: z.enum(RACK_CONDITIONS).nullish(),
  upsBatteryCount: z
    .preprocess((v) => (v === '' || v === null ? undefined : v), z.number().int().nullish())
    .refine((v) => v == null || UPS_BATTERY_COUNTS.includes(v), 'Batteries must be 1, 2 or 4'),
  images: z.array(z.string()).max(20).nullish(),
}

/**
 * The lists a POP is saved with. A row carrying an `id` is one the client was
 * given back and wants kept; a row without one is new; anything omitted is
 * dropped. The whole rack therefore saves in the same request as the POP, and
 * a half-filled form cannot leave orphans behind.
 */
const model = z.string().trim().max(100).nullish()

const oltRow = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  ponPortCount: z.number().int().min(1).max(256),
  ipAddress: ipAddress.nullish(),
  type: z.enum(OLT_TYPES).nullish(),
  model,
})
const deviceRow = z
  .object({
    id: z.string().min(1).optional(),
    kind: z.enum(['SWITCH', 'MIKROTIK', 'FMS']),
    label: z.string().trim().max(100).nullish(),
    ipAddress: ipAddress.nullish(),
    portCount: z
      .preprocess((v) => (v === '' || v === null ? undefined : v), z.number().int().nullish())
      .refine((v) => v == null || FMS_PORT_COUNTS.includes(v), 'FMS ports must be 12, 24, 48 or 96'),
    speed: z.enum(SWITCH_SPEEDS).nullish(),
    model,
  })
  .superRefine((d, ctx) => deviceRules(d, ctx))

const popEquipment = {
  olts: z.array(oltRow).max(20).optional(),
  devices: z.array(deviceRow).max(50).optional(),
}

export const createPopSchema = z.object({
  name: z.string().trim().min(1).max(100),
  ...coord,
  zoneId: z.string().min(1),
  notes: z.string().trim().max(500).nullish(),
  ...popSheet,
  ...popEquipment,
})
export const updatePopSchema = createPopSchema.partial()

export const createOltSchema = z.object({
  name: z.string().trim().min(1).max(100),
  ponPortCount: z.number().int().min(1).max(256),
  ipAddress: ipAddress.nullish(),
  type: z.enum(OLT_TYPES).nullish(),
  model: z.string().trim().max(100).nullish(),
})

/**
 * A switch, a Mikrotik or an FMS. One shape with a kind rather than three
 * near-identical tables: what differs is which field is required, and that is
 * a rule, not a schema.
 */
const deviceFields = z.object({
  kind: z.enum(['SWITCH', 'MIKROTIK', 'FMS']),
  label: z.string().trim().max(100).nullish(),
  ipAddress: ipAddress.nullish(),
  speed: z.enum(SWITCH_SPEEDS).nullish(),
  model: z.string().trim().max(100).nullish(),
  portCount: z
    .preprocess((v) => (v === '' || v === null ? undefined : v), z.number().int().nullish())
    .refine((v) => v == null || FMS_PORT_COUNTS.includes(v), 'FMS ports must be 12, 24, 48 or 96'),
})

/**
 * A device is worth keeping if it carries anything at all — a name, an IP, a
 * model, a speed or a port count. None of those is individually required: a
 * switch known only by its model, or a Mikrotik with just a label, is real
 * kit worth recording, and dropping it silently is how a survey loses data.
 * Only a wholly empty row is refused, so a stray "Add switch" click cannot
 * create a blank device.
 */
export function deviceHasContent(d) {
  const filled = (v) => v != null && String(v).trim() !== ''
  return filled(d.label) || filled(d.ipAddress) || filled(d.model) || filled(d.speed) || d.portCount != null
}

function deviceRules(d, ctx) {
  if (!deviceHasContent(d)) {
    ctx.addIssue({
      code: 'custom',
      path: ['label'],
      message: 'Record at least a name, IP, model, speed or port count',
    })
  }
}


export const createPopDeviceSchema = deviceFields.superRefine(deviceRules)
// A PATCH is a fragment — the service re-checks the rules against the merged row.
export const updatePopDeviceSchema = deviceFields.partial()
export const updateOltSchema = createOltSchema.partial()
