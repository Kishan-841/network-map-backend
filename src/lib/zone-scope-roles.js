/**
 * Roles whose building reads are "my zones, plus what I added myself"
 * (spec 2026-08-14 for surveyors; 2026-10-10-zone-manager for managers).
 * A reader with no zones therefore sees only their own rows — never everything.
 */
export const ZONE_SCOPED_READERS = ['SURVEYOR', 'MANAGER']
export const readsByZone = (role) => ZONE_SCOPED_READERS.includes(role)
