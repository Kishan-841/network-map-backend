import { describe, it, expect, vi } from 'vitest'
import { createBuildingService } from '../src/modules/buildings/building.service.js'

/**
 * Exporting the building list to a spreadsheet.
 *
 * The property that matters, exactly as for bulk go-live: the rows exported
 * are the rows the list would have shown for the same filter and the same
 * actor. An export that quietly widens the scope hands someone a file full of
 * buildings they cannot see on screen.
 */
const fakeUserRepo = (zones = []) => ({ assignedZoneIds: async () => zones })

const rows = [
  {
    id: 'b1',
    buildingName: 'Balaji Heights',
    formattedAddress: 'Baner Road, Pune',
    pincode: '411045',
    details: { homePass: 250 },
    zone: { name: 'Zone A' },
  },
  {
    id: 'b2',
    buildingName: 'Shanti Residency',
    formattedAddress: null,
    pincode: null,
    details: null,
    zone: null,
  },
]

const build = (zones = []) => {
  const buildingRepository = {
    list: vi.fn(async () => rows),
    count: vi.fn(async () => rows.length),
    updateMany: vi.fn(),
  }
  return {
    buildingRepository,
    service: createBuildingService({
      buildingRepository,
      storage: { keyFromUrl: () => null },
      userRepository: fakeUserRepo(zones),
    }),
  }
}

const ADMIN = { id: 'a1', role: 'ADMIN' }
const SURVEYOR = { id: 's1', role: 'SURVEYOR' }

describe('the exported rows', () => {
  it('carries exactly the five columns asked for, in order', async () => {
    const { service } = build()
    const out = await service.exportBuildings({}, ADMIN)
    expect(out.columns).toEqual(['Building name', 'Address', 'Pincode', 'Home pass', 'Zone'])
  })

  it('flattens the nested home pass and zone', async () => {
    const { service } = build()
    const { rows: out } = await service.exportBuildings({}, ADMIN)
    expect(out[0]).toEqual(['Balaji Heights', 'Baner Road, Pune', '411045', 250, 'Zone A'])
  })

  it('leaves a missing value blank rather than writing "null" into a cell', async () => {
    const { service } = build()
    const { rows: out } = await service.exportBuildings({}, ADMIN)
    expect(out[1]).toEqual(['Shanti Residency', '', '', '', ''])
  })

  it('keeps home pass a number, so the column can be summed', async () => {
    const { service } = build()
    const { rows: out } = await service.exportBuildings({}, ADMIN)
    expect(typeof out[0][3]).toBe('number')
  })

  it('keeps the pincode a string, so 0-leading codes survive', async () => {
    const { service } = build()
    const { rows: out } = await service.exportBuildings({}, ADMIN)
    expect(typeof out[0][2]).toBe('string')
  })
})

describe('what the export is allowed to see', () => {
  it('applies the same filter the list would', async () => {
    const { buildingRepository, service } = build()
    await service.exportBuildings({ zoneId: 'z1' }, ADMIN)
    expect(buildingRepository.list.mock.calls[0][0]).toMatchObject({
      source: 'COVERAGE',
      zoneId: 'z1',
    })
  })

  it('confines a surveyor to their own scope', async () => {
    const { buildingRepository, service } = build(['z1'])
    await service.exportBuildings({}, SURVEYOR)
    const where = buildingRepository.list.mock.calls[0][0]
    expect(where.AND).toEqual([{ OR: [{ zoneId: { in: ['z1'] } }, { createdById: 's1' }] }])
  })

  it('carries the search term through', async () => {
    const { buildingRepository, service } = build()
    await service.exportBuildings({ search: 'mall' }, ADMIN)
    expect(buildingRepository.list.mock.calls[0][0].OR).toBeTruthy()
  })

  it('is not capped at one page of results', async () => {
    const { buildingRepository, service } = build()
    await service.exportBuildings({ page: 1, pageSize: 20 }, ADMIN)
    // pageSize belongs to the screen, never to the file — exporting a filtered
    // view must not hand back only the rows that happened to be visible.
    expect(buildingRepository.list.mock.calls[0][1].take).toBeGreaterThan(20)
    expect(buildingRepository.list.mock.calls[0][1].skip).toBe(0)
  })
})

/**
 * Where a pincode comes from.
 *
 * `Building.pincode` is only set on ACQUISITION rows, so on the coverage
 * registry it is null for every building and the column would ship blank.
 * Google-formatted addresses end in the real code, and reading it off that
 * building's own address is recovery rather than invention.
 */
import { exportPincode } from '../src/modules/buildings/building.service.js'

describe('exportPincode', () => {
  it('prefers the stored field when there is one', () => {
    expect(exportPincode({ pincode: '411045', formattedAddress: 'Somewhere 411999' })).toBe('411045')
  })

  it('reads it off a Google-formatted address when the field is empty', () => {
    expect(
      exportPincode({
        pincode: null,
        formattedAddress: 'Westend Mall, Aundh, Pune, Maharashtra 411007',
      }),
    ).toBe('411007')
  })

  it('tolerates trailing country text after the code', () => {
    expect(
      exportPincode({ pincode: null, formattedAddress: 'Baner, Pune, Maharashtra 411045, India' }),
    ).toBe('411045')
  })

  it('is blank when the address is just a building name', () => {
    expect(exportPincode({ pincode: null, formattedAddress: 'BALAJI HIEGHTS' })).toBe('')
  })

  it('is blank when there is no address at all', () => {
    expect(exportPincode({ pincode: null, formattedAddress: null })).toBe('')
    expect(exportPincode({})).toBe('')
  })

  it('does not mistake a number from the middle of an address for a pincode', () => {
    // A plot or survey number early in the line is not the postcode.
    expect(
      exportPincode({ pincode: null, formattedAddress: 'Plot 411045, Baner Road, Pune' }),
    ).toBe('')
  })

  it('never returns a code starting with 0 — no Indian pincode does', () => {
    expect(exportPincode({ pincode: null, formattedAddress: 'Nowhere, 011045' })).toBe('')
  })
})
