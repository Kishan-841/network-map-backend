import { UAParser } from 'ua-parser-js'

const DEVICE_LABEL = { mobile: 'Mobile', tablet: 'Tablet' }

export function parseRequestInfo(req) {
  const parsed = new UAParser(req.headers['user-agent'] ?? '').getResult()
  return {
    ipAddress: req.ip ?? null,
    device: DEVICE_LABEL[parsed.device.type] ?? 'Desktop',
    browser: parsed.browser.name ?? null,
    os: parsed.os.name ?? null,
  }
}
