'use client';

import { Alert, Button, Card, Input, Textarea } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useId } from 'react';
import type { CancelState, EraseState, ExportState } from '@/app/[locale]/o/[org]/(org)/privacy/actions.ts';
import { usePrivacyError } from '@/components/privacy-console.tsx';
import { useStepUpActionState } from '@/components/step-up.tsx';

/** Fulfil an access request: build the signed archive (step-up). */
export function PrivacyExportForm({
  action,
}: {
  action: (prev: ExportState, form: FormData) => Promise<ExportState>;
}) {
  const t = useTranslations('privacy.request.export');
  const message = usePrivacyError();
  const [state, formAction, pending, formRef] = useStepUpActionState<ExportState>(action, { kind: 'idle' });
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-section">{t('title')}</h2>
      <p className="text-body text-ink-2">{t('hint')}</p>
      <form ref={formRef} action={formAction}>
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
      </form>
      <div aria-live="polite">{state.kind === 'error' ? <Alert title={message(state.code)} /> : null}</div>
    </Card>
  );
}

/** Fulfil an erasure request: the address typed again, step-up. */
export function PrivacyEraseForm({
  action,
  email,
}: {
  action: (prev: EraseState, form: FormData) => Promise<EraseState>;
  email: string;
}) {
  const t = useTranslations('privacy.request.erase');
  const message = usePrivacyError();
  const [state, formAction, pending, formRef] = useStepUpActionState<EraseState>(action, { kind: 'idle' });
  const confirmId = useId();
  return (
    <Card className="flex flex-col gap-3 border-danger">
      <h2 className="text-section">{t('title')}</h2>
      <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-ink-2">
        <li>{t('what')}</li>
        <li>{t('holds')}</li>
        <li>{t('files')}</li>
        <li>{t('final')}</li>
      </ul>
      <form ref={formRef} action={formAction} className="flex flex-col gap-3" noValidate>
        <Input
          id={confirmId}
          name="confirm"
          type="email"
          autoComplete="off"
          required
          label={t('confirm', { email })}
          error={state.kind === 'error' ? message(state.code) : undefined}
        />
        <Button type="submit" variant="danger" disabled={pending} className="self-start">
          {t('submit')}
        </Button>
      </form>
    </Card>
  );
}

/** Withdraw an open request, with a reason. */
export function PrivacyCancelForm({
  action,
}: {
  action: (prev: CancelState, form: FormData) => Promise<CancelState>;
}) {
  const t = useTranslations('privacy.request.cancel');
  const message = usePrivacyError();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  const id = useId();
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-section">{t('title')}</h2>
      <p className="text-body text-ink-2">{t('hint')}</p>
      <form action={formAction} className="flex flex-col gap-3" noValidate>
        <Textarea
          id={`${id}-reason`}
          name="reason"
          rows={2}
          maxLength={500}
          required
          label={t('reason')}
          error={state.kind === 'error' ? message(state.code) : undefined}
        />
        <Button type="submit" variant="secondary" disabled={pending} className="self-start">
          {t('submit')}
        </Button>
      </form>
    </Card>
  );
}
