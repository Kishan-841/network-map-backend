import { describe, it, expect } from 'vitest'
import { compareSemver, isSemver } from '../src/lib/semver.js'

describe('semver', () => {
  it('accepts only MAJOR.MINOR.PATCH digits', () => {
    for (const ok of ['0.0.0', '1.1.0', '10.20.300']) expect(isSemver(ok)).toBe(true)
    for (const bad of ['1.2', 'v1.2.0', '1.2.0-beta', '1.2.0.1', '', null, 12, ' 1.2.0']) expect(isSemver(bad)).toBe(false)
  })
  it('compares numerically, not as text', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1)
    expect(compareSemver('1.9.0', '1.10.0')).toBe(-1)
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0)
    expect(compareSemver('1.0.10', '1.0.9')).toBe(1)
  })
  it('refuses to compare invalid versions', () => {
    expect(() => compareSemver('1.2', '1.2.0')).toThrow(/version/)
  })
})
