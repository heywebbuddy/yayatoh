import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { cardsHtml, cardsOf, isCardKind, isPaperSize, seatingCardsQuery } from '@yayatoh/seating';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { cardsCopy, cardsPdfResponse, isAppLocale, localeDir } from '@/server/seating-cards.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Place, escort or table cards as a PDF (M4.3b): `?kind=place|escort|table&paper=a4|letter|a5|legal
 * &lang=<locale>&sub=<sub-event>`. Anyone who may read the guest list may print them (the same names
 * the seating editor shows); never cached or indexed.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string; org: string; event: string }> },
) {
  const { locale, org, event } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const bad = (msg: string) => new Response(msg, { status: 400, headers: { 'cache-control': 'no-store' } });
  const { data, event: ev, can } = await loadEvent(org, event, 'seating');
  if (!data.modules.has('guests') || !can('guests:read')) return notFound();
  const q = new URL(req.url).searchParams;
  const kind = q.get('kind') ?? '';
  const paper = q.get('paper') ?? '';
  const sub = q.get('sub') || null;
  if (!isCardKind(kind)) return bad('Choose place, escort or table cards.');
  if (!isPaperSize(paper)) return bad('Choose a paper size.');
  if (sub && !UUID.test(sub)) return notFound();
  const lang = q.get('lang');
  const cardLang = isAppLocale(lang) ? lang : locale;
  let view: Awaited<ReturnType<typeof read>>;
  const read = () => executeQuery(seatingCardsQuery, { eventId: ev.id, subEventId: sub }, data.ctx, ports);
  try {
    view = await read();
  } catch (err) {
    if (isDomainError(err) && ['not_found', 'forbidden', 'module_not_enabled'].includes(err.code))
      return notFound();
    throw err;
  }
  const cards = cardsOf(kind, view.sheet);
  if (!cards.length)
    return new Response('There are no cards of this kind to print yet.', {
      status: 409,
      headers: { 'cache-control': 'no-store' },
    });
  const html = cardsHtml({
    kind,
    paper,
    lang: cardLang,
    dir: localeDir(cardLang),
    copy: await cardsCopy(cardLang, kind),
    event: { name: ev.name, startsAt: new Date(ev.startsAt), timeZone: ev.timezone },
    cards,
  });
  return cardsPdfResponse(html, `${ev.slug}-${kind}-cards-${paper}`);
}
