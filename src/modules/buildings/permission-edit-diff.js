/**
 * What a details edit on a society (PERMISSION building) actually changes —
 * the `changes[]` its history row records. Pure: compares the stored row with
 * the PATCH body, field by field, treating "missing" and null alike so a form
 * that resends every field records only what the person really changed.
 *
 * Change keys (stable — the web labels them):
 *   name, address, location, zone, live, details, contact,
 *   status (permissionStatus; also reported as statusBefore → statusAfter),
 *   offer (societyOffer / paymentType / demoCount),
 *   permission (amountPaid, permissionDate, renewalDate, ownerName, ownerMobile),
 *   photos
 */

const norm = (v) => (v === undefined || v === '' ? null : v)
const same = (a, b) => norm(a) === norm(b)
const num = (v) => (v === null || v === undefined ? null : Number(v))
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null)

const BUILDING_FIELDS = [
  ['buildingName', 'name'],
  ['formattedAddress', 'address'],
  ['zoneId', 'zone'],
  ['isLive', 'live'],
]
const OFFER_FIELDS = ['societyOffer', 'paymentType', 'demoCount']
const PERMISSION_FIELDS = ['amountPaid', 'permissionDate', 'renewalDate', 'ownerName', 'ownerMobile']

function permissionValue(field, value) {
  if (field === 'amountPaid') return num(value)
  if (field === 'permissionDate' || field === 'renewalDate') return day(value)
  return norm(value)
}

export function diffPermissionEdit(existing, { building = {}, details, permission, contact, photos }) {
  const changes = new Set()

  for (const [field, key] of BUILDING_FIELDS) {
    if (building[field] !== undefined && !same(building[field], existing[field])) changes.add(key)
  }
  if (
    (building.latitude !== undefined && Number(building.latitude) !== existing.latitude) ||
    (building.longitude !== undefined && Number(building.longitude) !== existing.longitude)
  ) {
    changes.add('location')
  }

  if (details) {
    const had = existing.details ?? {}
    if (Object.entries(details).some(([field, value]) => !same(value, had[field]))) changes.add('details')
  }

  let statusBefore = null
  let statusAfter = null
  if (permission) {
    const had = existing.permission ?? {}
    if (
      permission.permissionStatus !== undefined &&
      !same(permission.permissionStatus, had.permissionStatus)
    ) {
      changes.add('status')
      statusBefore = norm(had.permissionStatus)
      statusAfter = norm(permission.permissionStatus)
    }
    if (OFFER_FIELDS.some((f) => permission[f] !== undefined && !same(permission[f], had[f]))) {
      changes.add('offer')
    }
    if (
      PERMISSION_FIELDS.some(
        (f) => permission[f] !== undefined && permissionValue(f, permission[f]) !== permissionValue(f, had[f]),
      )
    ) {
      changes.add('permission')
    }
  }

  if (contact) {
    const had = existing.contact
    const next = {
      contactName: contact.contactName,
      contactPhone: contact.contactPhone,
      contactEmail: contact.contactEmail,
      designation: contact.designation,
      designationOther: contact.designation === 'OTHER' ? contact.designationOther : null,
    }
    if (!had || Object.entries(next).some(([field, value]) => !same(value, had[field]))) {
      changes.add('contact')
    }
  }

  // Photos arrive as the full desired set (urls already canonical).
  let photoPlan = null
  if (photos) {
    const key = (p) => `${p.type}|${p.url}`
    const had = existing.photos ?? []
    const hadKeys = new Set(had.map(key))
    const nextKeys = new Set(photos.map(key))
    const add = photos.filter((p) => !hadKeys.has(key(p)))
    const removed = had.filter((p) => !nextKeys.has(key(p)))
    if (add.length || removed.length) {
      changes.add('photos')
      const letter = (list) => list.find((p) => p.type === 'PERMISSION_LETTER')?.url ?? null
      const letterBefore = letter(had)
      const letterAfter = letter(photos)
      photoPlan = {
        add,
        removeIds: removed.map((p) => p.id),
        // A file still referenced by a kept photo is not deleted from storage.
        removeUrls: removed.map((p) => p.url).filter((url) => !photos.some((p) => p.url === url)),
        ...(letterBefore !== letterAfter && { documentUrl: letterAfter }),
      }
    }
  }

  return { changes: [...changes], statusBefore, statusAfter, photoPlan }
}
