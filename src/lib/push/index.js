import { env } from '../../config/env.js'
import { createConsolePush } from './console-push.js'
import { createExpoPush } from './expo-push.js'

/** One `send(messages)` contract, swappable by PUSH_DRIVER — like lib/sms. */
export function getPush() {
  switch (env.pushDriver) {
    case 'console':
      return createConsolePush()
    case 'expo':
      return createExpoPush({ accessToken: env.expoAccessToken })
    default:
      throw new Error(`Unknown PUSH_DRIVER "${env.pushDriver}". Supported: console, expo.`)
  }
}
