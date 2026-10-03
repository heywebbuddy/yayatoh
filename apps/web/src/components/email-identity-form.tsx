'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import type { IdentityFormState } from '@/app/[locale]/o/[org]/(org)/sending/actions.ts';

/**
 * U10 "Email sending": From name and Reply-To, with the inbox preview ("Harbor Arts
 * <notifications@…>") updating as the organizer types, inline errors per field and a saved notice.
 */
export function EmailIdentityForm({
  action,
  fromName,
  replyTo,
  orgName,
  fromAddress,
  canEdit,
}: {
  action: (prev: IdentityFormState, form: FormData) => Promise<IdentityFormState>;
  fromName: string | null;
  replyTo: string | null;
  orgName: string;
  fromAddress: string;
  canEdit: boolean;
}) {
  const t = useTranslations('emailIdentity');
  const [state, formAction, pending] = useActionState(action, { ok: false, code: null } as IdentityFormState);
  const [name, setName] = useState(fromName ?? '');
  const [reply, setReply] = useState(replyTo ?? '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (state.ok) setDirty(false);
  }, [state]);
  const shownName = name.trim() || orgName;
  return (
    <form
      action={formAction}
      noValidate
      aria-label={t('formLabel')}
      onChange={() => setDirty(true)}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          id="email-from-name"
          name="fromName"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          disabled={!canEdit}
          placeholder={orgName}
          label={t('fromName')}
          hint={t('fromNameHint', { org: orgName })}
          error={state.fromName ? t(`errors.${state.fromName}`) : undefined}
        />
        <Input
          id="email-reply-to"
          name="replyTo"
          type="email"
          inputMode="email"
          dir="ltr"
          maxLength={254}
          value={reply}
          onChange={(e) => setReply(e.currentTarget.value)}
          disabled={!canEdit}
          label={t('replyTo')}
          hint={t('replyToHint')}
          error={state.replyTo ? t(`errors.${state.replyTo}`) : undefined}
        />
      </div>
      <div className="rounded-card border border-line bg-surface-2 p-4">
        <p className="text-caption font-bold text-ink-2">{t('previewTitle')}</p>
        <p className="text-body">
          <span className="font-semibold">{shownName}</span>{' '}
          <span dir="ltr" className="font-mono text-caption text-ink-2">
            &lt;{fromAddress}&gt;
          </span>
        </p>
        <p className="text-caption text-ink-2">
          {reply.trim()
            ? t('previewReplyTo', { address: reply.trim().toLowerCase() })
            : t('previewNoReplyTo')}
        </p>
      </div>
      <div aria-live="polite">
        {state.ok && !dirty ? (
          <Alert tone="success" title={t('saved')} />
        ) : state.code === 'invalid' ? (
          <Alert title={t('fixErrors')} />
        ) : state.code ? (
          <Alert title={t(`done.${state.code}`)} />
        ) : null}
      </div>
      {canEdit ? (
        <Button type="submit" disabled={pending} className="self-start">
          {t('save')}
        </Button>
      ) : (
        <p className="text-caption text-ink-2">{t('readOnly')}</p>
      )}
    </form>
  );
}
