import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { appReleaseRepository as repo } from '../src/modules/app-releases/app-release.repository.js'

const v = `0.${Date.now() % 100000}.1`
afterAll(() => prisma.appRelease.deleteMany({ where: { version: v } }))

describe('appReleaseRepository', () => {
  it('has every method the service uses', () => {
    for (const m of ['list', 'findByVersion', 'create', 'getSetting', 'setMinimum']) expect(typeof repo[m]).toBe('function')
  })
  it('creates and finds a release', async () => {
    await repo.create({ version: v, apkKey: `app/partner-${v}.apk`, notes: 'test', createdById: 'test-admin' })
    expect((await repo.findByVersion(v)).apkKey).toBe(`app/partner-${v}.apk`)
    expect((await repo.list()).some((r) => r.version === v)).toBe(true)
  })
  it('always has a setting row', async () => {
    const s = await repo.getSetting()
    expect(typeof s.minimumSupportedVersion).toBe('string')
  })
})
