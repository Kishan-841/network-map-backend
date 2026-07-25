import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createLocalStorageProvider } from '../src/lib/storage/local-storage-provider.js'

const TEST_ROOT = path.join(import.meta.dirname, 'tmp-uploads')

describe('local storage provider', () => {
  beforeEach(() => rm(TEST_ROOT, { recursive: true, force: true }))
  afterEach(() => rm(TEST_ROOT, { recursive: true, force: true }))

  it('saves a buffer and returns a key and public url', async () => {
    const provider = createLocalStorageProvider({
      rootDir: TEST_ROOT,
      baseUrl: 'http://localhost:4000/uploads',
    })
    const { key, url } = await provider.save({
      buffer: Buffer.from('hello'),
      extension: 'jpg',
    })

    expect(key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/)
    expect(url).toBe(`http://localhost:4000/uploads/${key}`)
    const written = await readFile(path.join(TEST_ROOT, key), 'utf8')
    expect(written).toBe('hello')
  })

  it('deletes a stored file by key and tolerates missing files', async () => {
    const provider = createLocalStorageProvider({
      rootDir: TEST_ROOT,
      baseUrl: 'http://localhost:4000/uploads',
    })
    const { key } = await provider.save({ buffer: Buffer.from('bye'), extension: 'png' })
    await provider.delete({ key })
    await expect(readFile(path.join(TEST_ROOT, key))).rejects.toThrow()
    await expect(provider.delete({ key })).resolves.toBeUndefined() // second delete is a no-op
  })

  it('maps a public url back to its storage key', () => {
    const provider = createLocalStorageProvider({
      rootDir: TEST_ROOT,
      baseUrl: 'http://localhost:4000/uploads',
    })
    expect(provider.keyFromUrl('http://localhost:4000/uploads/2026/07/abc.jpg')).toBe(
      '2026/07/abc.jpg',
    )
    expect(provider.keyFromUrl('https://elsewhere.com/x.jpg')).toBeNull()
  })

  it('rejects traversal keys in keyFromUrl and delete', async () => {
    const provider = createLocalStorageProvider({
      rootDir: TEST_ROOT,
      baseUrl: 'http://localhost:4000/uploads',
    })
    expect(provider.keyFromUrl('http://localhost:4000/uploads/../../.env')).toBeNull()
    expect(provider.keyFromUrl('http://localhost:4000/uploads//etc/passwd')).toBeNull()

    // delete must refuse to act outside rootDir even when handed a raw key
    const { writeFile: wf, mkdir: mk } = await import('node:fs/promises')
    await mk(TEST_ROOT, { recursive: true })
    await wf(path.join(TEST_ROOT, '..', 'escape-canary.txt'), 'safe')
    await provider.delete({ key: '../escape-canary.txt' })
    await expect(
      readFile(path.join(TEST_ROOT, '..', 'escape-canary.txt'), 'utf8'),
    ).resolves.toBe('safe')
    await rm(path.join(TEST_ROOT, '..', 'escape-canary.txt'), { force: true })
  })
})
