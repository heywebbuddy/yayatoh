'use client';

import { cx } from '@yayatoh/ui';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import type { HumanCheckWidget } from '@/components/human-check-field.tsx';
import { ApplyForm } from '@/components/organizers/apply-form.tsx';
import type { FormState } from '@/lib/form-state.ts';

export interface SalesProps {
  readonly action: (prev: FormState, form: FormData) => Promise<FormState>;
  readonly humanCheck: HumanCheckWidget | null;
  /** `apply`: talk to sales about Enterprise; `demo`: book a demo. */
  readonly mode?: 'apply' | 'demo';
}

/**
 * The only place the application form lives: a popup opened by "Talk to sales" (Enterprise) or
 * "Book a demo". A native dialog: it traps focus, closes with Escape and returns focus to the button.
 */
export function SalesButton({
  action,
  humanCheck,
  mode = 'apply',
  label,
  className,
  variant = 'secondary',
}: SalesProps & { label: string; className?: string; variant?: 'secondary' | 'ember' }) {
  const t = useTranslations('selfServe.sales');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // The form is mounted only while the popup is open, so two buttons on a page never duplicate its field ids.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          'inline-flex min-h-12 items-center justify-center rounded-pill px-6 font-bold transition-colors motion-reduce:transition-none',
          variant === 'ember'
            ? 'bg-ember-soft text-white'
            : 'border border-line-strong bg-surface-2 text-ink hover:border-ember',
          className,
        )}
      >
        {label}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        className="m-auto max-h-[92dvh] w-[min(92vw,56rem)] overflow-y-auto rounded-[32px] border border-line bg-surface p-0 text-ink backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <div className="flex flex-col gap-5 p-6 md:p-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h2
                id={titleId}
                className="m-0 font-display text-[clamp(1.5rem,3vw,2.2rem)] leading-tight font-black uppercase"
              >
                {t(mode === 'demo' ? 'demoTitle' : 'title')}
              </h2>
              <p className="m-0 text-body text-ink-2">{t(mode === 'demo' ? 'demoLede' : 'lede')}</p>
            </div>
            <button
              type="button"
              aria-label={t('close')}
              onClick={() => ref.current?.close()}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line hover:border-ember"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          {open ? (
            <ApplyForm action={action} humanCheck={humanCheck} initialMode={mode} initialPlan="enterprise" />
          ) : null}
        </div>
      </dialog>
    </>
  );
}
