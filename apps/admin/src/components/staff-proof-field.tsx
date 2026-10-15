import type { StepUpMethod } from '@yayatoh/auth';
import { getTranslations } from 'next-intl/server';

/** "Confirm it's you" inside a staff form: a current authenticator code, else the password. */
export async function StaffProofField({ id, method }: { id: string; method: StepUpMethod }) {
  const t = await getTranslations('staffProof');
  if (method === 'email') return <p className="text-caption text-ink-2">{t('method')}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        {method === 'totp' ? t('code') : t('password')}
      </label>
      {method === 'totp' ? (
        <input
          id={id}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          className="field max-w-xs"
        />
      ) : (
        <input
          id={id}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field max-w-xs"
        />
      )}
    </div>
  );
}
