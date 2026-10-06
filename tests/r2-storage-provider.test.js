import { describe, it, expect } from 'vitest'
import { S3Client } from '@aws-sdk/client-s3'
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

// The presigner signs locally — no network — so a real client with dummy
// credentials is enough to check the URLs we hand out.
const signingClient = () =>
  new S3Client({ region: 'auto', endpoint: 'https://acc.r2.cloudflarestorage.com', credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' })

describe('r2 storage provider — app releases', () => {
  it('presigns a PUT for an exact key and content type', async () => {
    const provider = createR2StorageProvider({ client: signingClient(), bucket: 'docs', publicBaseUrl: PUBLIC })
    const url = await provider.uploadUrl({ key: 'app/partner-1.1.0.apk', contentType: 'application/vnd.android.package-archive' })
    expect(url).toContain('app/partner-1.1.0.apk')
    expect(url).toContain('X-Amz-Signature=')
    expect(url).toContain('X-Amz-Expires=900')
    const signed = decodeURIComponent(url).match(/X-Amz-SignedHeaders=([^&]*)/)[1]
    expect(signed).toContain('content-type')
  })

  it('presigned PUT carries no checksum params (a real upload would fail them)', async () => {
    const provider = createR2StorageProvider({ client: signingClient(), bucket: 'docs', publicBaseUrl: PUBLIC })
    const url = (await provider.uploadUrl({ key: 'app/x.apk', contentType: 'application/vnd.android.package-archive' })).toLowerCase()
    expect(url).not.toContain('x-amz-checksum')
    expect(url).not.toContain('x-amz-sdk-checksum-algorithm')
  })

  it('refuses a download filename with a quote or line break', async () => {
    const provider = createR2StorageProvider({ client: signingClient(), bucket: 'docs', publicBaseUrl: PUBLIC })
    await expect(provider.downloadUrl({ key: 'k', filename: 'a".apk' })).rejects.toThrow()
    await expect(provider.downloadUrl({ key: 'k', filename: 'a\nb.apk' })).rejects.toThrow()
  })

  it('exists() rethrows a non-404 error', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })
    const p = createR2StorageProvider({ client: { send: async () => { throw denied } }, bucket: 'docs', publicBaseUrl: PUBLIC })
    await expect(p.exists({ key: 'k' })).rejects.toBe(denied)
  })

  it('presigns a GET by key with a download filename', async () => {
    const provider = createR2StorageProvider({ client: signingClient(), bucket: 'docs', publicBaseUrl: PUBLIC })
    const url = await provider.downloadUrl({ key: 'app/partner-1.1.0.apk', filename: 'partner-1.1.0.apk' })
    expect(url).toContain('X-Amz-Expires=3600')
    expect(decodeURIComponent(url)).toContain('attachment; filename="partner-1.1.0.apk"')
  })

  it('reports whether an object exists', async () => {
    const yes = createR2StorageProvider({ client: { send: async () => ({}) }, bucket: 'docs', publicBaseUrl: PUBLIC })
    expect(await yes.exists({ key: 'app/x.apk' })).toBe(true)
    const missing = Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })
    const no = createR2StorageProvider({ client: { send: async () => { throw missing } }, bucket: 'docs', publicBaseUrl: PUBLIC })
    expect(await no.exists({ key: 'app/x.apk' })).toBe(false)
  })
})
