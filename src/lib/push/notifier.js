import { getPush } from './index.js'
import { createNotifier } from './notify.service.js'
import { pushTokenRepository } from '../../modules/partners/push-token.repository.js'

/**
 * The one notifier the app uses — shared by the lead routes (status changes)
 * and the partner routes (approve / reject), so both send the same way.
 */
export const notifier = createNotifier({ tokenRepository: pushTokenRepository, push: getPush() })
