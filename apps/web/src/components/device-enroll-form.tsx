'use client';

import { Alert, Button, Card, Input } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { EnrollState } from '@/app/[locale]/o/[org]/e/[event]/onsite/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';

export function DeviceEnrollForm({
  eventId,
  action,
  staff,
}: {
  eventId: string;
  action: (prev: EnrollState, form: FormData) => Promise<EnrollState>;
  /** This event's door staff: a device handed to one scans only where they may. */
  staff: readonly { id: string; name: string }[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  // The key rides in the fragment (#…): browsers never send it to a server or a log.
  const setupLink = (token: string) =>
    `${window.location.origin}${locale === 'en' ? '' : `/${locale}`}/scan#e=${eventId}&k=${encodeURIComponent(token)}`;
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
        {staff.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="device-assigned" className="text-[13px] font-bold text-ink">
              {t('devices.handedTo')}
            </label>
            <select id="device-assigned" name="assignedUserId" defaultValue="" className="field">
              <option value="">{t('devices.orgDevice')}</option>
              {staff.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Button type="submit" disabled={pending}>
          {t('devices.add')}
        </Button>
      </form>
      <div aria-live="polite">
        {state.kind === 'enrolled' ? (
          <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-4">
            <p className="text-body">{t('devices.tokenOnce', { label: state.label })}</p>
            <code className="break-all rounded-card bg-surface px-3 py-2 font-mono text-caption">
              {state.token}
            </code>
            <p className="text-body">{t('devices.linkHint')}</p>
            <a
              href={setupLink(state.token)}
              className="break-all text-caption underline"
              data-testid="scan-link"
            >
              {t('devices.openScanner')}
            </a>
          </div>
        ) : state.kind === 'error' ? (
          <Alert title={t(errorMessageKey(state.code))} />
        ) : null}
      </div>
    </Card>
  );
}
