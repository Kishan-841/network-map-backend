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
})
