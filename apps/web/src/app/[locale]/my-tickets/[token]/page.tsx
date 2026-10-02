import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { holderContext, holderTicketsQuery } from '@yayatoh/ticketing';
import { Card, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ClaimLinkForm } from '@/components/claim-link-form.tsx';
import { HolderContent } from '@/components/holder-content.tsx';
import { TicketQr } from '@/components/ticket-qr.tsx';
import { formatEventDateRange } from '@/lib/format.ts';
import { ports } from '@/server/ports.ts';
import { giveTicketAction } from './actions.ts';

/** Ticket holder self-service (magic link): my tickets for one event, and passing one on. */
export default async function MyTicketsPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token: raw } = await params;
  setRequestLocale(locale);
  const token = decodeURIComponent(raw);
  const h = await holderContext(token);
  if (!h) notFound();
  const t = await getTranslations();
  const data = await executeQuery(holderTicketsQuery, { linkId: h.id }, h.ctx, ports).catch((err) => {
    if (isDomainError(err) && err.code === 'not_found') return null;
    throw err;
  });
  if (!data) {
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-6 py-16">
        <EmptyState title={t('myTickets.expiredTitle')} description={t('myTickets.expiredDescription')} />
      </main>
    );
  }
  const when = formatEventDateRange(data.event.startsAt.toISOString(), data.event.endsAt.toISOString(), {
    locale,
    currency: 'USD',
    timeZone: data.event.timezone,
  });
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-6 py-16">
      <PageHeader
        eyebrow={<Label>{t('myTickets.eyebrow')}</Label>}
        title={data.event.name}
        description={`${when} · ${t('myTickets.for', { email: data.email })}`}
      />
      {data.tickets.length === 0 ? (
        <EmptyState title={t('myTickets.noneTitle')} description={t('myTickets.noneDescription')} />
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {data.tickets.map((tk) => (
            <li key={tk.id}>
              <Card size="panel" className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-5">
                  <TicketQr
                    code={tk.code}
                    label={t('order.qrLabel', { serial: tk.serial })}
                    className="size-40 shrink-0 rounded-tag text-black"
                  />
                  <div className="flex flex-col gap-1">
                    <p className="text-section">{tk.typeName}</p>
                    <p className="text-body">{tk.holderName}</p>
                    <p className="text-caption text-ink-2">{t('order.serial', { serial: tk.serial })}</p>
                    <p className="font-mono text-[18px] tracking-[0.2em]">{tk.shortCode}</p>
                  </div>
                </div>
                <section
                  aria-labelledby={`give-${tk.id}`}
                  className="flex flex-col gap-2 border-t border-line pt-3"
                >
                  <h2 id={`give-${tk.id}`} className="text-caption text-ink-2">
                    {t('myTickets.giveTitle')}
                  </h2>
                  {tk.pendingTransfer ? (
                    <p className="text-caption text-ink-2">{t('myTickets.pending')}</p>
                  ) : null}
                  <ClaimLinkForm
                    action={giveTicketAction.bind(null, token, tk.id)}
                    idPrefix={`give-${tk.id}`}
                    submitLabel={t('myTickets.give')}
                  />
                </section>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {data.tickets.length > 0 && h.ctx.orgId ? (
        <HolderContent
          target={{ orgId: h.ctx.orgId, eventId: data.event.id }}
          locale={locale}
          timeZone={data.event.timezone}
        />
      ) : null}
    </main>
  );
}
