'use client';

import { Bold, Heading2, Italic, Link2, List } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';

const tool =
  'inline-flex size-9 items-center justify-center rounded-control border border-line bg-surface text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus';

/**
 * A Markdown textarea with a small toolbar (bold, italic, heading, list, link). The toolbar only
 * edits the text: it wraps the selection, or prefixes the selected lines.
 */
export function MarkdownField({
  id,
  name,
  label,
  hint,
  value,
  onValueChange,
  rows = 6,
  invalid = false,
  describedBy,
  maxLength,
}: {
  id: string;
  name?: string;
  label: string;
  hint?: string;
  value: string;
  onValueChange: (value: string) => void;
  rows?: number;
  invalid?: boolean;
  describedBy?: string;
  maxLength?: number;
}) {
  const t = useTranslations('content.editor');
  const ref = useRef<HTMLTextAreaElement>(null);

  const apply = (edit: (selected: string) => { text: string; select?: [number, number] }) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const { text, select } = edit(value.slice(a, b));
    const next = value.slice(0, a) + text + value.slice(b);
    onValueChange(next);
    const [from, to] = select ?? [a + text.length, a + text.length];
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + from, a + to);
    });
  };
  const wrap = (mark: string, placeholder: string) => () =>
    apply((s) => {
      const inner = s || placeholder;
      return { text: `${mark}${inner}${mark}`, select: [mark.length, mark.length + inner.length] };
    });
  const prefixLines = (prefix: string) => () =>
    apply((s) => {
      const text = (s || t('listItem'))
        .split('\n')
        .map((l) => `${prefix}${l}`)
        .join('\n');
      return { text, select: [0, text.length] };
    });
  const link = () =>
    apply((s) => {
      const label = s || t('linkText');
      const text = `[${label}](https://)`;
      return { text, select: [label.length + 3, label.length + 11] };
    });

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        {label}
      </label>
      <div role="toolbar" aria-label={t('toolbar')} className="flex flex-wrap gap-1">
        <button type="button" className={tool} onClick={wrap('**', t('boldText'))} aria-label={t('bold')}>
          <Bold aria-hidden="true" className="size-4" />
        </button>
        <button type="button" className={tool} onClick={wrap('*', t('italicText'))} aria-label={t('italic')}>
          <Italic aria-hidden="true" className="size-4" />
        </button>
        <button type="button" className={tool} onClick={prefixLines('## ')} aria-label={t('heading')}>
          <Heading2 aria-hidden="true" className="size-4" />
        </button>
        <button type="button" className={tool} onClick={prefixLines('- ')} aria-label={t('list')}>
          <List aria-hidden="true" className="size-4" />
        </button>
        <button type="button" className={tool} onClick={link} aria-label={t('link')}>
          <Link2 aria-hidden="true" className="size-4" />
        </button>
      </div>
      <textarea
        ref={ref}
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className={`rounded-card border bg-surface px-4 py-2 font-mono text-body ${invalid ? 'field-invalid' : ''}`}
      />
      {hint ? <p className="m-0 text-caption text-ink-2">{hint}</p> : null}
    </div>
  );
}
