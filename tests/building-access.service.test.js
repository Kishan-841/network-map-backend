import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

/**
 * The read/write boundary between the coverage team and the acquisition team.
 *
 * Each of these locks in a hole that was open in production: /nearby handed
 * leads full coverage records, and the photo routes let any acquisition user
 * write to — and delete files from — buildings they cannot even open.
 */

const COVERAGE = {
  id: 'cov1',
  buildingName: 'Coverage Tower',
  formattedAddress: '12 Coverage Road',
  latitude: 18.5311,
  longitude: 73.8611,
  zoneId: 'z1',
  source: 'COVERAGE',
  createdById: 'surveyor-1',
}
const ACQ = {
  id: 'acq1',
  buildingName: 'Acquisition House',
  formattedAddress: '9 Agent Lane',
  latitude: 18.5312,
  longitude: 73.8612,
  zoneId: null,
  source: 'ACQUISITION',
  createdById: 'agent-1',
}

const ADMIN = { id: 'admin', role: 'ADMIN' }
const LEAD = { id: 'lead-1', role: 'ACQUISITION_LEAD' }
const AGENT = { id: 'agent-1', role: 'ACQUISITION_AGENT' }
const OTHER_AGENT = { id: 'agent-2', role: 'ACQUISITION_AGENT' }
const SURVEYOR = { id: 'surveyor-1', role: 'SURVEYOR' }
const OTHER_SURVEYOR = { id: 'surveyor-2', role: 'SURVEYOR' }

const fakeUserRepo = (zones = []) => ({
  assignedZoneIds: async () => zones,
  assignedPincodes: async () => [],
})

function fakeRepo(buildings = [COVERAGE, ACQ], photo = null) {
  return {
    findById: vi.fn(async (id) => buildings.find((b) => b.id === id) ?? null),
    findWithinBounds: async () => buildings,
    findByPlaceId: async () => null,
    findPhotoById: async () => photo,
    deletePhoto: vi.fn(async () => {}),
    createPhoto: vi.fn(async (data) => ({ id: 'p1', ...data })),
    clearPermissionDocument: vi.fn(async () => {}),
    upsertPermissionDocument: vi.fn(async () => {}),
    create: vi.fn(async (data) => ({ id: 'new', ...data })),
  }
}

const fakeStorage = () => ({
  delete: vi.fn(async () => {}),
  keyFromUrl: (url) => (url?.includes('/uploads/') ? url.split('/uploads/')[1] : null),
})

const build = ({ buildings, photo, zones = [] } = {}) =>
  createBuildingService({
    buildingRepository: fakeRepo(buildings, photo),
    storage: fakeStorage(),
    userRepository: fakeUserRepo(zones),
  })

