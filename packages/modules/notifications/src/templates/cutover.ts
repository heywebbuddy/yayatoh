import { LOCALES, type Locale, RTL_LOCALES } from '@yayatoh/contracts';
import { html, SafeHtml } from '@yayatoh/pdf';
import { email, radius } from '@yayatoh/ui/tokens';
import { IntlMessageFormat } from 'intl-messageformat';
import { EMAIL_MESSAGES, emailLocale, type RenderedMessage } from './render.ts';

/**
 * The cutover messages (M2.5a, roadmap §7.8): what Yayatoh tells organizers and buyers at T−14 days,
 * T−2 days, when the freeze starts, when it ends, and after a rollback. Platform notices from
 * Yayatoh (not an org's mail): the Yayatoh header, no unsubscribe (service notices about tickets
 * people hold and accounts they use), a link to the status page. Nothing sends them automatically:
 * the owner sends them (runbook docs/runbooks/cutover.md); `pnpm cutover comms` renders every
 * moment × audience × locale for review. Copy: `cutover.*` in templates/messages/*.json
 * (label `legal-copy`, docs/owner-inbox.md).
 */
export const CUTOVER_MOMENTS = ['t14', 't2', 'freezeStart', 'freezeEnd', 'rollback'] as const;
export type CutoverMoment = (typeof CUTOVER_MOMENTS)[number];
export const CUTOVER_AUDIENCES = ['organizer', 'buyer'] as const;
export type CutoverAudience = (typeof CUTOVER_AUDIENCES)[number];

export interface CutoverNoticeInput {
  readonly moment: CutoverMoment;
  readonly audience: CutoverAudience;
  readonly locale: string | null | undefined;
  readonly name?: string | null;
  /** Freeze window start and expected end (instants), shown in the recipient's time zone. */
  readonly start: Date;
  readonly end: Date;
  readonly timeZone: string;
  /** The public status page. */
  readonly statusUrl: string;
}

function format(message: string, locale: Locale, values: Record<string, string>): string {
  return String(new IntlMessageFormat(message, locale, undefined, { ignoreTag: true }).format(values));
}

export function renderCutoverNotice(input: CutoverNoticeInput): RenderedMessage {
  const lang = emailLocale(input.locale);
  const dir = RTL_LOCALES.has(lang) ? 'rtl' : 'ltr';
  const cat = EMAIL_MESSAGES[lang];
  const copy = cat.cutover[input.audience][input.moment];
  if (!/^https:\/\//.test(input.statusUrl) && !/^http:\/\/localhost[:/]/.test(input.statusUrl))
    throw new Error('the status page link must be https');
  const when = (d: Date, style: 'full' | 'time') =>
    new Intl.DateTimeFormat(lang, {
      ...(style === 'full' ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' } : {}),
      hour: 'numeric',
      minute: '2-digit',
      timeZone: input.timeZone,
      timeZoneName: 'short',
    }).format(d);
  // The end is shown as a time when it falls on the same local day as the start.
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: input.timeZone }).format(d);
  const values = {
    start: when(input.start, 'full'),
    end: day(input.end) === day(input.start) ? when(input.end, 'time') : when(input.end, 'full'),
  };
  const subject = format(copy.subject, lang, values);
  const intro = format(copy.intro, lang, values);
  const greeting = input.name
    ? format(cat.common.greeting, lang, { name: input.name })
    : cat.common.greetingNoName;
  const cta = cat.cutover.cta;
  const url = input.statusUrl;
  const paragraphs = intro
    .split(/\n{2,}/)
    .map(
      (para) =>
        html`<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${email.body};">${para}</p>`,
    );
  const doc = html`<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${email.page};font-family:'Helvetica Neue',Arial,'Noto Sans Arabic','Noto Sans Devanagari','Noto Sans SC','Noto Sans TC','Noto Sans JP',sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${intro}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${email.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;background:${email.card};border-radius:${radius.card};overflow:hidden;text-align:start;">
<tr><td style="background:${email.header};color:${email.headerInk};padding:18px 28px;font-size:16px;font-weight:600;">Yayatoh</td></tr>
<tr><td style="padding:28px 28px 8px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${email.ink};">${subject}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${email.body};">${greeting}</p>
${paragraphs}
<p style="margin:8px 0 24px;"><a href="${url}" style="display:inline-block;background:${email.button};color:${email.buttonInk};text-decoration:none;padding:12px 22px;border-radius:${radius.pill};font-size:15px;">${cta}</a></p>
<p style="margin:0 0 16px;font-size:12px;line-height:1.4;color:${email.muted};">${cat.common.linkFallback}<br><a href="${url}" style="color:${email.link};word-break:break-all;">${url}</a></p>
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid ${email.line};font-size:12px;line-height:1.5;color:${email.muted};">
<p style="margin:0;">${cat.cutover.sentBy}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    subject,
    '',
    greeting,
    '',
    intro,
    '',
    `${cta}: ${url}`,
    '',
    '--',
    cat.cutover.sentBy,
    '',
  ].join('\n');
  return {
    subject,
    html: doc instanceof SafeHtml ? doc.value : String(doc),
    text,
    lang,
    dir,
    preview: intro.length > 180 ? `${intro.slice(0, 177)}…` : intro,
  };
}

/** Every moment × audience × locale rendered (the review set; `pnpm cutover comms`). */
export function renderCutoverSet(
  input: Omit<CutoverNoticeInput, 'moment' | 'audience' | 'locale'>,
): { moment: CutoverMoment; audience: CutoverAudience; locale: Locale; message: RenderedMessage }[] {
  return CUTOVER_MOMENTS.flatMap((moment) =>
    CUTOVER_AUDIENCES.flatMap((audience) =>
      LOCALES.map((locale) => ({
        moment,
        audience,
        locale,
        message: renderCutoverNotice({ ...input, moment, audience, locale }),
      })),
    ),
  );
}
