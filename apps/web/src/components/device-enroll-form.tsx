'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { EnrollState } from '@/app/[locale]/o/[org]/e/[event]/onsite/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export function DeviceEnrollForm({
  action,
}: {
  action: (prev: EnrollState, form: FormData) => Promise<EnrollState>;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { kind: 'idle' });
  return (
    <Card className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Input
            name="label"
            required
            maxLength={60}
            label={t('devices.label')}
            hint={t('devices.labelHint')}
          />
        </div>
        <Button type="submit" disabled={pending}>
          {t('devices.add')}
        </Button>
      </form>
      <div aria-live="polite">
        {state.kind === 'enrolled' ? (
          <div className="flex flex-col gap-2 rounded-card border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-body">{t('devices.tokenOnce', { label: state.label })}</p>
            <code className="break-all rounded-card bg-white px-3 py-2 font-mono text-caption">
              {state.token}
            </code>
          </div>
        ) : state.kind === 'error' ? (
          <Alert title={t(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </Card>
  );
}
