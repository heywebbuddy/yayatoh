import { Alert, Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Shell } from '@/components/shell.tsx';
import { SignupCodeForm } from '@/components/signup-code-form.tsx';
import { listSignupCodes } from '@/server/signup-codes.ts';
import { requireStaff } from '@/server/staff.ts';
import { revokeSignupCodeAction } from './actions.ts';

const DOT = { active: 'success', used_up: 'neutral', expired: 'neutral', revoked: 'danger' } as const;

/**
 * Invite-only signup codes (M1.3b, screen M1.3f): create one (shown once), see how many uses are
 * left and until when, and revoke it. The worker CLI keeps working for scripted use.
 */
export default async function SignupCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requireStaff('signupCodes');
  const { done } = await searchParams;
  const t = await getTranslations('signupCodes');
  const rows = await listSignupCodes(staff);
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
  return (
    <Shell staff={staff}>
      <PageHeader title={t('title')} description={t('description')} />
      <div aria-live="polite">
        {done === 'revoked' || done === 'already_revoked' ? (
          <Alert tone="info" title={t(`done.${done}`)} />
        ) : null}
      </div>
      <Card>
        <SignupCodeForm />
      </Card>
      <Card className="p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-body text-zinc-600">{t('empty')}</p>
        ) : (
          // Scrollable on narrow screens: focusable and named so keyboard users can scroll it.
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable (axe scrollable-region-focusable)
          <section className="overflow-x-auto" tabIndex={0} aria-label={t('list')}>
            <table className="w-full text-start text-body">
              <caption className="sr-only">{t('list')}</caption>
              <thead className="text-caption text-zinc-500">
                <tr>
                  {(['note', 'state', 'usesLeft', 'expires', 'createdBy', 'actions'] as const).map((c) => (
                    <th key={c} scope="col" className="px-4 py-2 text-start font-normal">
                      {t(`col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="px-4 py-2">{r.note || t('noNote')}</td>
                    <td className="px-4 py-2">
                      <StatusDot status={DOT[r.state]} label={t(`state.${r.state}`)} />
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {t('usesLeft', { left: r.usesLeft, max: r.maxUses })}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{date.format(r.expiresAt)}</td>
                    <td className="px-4 py-2">
                      {r.createdBy}
                      <span className="block text-caption text-zinc-500">{date.format(r.createdAt)}</span>
                    </td>
                    <td className="px-4 py-2">
                      {r.revokedAt ? (
                        <span className="text-caption text-zinc-600">
                          {t('revokedBy', { who: r.revokedBy ?? '', date: date.format(r.revokedAt) })}
                        </span>
                      ) : r.state === 'active' ? (
                        <form action={revokeSignupCodeAction.bind(null, r.id)}>
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            aria-label={t('revokeFor', { note: r.note || t('noNote') })}
                          >
                            {t('revoke')}
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </Card>
    </Shell>
  );
}
