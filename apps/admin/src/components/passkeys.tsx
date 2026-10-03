'use client';

import { staffAuthClient } from '@yayatoh/auth/passkey-client';
import { Alert, Button, Input } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useActionState, useState } from 'react';
import { deletePasskeyAction } from '@/app/security/actions.ts';

/** The staff member's passkeys: add one (the browser's own dialog), list, remove. */
export function PasskeyManager({
  passkeys,
}: {
  passkeys: readonly { id: string; name: string; createdAt: string }[];
}) {
  const t = useTranslations('passkeys');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [removed, remove, removing] = useActionState(deletePasskeyAction, { code: null });
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '')
      .trim()
      .slice(0, 60);
    setBusy(true);
    setMessage(null);
    try {
      const res = await staffAuthClient.passkey.addPasskey({ name: name || undefined });
      if (res?.error) {
        const fresh = res.error.status === 403 || /fresh/i.test(String(res.error.message ?? ''));
        return setMessage({ tone: 'error', text: fresh ? t('notFresh') : t('addFailed') });
      }
      setMessage({ tone: 'info', text: t('added') });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const shown =
    message ?? (removed.code === 'deleted' ? { tone: 'info' as const, text: t('deleted') } : null);
  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite">
        {shown ? <Alert tone={shown.tone === 'info' ? 'info' : undefined} title={shown.text} /> : null}
      </div>
      {passkeys.length === 0 ? (
        <p className="text-body text-ink-2">{t('none')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {passkeys.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
            >
              <div className="flex flex-col">
                <span className="text-body">{p.name}</span>
                {p.createdAt ? (
                  <span className="text-caption text-ink-2">{t('added_on', { date: p.createdAt })}</span>
                ) : null}
              </div>
              <form action={remove}>
                <input type="hidden" name="id" value={p.id} />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={removing}
                  aria-label={t('removeNamed', { name: p.name })}
                >
                  {t('remove')}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input name="name" label={t('nameLabel')} hint={t('nameHint')} maxLength={60} />
        </div>
        <Button type="submit" disabled={busy}>
          {t('add')}
        </Button>
      </form>
    </div>
  );
}
