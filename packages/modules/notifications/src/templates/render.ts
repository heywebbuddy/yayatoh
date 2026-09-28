import { LOCALES, type Locale, RTL_LOCALES } from '@yayatoh/contracts';
import { formatMoney, money } from '@yayatoh/kernel';
import { html, SafeHtml } from '@yayatoh/pdf';
import { color, radius } from '@yayatoh/ui/tokens';
import { IntlMessageFormat } from 'intl-messageformat';
import { type Category, kindOf, type MessageKind } from '../kinds.ts';
import ar from './messages/ar.json' with { type: 'json' };
import de from './messages/de.json' with { type: 'json' };
import en from './messages/en.json' with { type: 'json' };
import es from './messages/es.json' with { type: 'json' };
import fr from './messages/fr.json' with { type: 'json' };
import hi from './messages/hi.json' with { type: 'json' };
import it from './messages/it.json' with { type: 'json' };
import ja from './messages/ja.json' with { type: 'json' };
import nl from './messages/nl.json' with { type: 'json' };
import pt from './messages/pt.json' with { type: 'json' };
import ru from './messages/ru.json' with { type: 'json' };
import zhCN from './messages/zh-CN.json' with { type: 'json' };
import zhTW from './messages/zh-TW.json' with { type: 'json' };

type Catalog = typeof en;
export const EMAIL_MESSAGES: Readonly<Record<Locale, Catalog>> = {
  en,
  es,
  fr,
  de,
  it,
  pt,
  nl,
  ru,
  ar,
  hi,
  ja,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

export function emailLocale(locale: string | null | undefined): Locale {
  return (LOCALES as readonly string[]).includes(locale ?? '') ? (locale as Locale) : 'en';
}

export interface OrgBrand {
  readonly name: string;
  /** #rrggbb or null for the platform ink. */
  readonly brandColor: string | null;
  readonly poweredByVisible: boolean;
}

export interface TemplateOverride {
  readonly subject?: string | null;
  readonly intro?: string | null;
}

export interface RenderInput {
  readonly kind: MessageKind;
  readonly locale: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly org: OrgBrand;
  readonly recipientName?: string | null;
  /** Page link in the footer (unsubscribable categories only). */
  readonly unsubscribeUrl?: string | null;
  readonly override?: TemplateOverride | null;
}

export interface RenderedMessage {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly lang: Locale;
  readonly dir: 'ltr' | 'rtl';
  /** Short plain text for push and in-app. */
  readonly preview: string;
}

type KindCopy = { subject: string; intro: string; cta?: string; venue?: string };

function format(message: string, locale: Locale, values: Record<string, string | number>): string {
  return String(new IntlMessageFormat(message, locale, undefined, { ignoreTag: true }).format(values));
}

/** Relative luminance contrast: white text on dark brand colours, black on light ones. */
export function textOn(hex: string): string {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const onWhite = 1.05 / (l + 0.05);
  const onBlack = (l + 0.05) / 0.05;
  return onWhite >= onBlack ? color.white : color.black;
}

/**
 * Values the templates use, formatted for the recipient's locale: money from minor units, event
 * times in the event's own zone (ADR 0015), roles by name.
 */
function values(input: RenderInput, locale: Locale, cat: Catalog): Record<string, string | number> {
  const p = input.params;
  const out: Record<string, string | number> = { ...p, org: input.org.name };
  if (typeof p.amountMinor === 'number' && typeof p.currency === 'string')
    out.amount = formatMoney(money(p.amountMinor, p.currency), locale);
  if (typeof p.startsAt === 'string') {
    const tz = typeof p.timeZone === 'string' && p.timeZone ? p.timeZone : 'UTC';
    out.when = new Intl.DateTimeFormat(locale, {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: tz,
    }).format(new Date(p.startsAt));
  }
  // Security notices: a moment (e.g. the end of a payout hold) in the org's zone.
  if (typeof p.holdUntil === 'string') {
    const tz = typeof p.timeZone === 'string' && p.timeZone ? p.timeZone : 'UTC';
    out.until = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: tz,
    }).format(new Date(p.holdUntil));
  }
  if (typeof p.role === 'string') out.role = cat.roles[p.role as keyof Catalog['roles']] ?? p.role;
  return out;
}

const WHY: Partial<Record<Category, keyof Catalog['common']['why']>> = {
  reminders: 'reminders',
  event_updates: 'event_updates',
  marketing: 'marketing',
};

/**
 * Render one message kind for one recipient: subject, HTML and plain-text parts. Plain HTML
 * (the same escaped `html` template the PDFs use, ADR 0017), table layout for email clients,
 * logical properties and `dir` so Arabic renders right-to-left. Org copy overrides replace the
 * subject and opening paragraph and use the same ICU placeholders.
 */
