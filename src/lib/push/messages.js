/**
 * Every push notification the partner app can receive, in one place, in the
 * partner's language (English / Hindi / Marathi — Partner.preferredLanguage).
 *
 * A new kind (a payout was made…) is one entry here, with all three
 * languages, plus one route in the app's NOTIFICATION_ROUTES
 * (mobile/lib/notificationRoutes.js). `data.kind` is how the app knows where a
 * tap should go; it never depends on the language.
 *
 * HINDI AND MARATHI ARE DRAFTS — they need a native speaker's review before
 * real partners rely on them.
 */

const LANGS = ['EN', 'HI', 'MR']
const SOMEONE = { EN: 'Your customer', HI: 'आपके ग्राहक', MR: 'तुमचे ग्राहक' }

const first = (name, lang) => String(name ?? '').trim().split(/\s+/)[0] || SOMEONE[lang]
// ₹ amounts read the same (en-IN grouping) in all three languages.
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const hasAmount = (amount) => amount != null && Number.isFinite(Number(amount))

// kind → { data(payload), EN|HI|MR(payload, f) → { title, body } }, where f is
// the customer's first name already resolved for that language.
const CATALOGUE = {
  'lead.interested': {
    data: ({ leadId }) => ({ kind: 'lead.interested', leadId }),
    EN: (_, f) => ({ title: `Good news: ${f} is interested`, body: "The customer you referred wants a Gazon connection. We're setting it up." }),
    HI: (_, f) => ({ title: `खुशखबरी: ${f} इच्छुक हैं`, body: 'आपके बताए ग्राहक Gazon कनेक्शन लेना चाहते हैं। हम इसकी तैयारी कर रहे हैं।' }),
    MR: (_, f) => ({ title: `आनंदाची बातमी: ${f} इच्छुक आहेत`, body: 'तुम्ही सुचवलेल्या ग्राहकांना Gazon कनेक्शन हवे आहे. आम्ही त्याची तयारी करत आहोत.' }),
  },
  'lead.converted': {
    data: ({ leadId }) => ({ kind: 'lead.converted', leadId }),
    EN: ({ amount }, f) => ({
      title: `${f} signed up 🎉`,
      body: hasAmount(amount) ? `You've earned ${rupees(amount)}. Tap to see it in your earnings.` : 'Your earning is on its way. Tap to see it.',
    }),
    HI: ({ amount }, f) => ({
      title: `${f} जुड़ गए 🎉`,
      body: hasAmount(amount) ? `आपने ${rupees(amount)} कमाए। अपनी कमाई देखने के लिए टैप करें।` : 'आपकी कमाई जल्द दिखेगी। देखने के लिए टैप करें।',
    }),
    MR: ({ amount }, f) => ({
      title: `${f} जोडले गेले 🎉`,
      body: hasAmount(amount) ? `तुम्ही ${rupees(amount)} कमावले. तुमची कमाई पाहण्यासाठी टॅप करा.` : 'तुमची कमाई लवकरच दिसेल. पाहण्यासाठी टॅप करा.',
    }),
  },
  'lead.contacted': {
    data: ({ leadId }) => ({ kind: 'lead.contacted', leadId }),
    EN: (_, f) => ({ title: `We called ${f}`, body: "We've spoken to the customer you referred and are following up." }),
    HI: (_, f) => ({ title: `हमने ${f} को कॉल किया`, body: 'हमने आपके बताए ग्राहक से बात की है और आगे की बात कर रहे हैं।' }),
    MR: (_, f) => ({ title: `आम्ही ${f} यांना कॉल केला`, body: 'आम्ही तुम्ही सुचवलेल्या ग्राहकांशी बोललो आहोत आणि पाठपुरावा करत आहोत.' }),
  },
  'lead.not_interested': {
    data: ({ leadId }) => ({ kind: 'lead.not_interested', leadId }),
    EN: (_, f) => ({ title: `${f} decided not to go ahead`, body: 'The customer chose not to take a connection this time. Thanks for referring them.' }),
    HI: (_, f) => ({ title: `${f} ने अभी कनेक्शन नहीं लेने का फ़ैसला किया`, body: 'ग्राहक ने इस बार कनेक्शन नहीं लिया। ग्राहक बताने के लिए धन्यवाद।' }),
    MR: (_, f) => ({ title: `${f} यांनी सध्या कनेक्शन न घेण्याचा निर्णय घेतला`, body: 'ग्राहकांनी या वेळी कनेक्शन घेतले नाही. ग्राहक सुचवल्याबद्दल धन्यवाद.' }),
  },
  'lead.unreachable': {
    data: ({ leadId }) => ({ kind: 'lead.unreachable', leadId }),
    EN: (_, f) => ({ title: `We couldn't reach ${f}`, body: "We tried calling but couldn't get through. If you can, ask them to expect our call." }),
    HI: (_, f) => ({ title: `${f} से संपर्क नहीं हो पाया`, body: 'हमने कॉल किया, पर बात नहीं हो पाई। हो सके तो उन्हें बता दें कि हमारा कॉल आएगा।' }),
    MR: (_, f) => ({ title: `${f} यांच्याशी संपर्क झाला नाही`, body: 'आम्ही कॉल केला, पण बोलणे झाले नाही. शक्य असल्यास त्यांना आमचा कॉल येईल असे सांगा.' }),
  },
  'lead.duplicate': {
    data: ({ leadId }) => ({ kind: 'lead.duplicate', leadId }),
    EN: (_, f) => ({ title: `${f} was already referred`, body: "Someone told us about this customer first, so this lead isn't counted. Thanks anyway." }),
    HI: (_, f) => ({ title: `${f} के बारे में पहले ही बताया जा चुका था`, body: 'किसी और ने इस ग्राहक के बारे में पहले बताया था, इसलिए यह लीड नहीं गिनी जाएगी। फिर भी धन्यवाद।' }),
    MR: (_, f) => ({ title: `${f} यांची माहिती आधीच मिळाली होती`, body: 'या ग्राहकाबद्दल दुसऱ्या कोणीतरी आधी सांगितले होते, त्यामुळे ही लीड मोजली जाणार नाही. तरीही धन्यवाद.' }),
  },
  // A manager moved the lead back to NEW.
  'lead.requeued': {
    data: ({ leadId }) => ({ kind: 'lead.requeued', leadId }),
    EN: (_, f) => ({ title: `${f} is back in our queue`, body: 'Our team will call the customer again soon.' }),
    HI: (_, f) => ({ title: `${f} फिर से हमारी सूची में हैं`, body: 'हमारी टीम जल्द ही ग्राहक को फिर से कॉल करेगी।' }),
    MR: (_, f) => ({ title: `${f} पुन्हा आमच्या यादीत आहेत`, body: 'आमची टीम लवकरच ग्राहकांना पुन्हा कॉल करेल.' }),
  },

  // The admin's decision on the partner's documents.
  'partner.approved': {
    data: () => ({ kind: 'partner.approved' }),
    EN: () => ({ title: "You're approved! 🎉", body: 'Your documents are verified. You can now add leads and start earning.' }),
    HI: () => ({ title: 'आप मंज़ूर हो गए! 🎉', body: 'आपके दस्तावेज़ सत्यापित हो गए हैं। अब आप लीड जोड़कर कमाई शुरू कर सकते हैं।' }),
    MR: () => ({ title: 'तुम्हाला मंजुरी मिळाली! 🎉', body: 'तुमची कागदपत्रे पडताळली आहेत. आता तुम्ही लीड जोडून कमाई सुरू करू शकता.' }),
  },
  'partner.rejected': {
    data: () => ({ kind: 'partner.rejected' }),
    EN: () => ({ title: 'Please upload your documents again', body: "We couldn't accept the photos you sent. Tap to upload clear ones." }),
    HI: () => ({ title: 'कृपया अपने दस्तावेज़ फिर से अपलोड करें', body: 'आपकी भेजी गई फ़ोटो स्वीकार नहीं हो सकीं। साफ़ फ़ोटो अपलोड करने के लिए टैप करें।' }),
    MR: () => ({ title: 'कृपया तुमची कागदपत्रे पुन्हा अपलोड करा', body: 'तुम्ही पाठवलेले फोटो स्वीकारता आले नाहीत. स्पष्ट फोटो अपलोड करण्यासाठी टॅप करा.' }),
  },
}

export const NOTIFICATION_KINDS = Object.keys(CATALOGUE)

/**
 * `lang` is the partner's preferredLanguage (EN | HI | MR). Anything else —
 * an unset value, a language we have not written yet — reads in English, so a
 * notification is never blank.
 */
export function buildNotification(kind, payload = {}, lang = 'EN') {
  const entry = CATALOGUE[kind]
  if (!entry) throw new Error(`Unknown notification kind: ${kind}`)
  const l = LANGS.includes(lang) ? lang : 'EN'
  const { title, body } = (entry[l] ?? entry.EN)(payload, first(payload.customerName, l))
  return { title, body, data: entry.data(payload) }
}
