'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import type { SandboxState } from '@/app/[locale]/o/[org]/(org)/sandboxes/actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useStepUpActionState } from './step-up.tsx';

/** Create a sandbox org (M6.3a): a name, then a link to open it. Server validation owns the messages. */
export function SandboxForm({
  action,
  max,
}: {
  action: (prev: SandboxState, form: FormData) => Promise<SandboxState>;
  max: number;
}) {
  const t = useTranslations();
  const [state, formAction, pending, formRef] = useStepUpActionState(action, {
    kind: 'idle',
  } as SandboxState);
  const nameInvalid = state.kind === 'error' && state.fields.includes('name');
  const reasonKey =
    state.kind === 'error' && state.reason === 'sandbox_limit'
      ? 'sandboxes.limit'
      : state.kind === 'error' && state.reason === 'sandbox_of_sandbox'
        ? 'sandboxes.sandboxOfSandbox'
        : null;
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-section">{t('sandboxes.createTitle')}</h2>
      <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
        <Input
          name="name"
          maxLength={60}
          autoComplete="off"
          label={t('sandboxes.name')}
          hint={t('sandboxes.nameHint')}
          error={nameInvalid ? t('sandboxes.nameRequired') : undefined}
        />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t('sandboxes.creating') : t('sandboxes.create')}
          </Button>
        </div>
      </form>
      <div aria-live="polite" className="flex flex-col gap-2">
        {state.kind === 'created' ? (
          <div className="flex flex-col gap-2 rounded-card border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-body font-medium">{t('sandboxes.created', { name: state.name })}</p>
            <Link href={`/o/${state.slug}`} className="text-body underline underline-offset-2">
              {t('sandboxes.open', { name: state.name })}
            </Link>
          </div>
        ) : state.kind === 'error' && !nameInvalid ? (
          <Alert title={reasonKey ? t(reasonKey, { max }) : t(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </Card>
  );
}
