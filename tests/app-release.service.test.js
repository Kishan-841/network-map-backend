import { describe, it, expect, vi } from 'vitest'
import { createAppReleaseService, APK_CONTENT_TYPE } from '../src/modules/app-releases/app-release.service.js'

function make({ releases = [], minimum = '0.0.0', exists = true } = {}) {
  const repo = {
    list: vi.fn(async () => releases),
    findByVersion: vi.fn(async (v) => releases.find((r) => r.version === v) ?? null),
    create: vi.fn(async (d) => ({ id: 'r', ...d })),
    getSetting: vi.fn(async () => ({ minimumSupportedVersion: minimum })),
    setMinimum: vi.fn(async (v) => ({ minimumSupportedVersion: v })),
  }
  const storage = {
    uploadUrl: vi.fn(async ({ key }) => `https://put/${key}`),
    downloadUrl: vi.fn(async ({ key }) => `https://get/${key}`),
    exists: vi.fn(async () => exists),
  }
  return { repo, storage, svc: createAppReleaseService({ repo, storage }) }
}
const rel = (version, at) => ({ version, apkKey: `app/partner-${version}.apk`, notes: `n${version}`, createdAt: new Date(at) })

describe('app release service', () => {
  it('reports nothing to install when there are no releases', async () => {
    expect(await make().svc.current()).toEqual({ latestVersion: null, minimumSupportedVersion: '0.0.0', apkUrl: null, notes: null })
  })

  it('latest is the highest version, not the newest upload', async () => {
    const { svc } = make({ releases: [rel('1.9.0', '2026-10-07'), rel('1.10.0', '2026-10-06')], minimum: '1.9.0' })
    expect(await svc.current()).toEqual({
      latestVersion: '1.10.0', minimumSupportedVersion: '1.9.0', apkUrl: 'https://get/app/partner-1.10.0.apk', notes: 'n1.10.0',
    })
  })

  it('presigns an upload only for a new, valid version', async () => {
    const { svc } = make({ releases: [rel('1.1.0', '2026-10-06')] })
    const up = await svc.uploadUrl('1.2.0')
    expect(up.apkKey).toMatch(/^app\/partner-1\.2\.0-[0-9a-f-]{36}\.apk$/)
    expect(up).toEqual({ uploadUrl: `https://put/${up.apkKey}`, apkKey: up.apkKey, contentType: APK_CONTENT_TYPE })
    expect((await svc.uploadUrl('1.2.0')).apkKey).not.toBe(up.apkKey)
    await expect(svc.uploadUrl('1.1.0')).rejects.toMatchObject({ status: 409 })
    await expect(svc.uploadUrl('v1.2')).rejects.toMatchObject({ status: 400 })
  })

  it('registers only a matching key whose file is in storage', async () => {
    const key = 'app/partner-1.2.0-abc.apk'
    await expect(make({ exists: false }).svc.register({ version: '1.2.0', apkKey: key }, { id: 'a' })).rejects.toMatchObject({ status: 400 })
    const { svc, repo, storage } = make()
    for (const bad of [undefined, 'app/partner-1.3.0-abc.apk', 'app/partner-1.2.0.apk', 'app/partner-1.2.0-x/../../evil.apk', 'app/partner-1.2.0-x/y.apk', 'app/partner-1.2.0-abc.zip']) {
      await expect(svc.register({ version: '1.2.0', apkKey: bad }, { id: 'a' })).rejects.toMatchObject({ status: 400 })
    }
    expect(storage.exists).not.toHaveBeenCalled()
    await svc.register({ version: '1.2.0', apkKey: key, notes: ' Fixes ' }, { id: 'a' })
    expect(repo.create).toHaveBeenCalledWith({ version: '1.2.0', apkKey: key, notes: 'Fixes', createdById: 'a' })
  })

  it('minimum must be 0.0.0 or a released version', async () => {
    const { svc, repo } = make({ releases: [rel('1.1.0', '2026-10-06')] })
    await expect(svc.setMinimum('1.5.0', { id: 'a' })).rejects.toMatchObject({ status: 400 })
    await expect(svc.setMinimum('1.1', { id: 'a' })).rejects.toMatchObject({ status: 400 })
    await svc.setMinimum('1.1.0', { id: 'a' })
    await svc.setMinimum('0.0.0', { id: 'a' })
    expect(repo.setMinimum).toHaveBeenLastCalledWith('0.0.0', 'a')
  })
})
