import { describe, it, expect } from 'vitest'
import { createR2StorageProvider } from '../src/lib/storage/r2-storage-provider.js'

const PUBLIC = 'https://cdn.example.com'

function fakeClient() {
  const commands = []
  return { commands, send: async (command) => void commands.push(command) }
}

describe('r2 storage provider', () => {
  it('uploads with the right key/content-type and returns the public url', async () => {
    const client = fakeClient()
    const provider = createR2StorageProvider({ client, bucket: 'docs', publicBaseUrl: PUBLIC })

    const { key, url } = await provider.save({
      buffer: Buffer.from('hello'),
      extension: 'jpg',
      contentType: 'image/jpeg',
    })

    expect(key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/)
    expect(url).toBe(`${PUBLIC}/${key}`)
    expect(client.commands[0].input).toMatchObject({
      Bucket: 'docs',
      Key: key,
      ContentType: 'image/jpeg',
    })
    expect(Buffer.isBuffer(client.commands[0].input.Body)).toBe(true)
  })

  it('deletes an object by key', async () => {
    const client = fakeClient()
    const provider = createR2StorageProvider({ client, bucket: 'docs', publicBaseUrl: PUBLIC })
    await provider.delete({ key: '2026/07/abc.jpg' })
    expect(client.commands[0].input).toMatchObject({ Bucket: 'docs', Key: '2026/07/abc.jpg' })
  })

  it('maps our public urls to keys and rejects foreign/traversal urls', () => {
    const provider = createR2StorageProvider({
      client: fakeClient(),
      bucket: 'docs',
      publicBaseUrl: PUBLIC,
    })
    expect(provider.keyFromUrl(`${PUBLIC}/2026/07/a.jpg`)).toBe('2026/07/a.jpg')
    expect(provider.keyFromUrl('https://evil.example/x.jpg')).toBeNull()
    expect(provider.keyFromUrl(`${PUBLIC}/../secret`)).toBeNull()
  })

  // readUrl() signs against the S3 API host, not PUBLIC. A client that edits a
  // record posts back what we served it, so both forms must resolve.
  it('accepts its own presigned read urls and canonicalises them back', () => {
    const provider = createR2StorageProvider({
      client: fakeClient(),
      bucket: 'docs',
      publicBaseUrl: PUBLIC,
    })
    const signed =
      'https://docs.abc123.r2.cloudflarestorage.com/2026/07/a.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef'
    const pathStyle = 'https://abc123.r2.cloudflarestorage.com/docs/2026/07/a.jpg?X-Amz-Signature=x'

    expect(provider.keyFromUrl(signed)).toBe('2026/07/a.jpg')
    expect(provider.keyFromUrl(pathStyle)).toBe('2026/07/a.jpg')
    expect(provider.canonicalUrl(signed)).toBe(`${PUBLIC}/2026/07/a.jpg`)
    expect(provider.canonicalUrl(pathStyle)).toBe(`${PUBLIC}/2026/07/a.jpg`)
  })

  it('still rejects another bucket, another host and traversal in a signed url', () => {
    const provider = createR2StorageProvider({
      client: fakeClient(),
      bucket: 'docs',
      publicBaseUrl: PUBLIC,
    })
    expect(provider.keyFromUrl('https://other.abc123.r2.cloudflarestorage.com/2026/07/a.jpg')).toBeNull()
    expect(provider.keyFromUrl('https://abc123.r2.cloudflarestorage.com/other/2026/07/a.jpg')).toBeNull()
    expect(provider.keyFromUrl('https://docs.abc123.evil.com/2026/07/a.jpg')).toBeNull()
    // Dot segments, encoded or not, are normalised away by URL parsing, so a
    // signed url can only ever name an object inside our own bucket.
    expect(provider.keyFromUrl('https://docs.abc123.r2.cloudflarestorage.com/../secret')).toBe('secret')
    expect(provider.keyFromUrl('https://docs.abc123.r2.cloudflarestorage.com/%2E%2E/secret')).toBe('secret')
  })
})
