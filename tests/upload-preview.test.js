import { describe, it, expect, vi } from 'vitest'
import { createUploadController } from '../src/modules/uploads/upload.controller.js'

/**
 * An upload answers with TWO links: `url` — the permanent one a form saves —
 * and `previewUrl` — a short-lived signed link the page shows straight away.
 * With a private bucket the permanent link no longer opens on its own, so a
 * page that previewed `url` would show a broken image until it reloaded.
 */
const STORED = 'https://pub.example.r2.dev/2026/10/abc.jpg'
const storage = {
  save: vi.fn(async () => ({ url: STORED })),
  readUrl: vi.fn(async (u) => `${u}?X-Amz-Signature=sig`),
}
const res = () => {
  const r = { status: vi.fn(() => r), json: vi.fn(() => r) }
  return r
}
const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg' }

describe('POST /uploads answer', () => {
  it('returns the permanent url to save and a signed previewUrl to show', async () => {
    const r = res()
    await createUploadController({ storage }).upload({ file }, r, vi.fn())
    expect(r.status).toHaveBeenCalledWith(201)
    expect(r.json).toHaveBeenCalledWith({
      success: true,
      data: { url: STORED, previewUrl: `${STORED}?X-Amz-Signature=sig` },
    })
  })

  it('falls back to the url itself when storage cannot sign', async () => {
    const r = res()
    await createUploadController({ storage: { save: storage.save } }).upload({ file }, r, vi.fn())
    expect(r.json.mock.calls[0][0].data).toEqual({ url: STORED, previewUrl: STORED })
  })
})
