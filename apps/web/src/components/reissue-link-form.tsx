'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { ReissueState } from '@/app/[locale]/o/[org]/e/[event]/orders/[orderId]/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/**
 * "Revoke and reissue link" (M1.5f): a second, explicit confirmation before the buyer's current
 * link stops working; then the new link goes out by email.
 */
export function ReissueLinkForm({
  action,
  email,
}: {
  action: (prev: ReissueState, form: FormData) => Promise<ReissueState>;
  email: string;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null });
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {confirming && !state.ok ? (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="confirm" value="yes" />
          <p className="text-body">{t('orderLinks.reissueConfirm', { email })}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {t('orderLinks.reissueYes')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t('orderLinks.reissueCancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            {t('orderLinks.reissue')}
          </Button>
        </div>
      )}
      <div aria-live="polite">
        {state.ok ? <Alert tone="info" title={t('orderLinks.reissued', { email })} /> : null}
        {state.code ? <Alert title={t(errorMessageKey(state.code))} /> : null}
      </div>
    </div>
  );
}
