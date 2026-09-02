import { ApiError } from '../../lib/api-error.js'

/**
 * Where each call outcome leaves the lead.
 *
 * The outcome is what the caller actually observed; the status is what the
 * list shows. Mapping them here means nobody has to remember to change the
 * status separately after every call.
 *
 * WRONG_NUMBER closes the lead as NOT_INTERESTED because that is the nearest
 * status we have — the real reason survives on the call record, which is
 * where a human will look for it.
 */
export const OUTCOME_STATUS = {
  INTERESTED: 'INTERESTED',
  // Reached, and they asked to be called back — that is contact, not silence.
  CALL_LATER: 'CONTACTED',
  NOT_REACHABLE: 'UNREACHABLE',
  WRONG_NUMBER: 'NOT_INTERESTED',
}

/** A lead that has already converted is finished; a call must not undo that. */
const TERMINAL = ['CONVERTED']

export function createLeadCallService({ leadRepository, callRepository }) {
  return {
    /**
     * Record a finished call.
     *
     * Written when the call ENDS, with its outcome. A row created at "start"
     * would dangle forever whenever a browser tab closes mid-call, and a call
     * with no outcome tells the next person nothing.
     */
    async logCall(leadId, input, actor) {
      const lead = await leadRepository.findById(leadId)
      const missing = () => ApiError.notFound('Lead not found')
      if (!lead) throw missing()
      // Same boundary as every other write here.
      if (actor?.role === 'PARTNER_MANAGER' && lead.employeeId !== actor.id) throw missing()

      const outcome = input?.outcome
      if (!OUTCOME_STATUS[outcome]) throw ApiError.badRequest('Pick what happened on the call')

      const startedAt = new Date(input.startedAt)
      const endedAt = new Date(input.endedAt)
      if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
        throw ApiError.badRequest('The call times are not valid')
      }
      if (endedAt < startedAt) throw ApiError.badRequest('The call ended before it started')

      let callbackAt = null
      if (outcome === 'CALL_LATER') {
        if (!input.callbackAt) throw ApiError.badRequest('When should we call back?')
        callbackAt = new Date(input.callbackAt)
        if (Number.isNaN(callbackAt.getTime())) throw ApiError.badRequest('Not a valid callback time')
        if (callbackAt <= new Date()) throw ApiError.badRequest('Pick a time in the future')
      }

      const call = await callRepository.create({
        leadId,
        byUserId: actor?.id ?? null,
        startedAt,
        endedAt,
        // Derived from the two timestamps, never taken from the client — a
        // browser could claim any figure.
        durationSeconds: Math.round((endedAt - startedAt) / 1000),
        outcome,
        callbackAt,
        note: input.note?.trim() || null,
      })

      const nextStatus = OUTCOME_STATUS[outcome]
      const moves = !TERMINAL.includes(lead.status) && nextStatus !== lead.status
      await leadRepository.update(leadId, {
        ...(moves && { status: nextStatus }),
        // Cleared on every other outcome, or a lead that has since been
        // reached would sit on the due list forever.
        nextCallAt: callbackAt,
      })

      if (moves) {
        await leadRepository.recordEvent({
          leadId,
          fromStatus: lead.status,
          toStatus: nextStatus,
          byUserId: actor?.id ?? null,
          note: input.note?.trim() || null,
        })
      }

      return call
    },
  }
}
