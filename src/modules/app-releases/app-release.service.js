import { ApiError } from '../../lib/api-error.js'
import { compareSemver, isSemver } from '../../lib/semver.js'

export const APK_CONTENT_TYPE = 'application/vnd.android.package-archive'
const keyFor = (version) => `app/partner-${version}.apk`
const NO_RELEASE = { latestVersion: null, apkUrl: null, notes: null }

/**
 * The partner app's releases: which APK is newest, the oldest version still
 * allowed to run, and how an ADMIN adds one. The app reads `current()`
 * before sign-in, so it never learns a bucket key — only a short-lived link.
 */
export function createAppReleaseService({ repo, storage }) {
  const mustBeVersion = (v) => {
    if (!isSemver(v)) throw ApiError.badRequest('Use a version like 1.2.0')
  }
  const newest = (releases) =>
    releases.reduce((best, r) => (!best || compareSemver(r.version, best.version) > 0 ? r : best), null)

  return {
    async current() {
      const [releases, setting] = await Promise.all([repo.list(), repo.getSetting()])
      const latest = newest(releases)
      if (!latest) return { ...NO_RELEASE, minimumSupportedVersion: setting.minimumSupportedVersion }
      return {
        latestVersion: latest.version,
        minimumSupportedVersion: setting.minimumSupportedVersion,
        apkUrl: await storage.downloadUrl({ key: latest.apkKey, filename: `partner-${latest.version}.apk` }),
        notes: latest.notes ?? null,
      }
    },

    async list() {
      const [releases, setting] = await Promise.all([repo.list(), repo.getSetting()])
      return { releases, minimumSupportedVersion: setting.minimumSupportedVersion, latestVersion: newest(releases)?.version ?? null }
    },

    async uploadUrl(version) {
      mustBeVersion(version)
      if (await repo.findByVersion(version)) throw ApiError.conflict(`Version ${version} is already released`)
      const apkKey = keyFor(version)
      return { uploadUrl: await storage.uploadUrl({ key: apkKey, contentType: APK_CONTENT_TYPE }), apkKey, contentType: APK_CONTENT_TYPE }
    },

    async register({ version, notes }, actor) {
      mustBeVersion(version)
      if (await repo.findByVersion(version)) throw ApiError.conflict(`Version ${version} is already released`)
      const apkKey = keyFor(version)
      if (!(await storage.exists({ key: apkKey }))) throw ApiError.badRequest('Upload the APK first')
      return repo.create({ version, apkKey, notes: notes?.trim() || null, createdById: actor.id })
    },

    async setMinimum(version, actor) {
      mustBeVersion(version)
      if (version !== '0.0.0' && !(await repo.findByVersion(version))) {
        throw ApiError.badRequest('The minimum must be a released version (or 0.0.0 to allow all)')
      }
      const s = await repo.setMinimum(version, actor.id)
      return { minimumSupportedVersion: s.minimumSupportedVersion }
    },
  }
}
