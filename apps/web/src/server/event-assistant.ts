import 'server-only';
import { type AssistantSource, timeZoneLabel } from '@yayatoh/ai';
import {
  checkoutTarget,
  markdownToPlainText,
  pageTarget,
  publicEventBySlug,
  publicEventContent,
} from '@yayatoh/events';
import { formatMoney, money } from '@yayatoh/kernel';
import { publicRefundPolicy } from '@yayatoh/orders';
import { publicProgram } from '@yayatoh/program';
import { publicTicketTypes } from '@yayatoh/ticketing';
import { getTranslations } from 'next-intl/server';
import { formatEventDateRange } from '@/lib/format.ts';
import { refundPolicyLines } from '@/lib/refund-policy-text.ts';

/** What the assistant may answer from, and where each source can be found on the page. */
export interface EventKnowledge {
  readonly orgId: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly sources: readonly AssistantSource[];
  /** Page anchors of the sources that have one (`#passes`, `#agenda`). */
  readonly anchors: Readonly<Record<string, string>>;
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
const plain = (md: string) => markdownToPlainText(md).replace(/\s+/g, ' ').trim();

/**
 * The event's own published details as numbered sources: when and where, the organizer's content
 * sections (text, FAQ, schedule, location, links), announcements, the agenda, the ticket types
 * with prices and availability, and the refund policy. Only data the public event page shows:
 * nothing private, no other event, no attendee data. Null when the event is not public or the
 * organizer has not turned the assistant on for it.
 */
export async function eventKnowledge(slug: string, locale: string): Promise<EventKnowledge | null> {
  const pub = await publicEventBySlug(slug);
  if (!pub?.design.assistant) return null;
  const target = (await checkoutTarget(slug)) ?? (await pageTarget(slug));
  if (!target) return null;
  const t = await getTranslations({ locale, namespace: 'eventAssistant.labels' });
  const f = { locale, currency: pub.currency, timeZone: pub.timezone };
  const sources: AssistantSource[] = [];
  const anchors: Record<string, string> = {};
  const add = (label: string, text: string, anchor?: string) => {
    const body = clip(text.trim(), 700);
    if (!body) return;
    const id = `s${sources.length + 1}`;
    sources.push({ id, label: clip(label, 160), text: body });
    if (anchor) anchors[id] = anchor;
  };

  const place = [pub.venueName, pub.city].filter(Boolean).join(', ');
  add(
    t('event'),
    [
      pub.name,
      pub.tagline ?? '',
      `${formatEventDateRange(pub.startsAt.toISOString(), pub.endsAt.toISOString(), f)} (${timeZoneLabel(pub.timezone, locale)})`,
      place,
      pub.status === 'published' ? '' : `Status: ${pub.status}`,
    ]
      .filter(Boolean)
      .join('. '),
  );

  const content = await publicEventContent(target);
  for (const s of content.sections) {
    switch (s.kind) {
      case 'text':
        add(s.title, plain(s.content.markdown));
        break;
      case 'faq':
        for (const q of s.content.items)
          add(`${t('faq')}: ${q.question}`, `${q.question} ${plain(q.answer)}`);
        break;
      case 'schedule':
        add(
          s.title,
          s.content.items.map((i) => `${i.time} ${i.title}${i.detail ? ` (${i.detail})` : ''}`).join('; '),
        );
        break;
      case 'location':
        add(
          s.title,
          [s.content.address, plain(s.content.directions), s.content.mapUrl ?? ''].filter(Boolean).join('. '),
        );
        break;
      case 'links':
        add(s.title, s.content.items.map((i) => `${i.label}: ${i.url}`).join('; '));
        break;
      default:
        break;
    }
  }
  for (const a of content.announcements.filter((x) => x.audience === 'public'))
    add(`${t('announcement')}: ${a.title}`, `${a.title}. ${plain(a.body)}`);

  const program = await publicProgram(target);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: pub.timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  for (let i = 0; i < program.sessions.length; i += 8) {
    const chunk = program.sessions.slice(i, i + 8);
    add(
      t('agenda'),
      chunk
        .map(
          (x) =>
            `${time.format(x.startsAt)}–${time.format(x.endsAt)} ${x.title}${x.room ? ` (${x.room})` : ''}${
              x.speakers.length > 0 ? ` – ${x.speakers.map((p) => p.name).join(', ')}` : ''
            }`,
        )
        .join('; '),
      '#agenda',
    );
  }

  const passes = await publicTicketTypes(slug, new Date(), {});
  for (const p of passes) {
    const price =
      p.allInMinor === 0
        ? t('free')
        : formatMoney(money(p.allInMinor, p.currency), locale).replace(/\.00$/, '');
    add(
      `${t('ticket')}: ${p.name}`,
      [`${p.name}: ${price} (${t('allIn')})`, t(`availability.${p.availability}`), p.description ?? '']
        .filter(Boolean)
        .join('. '),
      '#passes',
    );
  }

  const refund = await publicRefundPolicy(target.orgId, target.eventId);
  if (refund) {
    const tr = await getTranslations({ locale, namespace: 'refundPolicy' });
    add(t('refund'), refundPolicyLines((k, v) => tr(k as 'none', v), refund, locale).join(' '));
  }

  return { orgId: target.orgId, eventId: target.eventId, eventName: pub.name, sources, anchors };
}
