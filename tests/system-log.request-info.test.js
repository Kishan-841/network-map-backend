import { describe, it, expect } from 'vitest'
import { parseRequestInfo } from '../src/modules/system-logs/request-info.js'

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const fakeReq = (ua, ip = '203.0.113.7') => ({ headers: { 'user-agent': ua }, ip })

describe('parseRequestInfo', () => {
  it('parses a desktop Chrome/Windows UA', () => {
    expect(parseRequestInfo(fakeReq(CHROME_WIN))).toEqual({
      ipAddress: '203.0.113.7',
      device: 'Desktop',
      browser: 'Chrome',
      os: 'Windows',
    })
  })

  it('parses an iPhone Safari UA as Mobile/iOS', () => {
    const info = parseRequestInfo(fakeReq(IPHONE_SAFARI))
    expect(info.device).toBe('Mobile')
    expect(info.os).toBe('iOS')
  })

  it('defaults sanely with no user-agent', () => {
    expect(parseRequestInfo({ headers: {}, ip: undefined })).toEqual({
      ipAddress: null,
      device: 'Desktop',
      browser: null,
      os: null,
    })
  })
})
