import { RTL_LOCALES } from '@yayatoh/contracts';
import { EMAIL_MESSAGES, emailLocale, textOn } from '@yayatoh/notifications';
import { html, SafeHtml } from '@yayatoh/pdf';
import { color, emailFont, radius } from '@yayatoh/ui/tokens';
import type { Block, CampaignContent } from './blocks.ts';

export interface CampaignBrand {
  readonly name: string;
  /** #rrggbb or null for the platform ink. */
  readonly brandColor: string | null;
  /** Absolute URL of the org's logo (email clients fetch it), and its alt text. */
  readonly logoUrl: string | null;
  readonly logoAlt: string | null;
  readonly poweredByVisible: boolean;
}

export interface CampaignEventInfo {
  readonly name: string;
  readonly startsAt: Date;
  readonly timezone: string;
  readonly venue: string | null;
}

export interface RenderCampaignInput {
  readonly content: CampaignContent;
  readonly locale: string;
  readonly brand: CampaignBrand;
  readonly events: ReadonlyMap<string, CampaignEventInfo>;
  /** Link per block id (tracked `/r/{code}` URLs, or `{{@origin}}/r/{code}` in stored content). */
  readonly links: ReadonlyMap<string, string>;
  /** A test send: a banner on top and "[Test]" in the subject. */
  readonly test?: boolean;
  /** Relative image paths (`/media/…`) become absolute on this origin (email clients need it). */
  readonly imageOrigin: string;
}

export interface RenderedCampaign {
  readonly subject: string;
  readonly preheader: string;
  readonly html: string;
  readonly text: string;
  readonly lang: string;
  readonly dir: 'ltr' | 'rtl';
}

/** The unsubscribe link token, replaced per message by the dispatcher. */
export const UNSUBSCRIBE_TOKEN = '{{@unsubscribe}}';
/** The app origin token (tracked links, our own images), replaced by the dispatcher. */
export const ORIGIN_TOKEN = '{{@origin}}';

/**
 * Render a campaign's blocks as an email with the org's brand kit (M3.6b). Table layout for email
 * clients, logical properties and `dir` so Arabic reads right to left, design tokens for every
 * colour and font. Merge fields stay in place (the dispatcher fills them per recipient); organizer
 * text is escaped. The footer always carries the postal address and the unsubscribe link.
 */
