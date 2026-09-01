import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildingsWorkbook, workbookFilename } from '../src/modules/buildings/building-workbook.js'

const COLUMNS = ['Building name', 'Address', 'Pincode', 'Home pass', 'Zone', 'Operator']

/** Read the produced file back, so these assert on a real workbook. */
const reopen = async (payload) => {
  const buffer = await buildingsWorkbook(payload)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  return wb.getWorksheet('Buildings')
}

describe('the workbook we hand back', () => {
  const payload = {
    columns: COLUMNS,
    rows: [
      ['Balaji Heights', 'Baner Road, Pune', '411045', 250, 'Zone A', 'Fiber Plus Broadband'],
      ['Shanti Residency', '', '', '', '', ''],
    ],
  }

  it('opens as a real spreadsheet with a Buildings sheet', async () => {
    expect(await reopen(payload)).toBeTruthy()
  })

  it('writes the headers in the order asked for', async () => {
    const sheet = await reopen(payload)
    expect(sheet.getRow(1).values.slice(1)).toEqual(COLUMNS)
  })

  it('writes every row', async () => {
    const sheet = await reopen(payload)
    expect(sheet.rowCount).toBe(3) // header + two buildings
  })

  it('keeps a pincode as text, so a leading zero would survive', async () => {
    const sheet = await reopen({ columns: COLUMNS, rows: [['X', '', '011045', 1, 'Z', 'Op']] })
    expect(sheet.getRow(2).getCell(3).value).toBe('011045')
  })

  it('keeps home pass numeric, so the column sums', async () => {
    const sheet = await reopen(payload)
    expect(sheet.getRow(2).getCell(4).value).toBe(250)
  })

  it('leaves a missing cell empty rather than writing "null"', async () => {
    const sheet = await reopen(payload)
    const blank = sheet.getRow(3).getCell(2).value
    expect(blank == null || blank === '').toBe(true)
  })

  it('bolds and freezes the header, so a long list stays readable', async () => {
    const sheet = await reopen(payload)
    expect(sheet.getRow(1).font?.bold).toBe(true)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
  })

  it('produces a file even when nothing matched the filter', async () => {
    const sheet = await reopen({ columns: COLUMNS, rows: [] })
    expect(sheet.rowCount).toBe(1)
    expect(sheet.getRow(1).values.slice(1)).toEqual(COLUMNS)
  })
})

describe('the filename', () => {
  it('is dated, so files sort and say when they were taken', () => {
    expect(workbookFilename(new Date('2026-09-01T10:00:00Z'))).toBe('buildings-2026-09-01.xlsx')
  })
})

/**
 * The download headers have to survive the trip to a browser.
 *
 * The API and the web app are on different origins, and a browser hides every
 * response header from JS except a short safe list — so without an explicit
 * expose list the file arrives with no name and no row count. Asserted
 * against the real app so a future CORS edit cannot quietly drop it.
 */
describe('CORS exposes what a download needs', () => {
  it('names Content-Disposition and the export counters', async () => {
    const { createApp } = await import('../src/app.js')
    const request = (await import('supertest')).default
    const res = await request(createApp())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000')
    const exposed = (res.headers['access-control-expose-headers'] ?? '').toLowerCase()
    for (const header of ['content-disposition', 'x-export-rows', 'x-export-truncated']) {
      expect(exposed, header).toContain(header)
    }
  })
})
