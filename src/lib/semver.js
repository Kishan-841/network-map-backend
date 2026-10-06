/**
 * App versions are plain MAJOR.MINOR.PATCH — what app.json's `version` holds.
 * Compared part by part as numbers: as text, "1.10.0" < "1.9.0".
 */
const SEMVER = /^\d+\.\d+\.\d+$/

export const isSemver = (v) => typeof v === 'string' && SEMVER.test(v)

export function compareSemver(a, b) {
  if (!isSemver(a) || !isSemver(b)) throw new Error(`Not a version: ${a} / ${b}`)
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
  }
  return 0
}
