/**
 * Society permissions, phase 3 — the material catalogue a surveyor requests
 * from for a society connection. Keys are a stable API: they are stored in
 * SocietySurvey.materials and mirrored on the web. Add new keys at will;
 * never rename or remove one that may already be stored.
 * See .superpowers/sdd/2026-10-08-society-survey/design.md.
 *
 * unit: 'm' (metres) | 'count'
 */
const item = (group, unit) => (key, label) => ({ key, label, unit, group })
const fiber = item('Fiber', 'm')
const pvcPipe = item('PVC pipe', 'm')
const flexPipe = item('Flexible pipe', 'm')
const pvcDuct = item('PVC duct', 'm')
const fitting = item('Fittings', 'count')
const closure = item('Closures', 'count')
const steelTube = item('Steel tube', 'count')
const cassette = item('Cassette', 'count')
const patchCord = item('Patch cord', 'count')

export const SOCIETY_MATERIALS = Object.freeze([
  fiber('FIBER_4F', '4F'),
  fiber('FIBER_6F', '6F'),
  fiber('FIBER_12F', '12F'),
  fiber('FIBER_24F', '24F'),
  fiber('FIBER_48F', '48F'),
  pvcPipe('PVC_PIPE_40', '40 mm'),
  pvcPipe('PVC_PIPE_25', '25 mm'),
  flexPipe('FLEX_PIPE_40', '40 mm'),
  flexPipe('FLEX_PIPE_25', '25 mm'),
  pvcDuct('PVC_DUCT_40', '40 mm'),
  fitting('FOUR_WAY', '4-way'),
  fitting('SIDE_L', 'Side L'),
  fitting('SCREW_BOX', 'Screw box'),
  fitting('RAWL_PLUG', 'Rawl plug'),
  fitting('FAT_BOX', 'FAT box'),
  fitting('FDC', 'FDC'),
  closure('CLOSURE_TIFFIN', 'Tiffin'),
  closure('CLOSURE_JUMBO_4WAY', 'Jumbo 4-way'),
  steelTube('STEEL_TUBE_1X2', '1×2'),
  steelTube('STEEL_TUBE_1X4', '1×4'),
  steelTube('STEEL_TUBE_1X6', '1×6'),
  steelTube('STEEL_TUBE_1X8', '1×8'),
  steelTube('STEEL_TUBE_1X16', '1×16'),
  cassette('CASSETTE_1X2', '1×2'),
  cassette('CASSETTE_1X4', '1×4'),
  cassette('CASSETTE_1X6', '1×6'),
  cassette('CASSETTE_1X8', '1×8'),
  cassette('CASSETTE_1X16', '1×16'),
  patchCord('PATCH_LC_LC', 'LC–LC'),
  patchCord('PATCH_SC_SC', 'SC–SC'),
  patchCord('PATCH_LC_SC', 'LC–SC'),
])

export const MATERIAL_KEYS = Object.freeze(SOCIETY_MATERIALS.map((m) => m.key))

export const MAX_MATERIAL_QTY = 100000

/** The survey's lifecycle. */
export const SURVEY_STATUSES = Object.freeze(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'])

/** How one wing is cabled to another. */
export const LINK_METHODS = Object.freeze(['AERIAL', 'UNDERGROUND', 'TRAY'])

export const MAX_WINGS = 26
export const MAX_LINKS = 50