export function renderCampaign(input: RenderCampaignInput): RenderedCampaign {
  const lang = emailLocale(input.locale);
  const dir = RTL_LOCALES.has(lang) ? 'rtl' : 'ltr';
  const cat = EMAIL_MESSAGES[lang];
  const org = input.brand;
  const brand = org.brandColor ?? color.ink;
  const onBrand = textOn(brand);
  const font = emailFont[input.content.font];
  const subject = input.test
    ? cat.campaigns.testSubject.replace('{subject}', input.content.subject)
    : input.content.subject;
  const why = cat.common.why.marketing.replace('{org}', org.name);
  const poweredBy = cat.common.poweredBy;
  const img = (src: string) => (src.startsWith('/') ? `${input.imageOrigin.replace(/\/$/, '')}${src}` : src);
  const when = (e: CampaignEventInfo) =>
    new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeStyle: 'short', timeZone: e.timezone }).format(
      e.startsAt,
    );
  const paragraphs = (text: string) =>
    text
      .split(/\n{2,}/)
      .map(
        (para) =>
          html`<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${color.zinc[800]};">${para
            .split('\n')
            .map((line, i) => (i === 0 ? html`${line}` : html`<br>${line}`))}</p>`,
      );
  const button = (href: string, label: string) =>
    html`<p style="margin:8px 0 24px;"><a href="${href}" style="display:inline-block;background:${brand};color:${onBrand};text-decoration:none;padding:12px 22px;border-radius:${radius.pill};font-size:15px;">${label}</a></p>`;

  const text: string[] = [subject, ''];
  const renderBlock = (b: Block): SafeHtml => {
    switch (b.type) {
      case 'heading':
        text.push(b.text, '');
        return html`<h2 style="margin:0 0 16px;font-size:22px;line-height:1.25;font-weight:400;color:${color.ink};">${b.text}</h2>`;
      case 'text':
        text.push(b.text, '');
        return html`${paragraphs(b.text)}`;
      case 'image':
        return html`<p style="margin:0 0 16px;"><img src="${img(b.src)}" alt="${b.alt}" width="504" style="display:block;width:100%;max-width:504px;height:auto;border:0;border-radius:12px;"></p>`;
      case 'button': {
        const href = input.links.get(b.id) ?? '#';
        text.push(`${b.label}: ${href}`, '');
        return button(href, b.label);
      }
      case 'eventCard': {
        const e = input.events.get(b.eventId);
        if (!e) return html``;
        const href = input.links.get(b.id) ?? '#';
        text.push(e.name, when(e), ...(e.venue ? [e.venue] : []), `${cat.campaigns.eventCta}: ${href}`, '');
        return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${color.zinc[200]};border-radius:16px;">
<tr><td style="padding:18px 20px;">
<p style="margin:0 0 4px;font-size:17px;line-height:1.3;color:${color.ink};">${e.name}</p>
<p style="margin:0 0 4px;font-size:14px;line-height:1.4;color:${color.zinc[700]};">${when(e)}</p>
${e.venue ? html`<p style="margin:0 0 12px;font-size:14px;line-height:1.4;color:${color.zinc[700]};">${e.venue}</p>` : ''}
<a href="${href}" style="display:inline-block;background:${brand};color:${onBrand};text-decoration:none;padding:10px 18px;border-radius:${radius.pill};font-size:14px;">${cat.campaigns.eventCta}</a>
</td></tr></table>`;
      }
      case 'divider':
        text.push('---', '');
        return html`<hr style="border:0;border-top:1px solid ${color.zinc[200]};margin:8px 0 24px;">`;
      case 'footer':
        return html``;
    }
  };
  const body = input.content.blocks.map(renderBlock);
  const footer = input.content.blocks.find((b) => b.type === 'footer');
  const address = footer?.type === 'footer' ? footer.postalAddress : '';
  const note = footer?.type === 'footer' ? footer.note : '';

  const doc = html`<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${color.zinc[100]};font-family:${font};">
<div style="display:none;max-height:0;overflow:hidden;">${input.content.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${color.zinc[100]};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;background:${color.white};border-radius:${radius.card};overflow:hidden;text-align:start;font-family:${font};">
${input.test ? html`<tr><td style="background:${color.accent[100]};color:${color.zinc[900]};padding:10px 28px;font-size:13px;line-height:1.4;" data-test-banner="1"><strong>${cat.campaigns.testBanner}</strong></td></tr>` : ''}
<tr><td style="background:${brand};color:${onBrand};padding:18px 28px;font-size:16px;font-weight:600;">${
    org.logoUrl && (/^https?:\/\//.test(org.logoUrl) || org.logoUrl.startsWith(`${ORIGIN_TOKEN}/`))
      ? html`<img src="${org.logoUrl}" alt="${org.logoAlt ?? org.name}" height="40" style="display:block;height:40px;width:auto;max-width:200px;border:0;margin:0 0 8px;background:${color.white};border-radius:6px;padding:4px;">`
      : ''
  }${org.name}</td></tr>
<tr><td style="padding:28px 28px 8px;">
${body}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid ${color.zinc[200]};font-size:12px;line-height:1.5;color:${color.zinc[600]};">
${note ? html`<p style="margin:0 0 6px;">${note}</p>` : ''}
<p style="margin:0 0 6px;">${why}</p>
<p style="margin:0 0 6px;">${org.name} · ${address}</p>
<p style="margin:0 0 6px;"><a href="${new SafeHtml(UNSUBSCRIBE_TOKEN)}" style="color:${color.zinc[700]};">${cat.common.unsubscribe}</a></p>
${org.poweredByVisible ? html`<p style="margin:0;">${poweredBy}</p>` : ''}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  text.push(
    '--',
    ...(note ? [note] : []),
    why,
    `${org.name} · ${address}`,
    `${cat.common.unsubscribe}: ${UNSUBSCRIBE_TOKEN}`,
    ...(org.poweredByVisible ? [poweredBy] : []),
    '',
  );
  return {
    subject,
    preheader: input.content.preheader,
    html: doc instanceof SafeHtml ? doc.value : String(doc),
    text: text.join('\n'),
    lang,
    dir,
  };
}