describe('getBuilding read scope', () => {
  it('hides coverage buildings from an acquisition lead', async () => {
    await expect(build().getBuilding('cov1', LEAD)).rejects.toMatchObject({ status: 404 })
  })

  it('hides another agent’s building from an acquisition agent', async () => {
    await expect(build().getBuilding('acq1', OTHER_AGENT)).rejects.toMatchObject({ status: 404 })
  })

  it('hides an out-of-zone building from a surveyor', async () => {
    await expect(
      build({ zones: ['z-other'] }).getBuilding('cov1', OTHER_SURVEYOR),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('lets a surveyor open a building in an assigned zone', async () => {
    const found = await build({ zones: ['z1'] }).getBuilding('cov1', OTHER_SURVEYOR)
    expect(found.id).toBe('cov1')
  })

  it('fails closed when there is no actor', async () => {
    await expect(build().getBuilding('cov1', undefined)).rejects.toMatchObject({ status: 404 })
  })
})

describe('findNearby masking', () => {
  const query = { latitude: 18.5311, longitude: 73.8611, radiusMeters: 500 }

  it('masks coverage buildings for an acquisition lead', async () => {
    const results = await build().findNearby(query, LEAD)
    const cov = results.find((b) => b.id === 'cov1')
    expect(cov.masked).toBe(true)
    expect(cov.buildingName).toBeNull()
    expect(cov.formattedAddress).toBeNull()
    // Coordinates must not survive the mask — a grid of queries would otherwise
    // rebuild the registry.
    expect(cov.latitude).toBeUndefined()
    expect(cov.longitude).toBeUndefined()
  })

  it('leaves the lead’s own acquisition buildings readable', async () => {
    const acq = (await build().findNearby(query, LEAD)).find((b) => b.id === 'acq1')
    expect(acq.masked).toBeUndefined()
    expect(acq.buildingName).toBe('Acquisition House')
  })

  it('masks other agents’ buildings for an agent', async () => {
    const results = await build().findNearby(query, OTHER_AGENT)
    expect(results.every((b) => b.masked)).toBe(true)
  })

  it('returns everything unmasked to an admin', async () => {
    const results = await build().findNearby(query, ADMIN)
    expect(results.every((b) => !b.masked)).toBe(true)
    expect(results.map((b) => b.buildingName).sort()).toEqual([
      'Acquisition House',
      'Coverage Tower',
    ])
  })

  it('still reports duplicate signals on masked rows', async () => {
    const results = await build().findNearby(
      { ...query, name: 'Coverage Tower' },
      OTHER_AGENT,
    )
    const cov = results.find((b) => b.id === 'cov1')
    expect(cov.masked).toBe(true)
    expect(cov.similarName).toBe(true)
  })
})

describe('photo writes stay inside the boundary', () => {
  const photo = { id: 'p9', buildingId: 'cov1', type: 'ENTRANCE', url: 'http://x/uploads/a.jpg' }

  it('refuses to delete a coverage photo for an acquisition agent', async () => {
    const service = build({ photo })
    await expect(service.removePhoto('cov1', 'p9', AGENT)).rejects.toMatchObject({ status: 403 })
  })

  it('refuses to delete a photo for an agent who did not log the building', async () => {
    const acqPhoto = { ...photo, buildingId: 'acq1' }
    await expect(
      build({ photo: acqPhoto }).removePhoto('acq1', 'p9', OTHER_AGENT),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('lets the agent who logged the building delete its photo', async () => {
    const acqPhoto = { ...photo, buildingId: 'acq1' }
    const service = build({ photo: acqPhoto })
    await expect(service.removePhoto('acq1', 'p9', AGENT)).resolves.toBeUndefined()
  })

  it('refuses to attach a photo to a building the agent cannot read', async () => {
    await expect(
      build().addPhoto('cov1', { type: 'ADDITIONAL', url: '/uploads/x.jpg' }, AGENT),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('keeps a surveyor off another surveyor’s building, even in their zone', async () => {
    await expect(
      build({ zones: ['z1'] }).addPhoto(
        'cov1',
        { type: 'ADDITIONAL', url: '/uploads/x.jpg' },
        OTHER_SURVEYOR,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('fails closed when there is no actor', async () => {
    await expect(
      build().addPhoto('cov1', { type: 'ADDITIONAL', url: '/uploads/x.jpg' }, undefined),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('coverage registry writes', () => {
  it('refuses to let an acquisition lead create a coverage building', async () => {
    await expect(
      build().createBuilding(
        { buildingName: 'Sneaky', formattedAddress: 'x', latitude: 1, longitude: 1, zoneId: 'z1' },
        LEAD.id,
        LEAD,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('still lets a surveyor create in an assigned zone', async () => {
    const service = build({ zones: ['z1'] })
    const created = await service.createBuilding(
      { buildingName: 'Fine', formattedAddress: 'x', latitude: 1, longitude: 1, zoneId: 'z1' },
      SURVEYOR.id,
      SURVEYOR,
    )
    expect(created.buildingName).toBe('Fine')
  })
})

describe('stored URLs never leave as public links', () => {
  const signingStorage = () => ({
    delete: vi.fn(async () => {}),
    keyFromUrl: (url) => (url?.includes('/uploads/') ? url.split('/uploads/')[1].split('?')[0] : null),
    canonicalUrl: (url) =>
      url?.includes('/uploads/') ? `http://cdn/uploads/${url.split('/uploads/')[1].split('?')[0]}` : url,
    readUrl: async (url) => `${url}?X-Amz-Signature=abc`,
  })

  const serviceWith = (buildings) =>
    createBuildingService({
      buildingRepository: fakeRepo(buildings),
      storage: signingStorage(),
      userRepository: fakeUserRepo(),
    })

  it('signs photo urls when a building is opened', async () => {
    const withPhotos = {
      ...COVERAGE,
      photos: [{ id: 'p1', url: 'http://cdn/uploads/a.jpg' }],
      permission: { documentUrl: 'http://cdn/uploads/l.pdf' },
    }
    const found = await serviceWith([withPhotos]).getBuilding('cov1', ADMIN)
    expect(found.photos[0].url).toBe('http://cdn/uploads/a.jpg?X-Amz-Signature=abc')
    expect(found.permission.documentUrl).toBe('http://cdn/uploads/l.pdf?X-Amz-Signature=abc')
  })

  it('stores the canonical url even when a signed one is posted back', async () => {
    const repo = fakeRepo([COVERAGE])
    const service = createBuildingService({
      buildingRepository: repo,
      storage: signingStorage(),
      userRepository: fakeUserRepo(),
    })
    await service.addPhoto(
      'cov1',
      { type: 'ADDITIONAL', url: 'http://cdn/uploads/b.jpg?X-Amz-Signature=stale' },
      ADMIN,
    )
    // What lands in the database must not carry an expiring signature.
    expect(repo.createPhoto).toHaveBeenCalledWith({
      buildingId: 'cov1',
      type: 'ADDITIONAL',
      url: 'http://cdn/uploads/b.jpg',
    })
  })

  it('leaves list rows alone — they carry no photos', async () => {
    const results = await serviceWith([COVERAGE]).findNearby(
      { latitude: 18.5311, longitude: 73.8611, radiusMeters: 500 },
      ADMIN,
    )
    expect(results[0].photos).toBeUndefined()
  })
})
