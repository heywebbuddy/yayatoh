'use client';

import { CARD_KINDS, type CardKind, PAPER_SIZES, type PaperSize } from '@yayatoh/seating/client';
import { Button, FieldMessage, Radio, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * Print cards (M4.3b): choose place, escort or table cards, the paper and the cards' language,
 * then download the PDF (a plain GET form, so it works before hydration too). A kind with nothing
 * to print says so inline instead of downloading an empty file.
 */
export function SeatingCardsForm({
  action,
  sub,
  counts,
  paper,
  lang,
  languages,
}: {
  action: string;
  sub: string | null;
  counts: Record<CardKind, number>;
  paper: PaperSize;
  lang: string;
  languages: readonly { code: string; name: string }[];
}) {
  const t = useTranslations('seating.cards');
  const [kind, setKind] = useState<CardKind>(counts.place > 0 ? 'place' : 'table');
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  return (
    <form
      method="get"
      action={action}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        if (counts[kind] === 0) {
          e.preventDefault();
          setStarted(false);
          setError(t(`print.empty.${kind}`));
          document.getElementById(`kind-${kind}`)?.focus();
          return;
        }
        setError(null);
        setStarted(true);
      }}
    >
      <fieldset
        className="m-0 flex flex-col gap-1 border-0 p-0"
        aria-describedby={error ? 'cards-kind-error' : undefined}
      >
        <legend className="mb-1 text-[13px] font-bold text-ink">{t('print.kind')}</legend>
        {CARD_KINDS.map((k) => (
          <Radio
            key={k}
            name="kind"
            value={k}
            checked={kind === k}
            onChange={() => {
              setKind(k);
              setError(null);
              setStarted(false);
            }}
            label={t(`kinds.${k}`)}
            hint={t(`hints.${k}`, { count: counts[k] })}
          />
        ))}
        <FieldMessage id="cards-kind" error={error ?? undefined} />
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select id="cards-paper" name="paper" label={t('print.paper')} defaultValue={paper}>
          {PAPER_SIZES.map((p) => (
            <option key={p} value={p}>
              {t(`papers.${p}`)}
            </option>
          ))}
        </Select>
        <Select id="cards-lang" name="lang" label={t('print.language')} defaultValue={lang}>
          {languages.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>
      {sub ? <input type="hidden" name="sub" value={sub} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit">{t('print.submit')}</Button>
        <p role="status" className="m-0 text-caption text-ink-2">
          {started ? t('print.started') : ''}
        </p>
      </div>
    </form>
  );
}
