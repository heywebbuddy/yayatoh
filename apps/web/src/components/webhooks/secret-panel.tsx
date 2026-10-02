'use client';

import { Alert, Button, Card } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { SecretState } from '@/app/[locale]/o/[org]/(org)/webhooks/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useStepUpActionState } from '../step-up.tsx';

/**
 * The endpoint's signing secret (M6.3b): shown on request (audited), copyable, and rotated with
 * step-up. After a rotation the old secret keeps signing alongside the new one for 24 hours.
 */
export function SecretPanel({
  reveal,
  rotate,
}: {
  reveal: () => Promise<SecretState>;
  rotate: (prev: SecretState, form: FormData) => Promise<SecretState>;
}) {
  const t = useTranslations('webhooks');
  const te = useTranslations();
  const [shown, setShown] = useState<SecretState>({ kind: 'idle' });
  const [revealing, startReveal] = useTransition();
  const [copied, setCopied] = useState(false);
  const [rotated, rotateAction, rotating, formRef] = useStepUpActionState(
    async (prev: SecretState, form: FormData) => {
      const r = await rotate(prev, form);
      if (r.kind === 'rotated') setShown({ kind: 'idle' });
      return r;
    },
    { kind: 'idle' } as SecretState,
  );
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-section">{t('secretTitle')}</h2>
      <p className="text-body text-zinc-600">{t('secretHint')}</p>
      {shown.kind === 'shown' ? (
        <div className="flex flex-col gap-2">
          <code
            data-testid="webhook-secret"
            className="break-all rounded-card bg-zinc-50 px-3 py-2 font-mono text-caption"
          >
            {shown.secret}
          </code>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => copy(shown.secret)}>
              {t('copy')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShown({ kind: 'idle' })}>
              {t('hideSecret')}
            </Button>
            <span role="status" className="text-caption text-zinc-600">
              {copied ? t('copied') : ''}
            </span>
          </div>
        </div>
      ) : (
        <div>
          <Button
            variant="secondary"
            disabled={revealing}
            onClick={() =>
              startReveal(async () => {
                setCopied(false);
                setShown(await reveal());
              })
            }
          >
            {t('revealSecret')}
          </Button>
        </div>
      )}
      <form ref={formRef} action={rotateAction} className="flex flex-col gap-2">
        <p className="text-caption text-zinc-600">{t('rotateHint')}</p>
        <div>
          <Button type="submit" variant="secondary" disabled={rotating}>
            {t('rotateSecret')}
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {rotated.kind === 'rotated' ? (
          <p role="status" className="text-body font-medium">
            {t('rotatedSecret')}
          </p>
        ) : null}
        {shown.kind === 'error' ? <Alert title={te(errorMessageKey(shown.code))} /> : null}
        {rotated.kind === 'error' ? <Alert title={te(errorMessageKey(rotated.code))} /> : null}
      </div>
    </Card>
  );
}
