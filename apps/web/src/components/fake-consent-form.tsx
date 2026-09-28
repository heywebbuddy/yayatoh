import { Alert, Button, Input } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { localizedPath } from '@/lib/seo/urls.ts';

export interface FakeConsentParams {
  readonly provider: 'google' | 'apple';
  readonly state: string;
  readonly nonce: string;
  readonly redirectUri: string;
}

/**
 * The fake provider's consent form (M1.2f): who is signing in, and the provider's claims about
 * them. A plain form POST (like a real provider's page on its own origin).
 */
export async function FakeConsentForm({
  params,
  locale,
  error,
  name,
}: {
  params: FakeConsentParams;
  locale: string;
  error: 'email_required' | null;
  name: string;
}) {
  const t = await getTranslations('fakeSocial');
  return (
    <form
      method="post"
      action={localizedPath(locale, '/auth/social/fake/answer')}
      className="flex flex-col gap-4"
      noValidate
    >
      <input type="hidden" name="provider" value={params.provider} />
      <input type="hidden" name="state" value={params.state} />
      <input type="hidden" name="nonce" value={params.nonce} />
      <input type="hidden" name="redirect_uri" value={params.redirectUri} />
      {error ? <Alert title={t(`errors.${error}`)} /> : null}
      <Input
        name="email"
        type="email"
        autoComplete="email"
        label={t('email')}
        error={error === 'email_required' ? t('errors.email_required') : undefined}
      />
      <Input name="name" autoComplete="name" label={t('name')} defaultValue={name} />
      <label className="flex min-h-6 items-center gap-2 text-body">
        <input type="checkbox" name="verified" value="yes" defaultChecked className="size-5" />
        {t('verified')}
      </label>
      {params.provider === 'apple' ? (
        <label className="flex min-h-6 items-center gap-2 text-body">
          <input type="checkbox" name="hide" value="yes" className="size-5" />
          {t('hideEmail')}
        </label>
      ) : null}
      <Button type="submit" name="answer" value="continue">
        {t('continue')}
      </Button>
      <Button type="submit" name="answer" value="cancel" variant="ghost">
        {t('cancel')}
      </Button>
    </form>
  );
}
