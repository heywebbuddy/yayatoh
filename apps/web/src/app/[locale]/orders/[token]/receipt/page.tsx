import { orderByManageToken } from '@yayatoh/orders';
import { buttonClass, Card, Label, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { buildReceipt, receiptEligible } from '@/server/receipt.ts';

/** A buyer's receipt for a paid order, reached by the order's manage link (no account needed). */
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const order = await orderByManageToken(token);
  if (!order || !receiptEligible(order)) notFound();
  const t = await getTranslations('receipt');
  const r = await buildReceipt(order, locale);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-6 py-16">
      <PageHeader eyebrow={<Label>{t('eyebrow')}</Label>} title={r.title} description={r.seller} />
      <div className="flex flex-wrap gap-2">
        <a
          href={`${locale === 'en' ? '' : `/${locale}`}/orders/${token}/receipt/pdf`}
          className={buttonClass('primary', 'md')}
        >
          {t('downloadPdf')}
        </a>
        <Link href={`/orders/${token}`} className={buttonClass('secondary', 'md')}>
          {t('backToOrder')}
        </Link>
      </div>
      <Card size="panel" className="flex flex-col gap-4">
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body">
          {r.rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-2">{k}</dt>
              <dd className="m-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="text-start text-caption text-ink-2">
              <th className="py-1.5 text-start font-normal">{r.lineHeads[0]}</th>
              <th className="py-1.5 text-end font-normal">{r.lineHeads[1]}</th>
              <th className="py-1.5 text-end font-normal">{r.lineHeads[2]}</th>
              <th className="py-1.5 text-end font-normal">{r.lineHeads[3]}</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l[0]} className="border-t border-line">
                <td className="py-1.5">{l[0]}</td>
                <td className="py-1.5 text-end tabular-nums">{l[1]}</td>
                <td className="py-1.5 text-end tabular-nums">{l[2]}</td>
                <td className="py-1.5 text-end tabular-nums">{l[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="m-0 flex flex-col gap-1 border-t border-line pt-3 text-body">
          {r.totals.map(([k, v], i) => (
            <div
              key={k}
              className={`flex justify-between gap-4 ${i === r.totals.length - 1 ? 'text-section' : ''}`}
            >
              <dt>{k}</dt>
              <dd className="m-0 tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 text-caption text-ink-2">{r.note}</p>
      </Card>
    </main>
  );
}
