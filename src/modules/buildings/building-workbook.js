import ExcelJS from 'exceljs'

/**
 * Turn exported rows into a real .xlsx.
 *
 * A real workbook rather than a CSV renamed: Excel opens a CSV by guessing at
 * every column, which turns a pincode like 411045 into a number and a home
 * pass of 0250 into 250. Typed cells and a declared column width remove the
 * guessing.
 */
export async function buildingsWorkbook({ columns, rows }) {
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const sheet = wb.addWorksheet('Buildings')

  sheet.columns = columns.map((header) => ({
    header,
    // Address is the only column that runs long; the rest are short enough
    // that a single width reads tidily.
    width:
      header === 'Address'
        ? 46
        : header === 'Building name'
          ? 32
          : header === 'Zone' || header === 'Operator'
            ? 26
            : 14,
  }))

  sheet.getRow(1).font = { bold: true }
  // Freeze the header so it stays put on a registry of any size.
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of rows) sheet.addRow(row)

  // Right-align the one genuinely numeric column so it reads as a quantity.
  const homePass = columns.indexOf('Home pass') + 1
  if (homePass > 0) sheet.getColumn(homePass).alignment = { horizontal: 'right' }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  }

  return wb.xlsx.writeBuffer()
}

/** `buildings-2026-09-01.xlsx` — sortable, and says when it was taken. */
export const workbookFilename = (at = new Date()) =>
  `buildings-${at.toISOString().slice(0, 10)}.xlsx`
