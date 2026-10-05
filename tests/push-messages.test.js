import { describe, it, expect } from 'vitest'
import { buildNotification, NOTIFICATION_KINDS } from '../src/lib/push/messages.js'

describe('the notification catalogue', () => {
  it('knows the two v1 kinds', () => {
    expect(NOTIFICATION_KINDS).toEqual(expect.arrayContaining(['lead.interested', 'lead.converted']))
  })

  it('words "interested" around the customer\'s first name', () => {
    const n = buildNotification('lead.interested', { leadId: 'l1', customerName: 'Ramesh Patil' })
    expect(n.title).toBe('Good news: Ramesh is interested')
    expect(n.body).toBe("The customer you referred wants a Gazon connection. We're setting it up.")
    expect(n.data).toEqual({ kind: 'lead.interested', leadId: 'l1' })
  })

  it('names the earning on "converted", in Indian grouping', () => {
    const n = buildNotification('lead.converted', { leadId: 'l2', customerName: 'Asha', amount: 1250 })
    expect(n.title).toBe('Asha signed up 🎉')
    expect(n.body).toBe("You've earned ₹1,250. Tap to see it in your earnings.")
    expect(n.data).toEqual({ kind: 'lead.converted', leadId: 'l2' })
  })

  it('still reads well with no name and no amount', () => {
    const n = buildNotification('lead.converted', { leadId: 'l3', customerName: '  ' })
    expect(n.title).toBe('Your customer signed up 🎉')
    expect(n.body).toBe('Your earning is on its way. Tap to see it.')
  })

  it('refuses a kind it does not know, rather than sending something blank', () => {
    expect(() => buildNotification('payout.paid', {})).toThrow(/Unknown notification kind/)
  })
})

describe('every lead status and the approval decision', () => {
  const lead = { leadId: 'l9', customerName: 'Ramesh Patil' }
  it.each([
    ['lead.contacted', 'We called Ramesh', "We've spoken to the customer you referred and are following up."],
    ['lead.not_interested', 'Ramesh decided not to go ahead', 'The customer chose not to take a connection this time. Thanks for referring them.'],
    ['lead.unreachable', "We couldn't reach Ramesh", "We tried calling but couldn't get through. If you can, ask them to expect our call."],
    ['lead.duplicate', 'Ramesh was already referred', "Someone told us about this customer first, so this lead isn't counted. Thanks anyway."],
    ['lead.requeued', 'Ramesh is back in our queue', 'Our team will call the customer again soon.'],
  ])('%s reads as agreed and opens the lead', (kind, title, body) => {
    const n = buildNotification(kind, lead)
    expect(n.title).toBe(title)
    expect(n.body).toBe(body)
    expect(n.data).toEqual({ kind, leadId: 'l9' })
  })

  it('congratulates an approved partner', () => {
    const n = buildNotification('partner.approved', {})
    expect(n.title).toBe("You're approved! 🎉")
    expect(n.body).toBe('Your documents are verified. You can now add leads and start earning.')
    expect(n.data).toEqual({ kind: 'partner.approved' })
  })

  it('asks a rejected partner to upload again', () => {
    const n = buildNotification('partner.rejected', {})
    expect(n.title).toBe('Please upload your documents again')
    expect(n.body).toBe("We couldn't accept the photos you sent. Tap to upload clear ones.")
    expect(n.data).toEqual({ kind: 'partner.rejected' })
  })
})

describe('in the partner\'s language', () => {
  const lead = { leadId: 'l1', customerName: 'Ramesh Patil', amount: 750 }
  it('Hindi', () => {
    const n = buildNotification('lead.converted', lead, 'HI')
    expect(n.title).toContain('Ramesh')
    expect(n.body).toContain('₹750')
    expect(n.title).toMatch(/[ऀ-ॿ]/) // Devanagari
    expect(n.data).toEqual({ kind: 'lead.converted', leadId: 'l1' })
  })
  it('Marathi', () => {
    expect(buildNotification('partner.approved', {}, 'MR').body).toMatch(/[ऀ-ॿ]/)
  })
  it('every kind has all three languages', () => {
    for (const kind of NOTIFICATION_KINDS) for (const lang of ['EN', 'HI', 'MR']) {
      const n = buildNotification(kind, lead, lang)
      expect(n.title, `${kind} ${lang}`).toBeTruthy()
      expect(n.body, `${kind} ${lang}`).toBeTruthy()
      if (lang !== 'EN') expect(`${n.title} ${n.body}`, `${kind} ${lang}`).toMatch(/[ऀ-ॿ]/)
    }
  })
  it('an unknown or missing language falls back to English', () => {
    expect(buildNotification('partner.approved', {}, 'TA').title).toBe("You're approved! 🎉")
    expect(buildNotification('partner.approved', {}, null).title).toBe("You're approved! 🎉")
  })
  it('names a nameless customer in the partner\'s language', () => {
    expect(buildNotification('lead.interested', { leadId: 'l1' }, 'HI').title).not.toContain('Your customer')
  })
})
