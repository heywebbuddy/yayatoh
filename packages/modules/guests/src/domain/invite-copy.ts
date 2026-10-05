/**
 * The built-in invitation wording (M4.1f), one per language: what an event's invitations say
 * until the host writes their own for that language. `{party}` and `{event}` are filled per party
 * when the message is queued; the RSVP link always follows (a button in the email, the last line
 * of the text). Pure: no I/O.
 */

export const INVITE_LOCALES = [
  'en',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'nl',
  'ru',
  'ar',
  'hi',
  'ja',
  'zh-CN',
  'zh-TW',
] as const;
export type InviteLocale = (typeof INVITE_LOCALES)[number];

export const isInviteLocale = (l: string): l is InviteLocale =>
  (INVITE_LOCALES as readonly string[]).includes(l);

export interface InviteCopy {
  readonly subject: string;
  readonly message: string;
  readonly smsText: string;
}

export const SUBJECT_MAX = 150;
export const MESSAGE_MAX = 2000;
export const SMS_MAX = 320;

export const DEFAULT_INVITE_COPY: Readonly<Record<InviteLocale, InviteCopy>> = {
  en: {
    subject: "You're invited: {event}",
    message:
      'Dear {party},\n\nWe would love to celebrate {event} with you. Please let us know who of your household can come.',
    smsText: "{party}, you're invited to {event}. Please RSVP:",
  },
  es: {
    subject: 'Estás invitado: {event}',
    message:
      'Querida familia {party}:\n\nNos encantaría celebrar {event} con ustedes. Indíquennos quiénes de su hogar podrán asistir.',
    smsText: '{party}, están invitados a {event}. Confirmen su asistencia:',
  },
  fr: {
    subject: 'Vous êtes invités : {event}',
    message:
      'Chers {party},\n\nNous serions ravis de célébrer {event} avec vous. Dites-nous qui de votre foyer pourra venir.',
    smsText: '{party}, vous êtes invités à {event}. Merci de répondre :',
  },
  de: {
    subject: 'Ihre Einladung: {event}',
    message:
      'Liebe {party},\n\nwir würden {event} sehr gern mit Ihnen feiern. Bitte sagen Sie uns, wer aus Ihrem Haushalt kommen kann.',
    smsText: '{party}, Sie sind zu {event} eingeladen. Bitte antworten Sie:',
  },
  it: {
    subject: 'Sei invitato: {event}',
    message:
      'Cari {party},\n\nsaremmo felici di festeggiare {event} con voi. Fateci sapere chi della vostra famiglia potrà venire.',
    smsText: '{party}, siete invitati a {event}. Rispondete qui:',
  },
  pt: {
    subject: 'Você está convidado: {event}',
    message:
      'Querida família {party},\n\nAdoraríamos celebrar {event} com vocês. Digam-nos quem da sua casa poderá vir.',
    smsText: '{party}, vocês estão convidados para {event}. Confirmem a presença:',
  },
  nl: {
    subject: 'Je bent uitgenodigd: {event}',
    message:
      'Beste {party},\n\nWe vieren {event} graag met jullie. Laat ons weten wie van jullie huishouden kan komen.',
    smsText: '{party}, jullie zijn uitgenodigd voor {event}. Laat het ons weten:',
  },
  ru: {
    subject: 'Приглашение: {event}',
    message:
      'Дорогие {party}!\n\nМы будем рады отпраздновать {event} вместе с вами. Сообщите, пожалуйста, кто из вашей семьи сможет прийти.',
    smsText: '{party}, приглашаем вас на {event}. Пожалуйста, ответьте:',
  },
  ar: {
    subject: 'دعوة: {event}',
    message: 'أعزاءنا {party}،\n\nيسعدنا أن نحتفل بـ {event} معكم. يُرجى إخبارنا بمن سيحضر من أسرتكم.',
    smsText: '{party}، أنتم مدعوون إلى {event}. يُرجى الرد:',
  },
  hi: {
    subject: 'आपको आमंत्रण: {event}',
    message: 'प्रिय {party},\n\nहम {event} आपके साथ मनाना चाहेंगे। कृपया बताएँ कि आपके परिवार से कौन आ सकेगा।',
    smsText: '{party}, आपको {event} में आमंत्रित किया गया है। कृपया उत्तर दें:',
  },
  ja: {
    subject: 'ご招待：{event}',
    message:
      '{party} 様\n\n{event} をご一緒にお祝いできれば幸いです。ご家族のどなたがご出席いただけるかお知らせください。',
    smsText: '{party} 様、{event} にご招待します。ご返信はこちら：',
  },
  'zh-CN': {
    subject: '诚挚邀请：{event}',
    message: '亲爱的{party}：\n\n我们诚挚邀请您共同庆祝{event}。请告诉我们您家中哪几位能够出席。',
    smsText: '{party}，诚邀您参加{event}。请回复：',
  },
  'zh-TW': {
    subject: '誠摯邀請：{event}',
    message: '親愛的{party}：\n\n我們誠摯邀請您一同慶祝{event}。請告訴我們您家中哪幾位能夠出席。',
    smsText: '{party}，誠邀您參加{event}。請回覆：',
  },
};

/** The default wording of a language (English for anything else). */
export const defaultInviteCopy = (locale: string): InviteCopy =>
  DEFAULT_INVITE_COPY[isInviteLocale(locale) ? locale : 'en'];

/** Fill `{party}` and `{event}`; anything else in braces stays as written. */
export function fillInvite(text: string, values: { readonly party: string; readonly event: string }): string {
  return text.replace(/\{(party|event)\}/g, (_m, k: 'party' | 'event') => values[k]);
}