export function renderMessage(input: RenderInput): RenderedMessage {
  const lang = emailLocale(input.locale);
  const dir = RTL_LOCALES.has(lang) ? 'rtl' : 'ltr';
  const cat = EMAIL_MESSAGES[lang];
  const def = kindOf(input.kind);
  const copy = (cat.kinds as Record<string, KindCopy>)[input.kind];
  if (!copy) throw new Error(`No copy for ${input.kind} in ${lang}`);
  for (const key of def.params)
    if (input.params[key] === undefined) throw new Error(`${input.kind}: missing param ${key}`);
  const v = values(input, lang, cat);
  const safeFormat = (msg: string) => {
    try {
      return format(msg, lang, v);
    } catch {
      return msg;
    }
  };
  const subject = input.override?.subject
    ? safeFormat(input.override.subject)
    : format(copy.subject, lang, v);
  const intro = input.override?.intro ? safeFormat(input.override.intro) : format(copy.intro, lang, v);
  const name = input.recipientName ?? (typeof input.params.name === 'string' ? input.params.name : '');
  const greeting = name ? format(cat.common.greeting, lang, { name }) : cat.common.greetingNoName;
  const body = typeof input.params.body === 'string' ? input.params.body : null;
  const venue = copy.venue && v.venue ? format(copy.venue, lang, v) : null;
  const url =
    typeof input.params.url === 'string' && input.params.url
      ? input.params.url
      : typeof input.params.replyUrl === 'string' && input.params.replyUrl
        ? input.params.replyUrl
        : null;
  const cta = copy.cta && url ? copy.cta : null;
  const why = WHY[def.category];
  const whyText = why ? format(cat.common.why[why], lang, v) : null;
  const sentBy = format(cat.common.sentBy, lang, v);
  const unsubscribe = input.unsubscribeUrl && def.category !== 'transactional' ? input.unsubscribeUrl : null;

  const brand = input.org.brandColor ?? color.ink;
  const onBrand = textOn(brand);
  const paragraphs = (text: string) =>
    text
      .split(/\n{2,}/)
      .map(
        (para) =>
          html`<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${color.zinc[800]};">${para
            .split('\n')
            .map((line, i) => (i === 0 ? html`${line}` : html`<br>${line}`))}</p>`,
      );

  const doc = html`<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${color.zinc[100]};font-family:'Helvetica Neue',Arial,'Noto Sans Arabic','Noto Sans Devanagari','Noto Sans SC','Noto Sans TC','Noto Sans JP',sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${intro}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${color.zinc[100]};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;background:${color.white};border-radius:${radius.card};overflow:hidden;text-align:start;">
<tr><td style="background:${brand};color:${onBrand};padding:18px 28px;font-size:16px;font-weight:600;">${input.org.name}</td></tr>
<tr><td style="padding:28px 28px 8px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;font-weight:400;color:${color.ink};">${subject}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${color.zinc[800]};">${greeting}</p>
${paragraphs(intro)}
${body ? html`<div style="margin:0 0 16px;padding-inline-start:14px;border-inline-start:3px solid ${color.zinc[200]};">${paragraphs(body)}</div>` : ''}
${venue ? html`<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${color.zinc[800]};">${venue}</p>` : ''}
${
  cta && url
    ? html`<p style="margin:8px 0 24px;"><a href="${url}" style="display:inline-block;background:${brand};color:${onBrand};text-decoration:none;padding:12px 22px;border-radius:${radius.pill};font-size:15px;">${cta}</a></p>
<p style="margin:0 0 16px;font-size:12px;line-height:1.4;color:${color.zinc[500]};">${cat.common.linkFallback}<br><a href="${url}" style="color:${color.zinc[600]};word-break:break-all;">${url}</a></p>`
    : ''
}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid ${color.zinc[200]};font-size:12px;line-height:1.5;color:${color.zinc[500]};">
<p style="margin:0 0 6px;">${sentBy}</p>
${whyText ? html`<p style="margin:0 0 6px;">${whyText}</p>` : ''}
${unsubscribe ? html`<p style="margin:0 0 6px;"><a href="${unsubscribe}" style="color:${color.zinc[600]};">${cat.common.unsubscribe}</a></p>` : ''}
${input.org.poweredByVisible ? html`<p style="margin:0;">${cat.common.poweredBy}</p>` : ''}
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
    ...(body ? ['', body] : []),
    ...(venue ? ['', venue] : []),
    ...(cta && url ? ['', `${cta}: ${url}`] : []),
    '',
    '--',
    sentBy,
    ...(whyText ? [whyText] : []),
    ...(unsubscribe ? [`${cat.common.unsubscribe}: ${unsubscribe}`] : []),
    ...(input.org.poweredByVisible ? [cat.common.poweredBy] : []),
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
