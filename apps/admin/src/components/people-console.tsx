'use client';

import { Alert, Button, buttonClass, Card, Input } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import type { EraseState, ExportState, FindState } from '@/app/people/actions.ts';

const when = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

/**
 * Controller-side data-subject requests (M1.14e): find a person by email across platform-level
 * data, export their account data, or erase them with a written reason. Emails travel in POST
 * bodies only.
 */
export function PeopleConsole({
  find,
  exportData,
  erase,
}: {
  find: (prev: FindState, form: FormData) => Promise<FindState>;
  exportData: (prev: ExportState, form: FormData) => Promise<ExportState>;
  erase: (prev: EraseState, form: FormData) => Promise<EraseState>;
}) {
  const t = useTranslations('people');
  const [found, findAction, finding] = useActionState(find, { kind: 'idle' });
  const message = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.internal'));
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <h2 className="text-section">{t('find.title')}</h2>
        <p className="text-body text-ink-2">{t('find.hint')}</p>
        <form action={findAction} className="flex flex-col gap-3 sm:flex-row sm:items-start" noValidate>
          <div className="flex-1">
            <Input
              id="person-email"
              name="email"
              type="email"
              autoComplete="off"
              required
              maxLength={320}
              label={t('find.email')}
              error={found.kind === 'error' ? message(found.code) : undefined}
            />
          </div>
          <Button type="submit" disabled={finding} className="sm:mt-[22px]">
            {t('find.submit')}
          </Button>
        </form>
      </Card>
      {found.kind === 'found' ? (
        // A new search starts a new request: export and erase results belong to the previous one.
        <PersonResult key={found.nonce} found={found} exportData={exportData} erase={erase} />
      ) : null}
    </div>
  );
}

function PersonResult({
  found,
  exportData,
  erase,
}: {
  found: Extract<FindState, { kind: 'found' }>;
  exportData: (prev: ExportState, form: FormData) => Promise<ExportState>;
  erase: (prev: EraseState, form: FormData) => Promise<EraseState>;
}) {
  const t = useTranslations('people');
  const [exported, exportAction, exporting] = useActionState(exportData, { kind: 'idle' });
  const [erased, eraseAction, erasing] = useActionState(erase, { kind: 'idle' });
  const [href, setHref] = useState<string | null>(null);

  // The export arrives as JSON text: offer it as a file (an object URL, revoked when replaced).
  useEffect(() => {
    if (exported.kind !== 'ready') return setHref(null);
    const url = URL.createObjectURL(new Blob([exported.json], { type: 'application/json' }));
    setHref(url);
    return () => URL.revokeObjectURL(url);
  }, [exported]);

  const message = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.internal'));
  const person = found.person;
  const eraseError = erased.kind === 'error' ? erased : null;

  return (
    <div className="flex flex-col gap-4">
      {erased.kind !== 'erased' ? (
        found.found ? (
          <>
            <section aria-labelledby="person-result" className="flex flex-col gap-3">
              <Card className="flex flex-col gap-3">
                <h2 id="person-result" className="text-section">
                  {t('result.title', { email: person.email })}
                </h2>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2" data-testid="person-summary">
                  <Row label={t('result.account')}>
                    {person.account
                      ? t('result.accountSince', {
                          name: person.account.name || '—',
                          date: when.format(new Date(person.account.createdAt)),
                        })
                      : t('result.noAccount')}
                  </Row>
                  <Row label={t('result.staff')}>{person.staffRole ?? t('result.no')}</Row>
                  <Row label={t('result.twoFactor')}>
                    {person.account?.twoFactor ? t('result.yes') : t('result.no')}
                  </Row>
                  <Row label={t('result.sessions')}>{person.account?.sessions ?? 0}</Row>
                  <Row label={t('result.securityEvents')}>{person.account?.securityEvents ?? 0}</Row>
                  <Row label={t('result.orders')}>{person.orders}</Row>
                  <Row label={t('result.signupCodes')}>{person.signupCodes}</Row>
                  <Row label={t('result.deletedAccounts')}>{person.deletedAccounts}</Row>
                  <Row label={t('result.erasedList')}>
                    {person.erasedAt ? when.format(new Date(person.erasedAt)) : t('result.no')}
                  </Row>
                </dl>
                <h3 className="text-body font-medium">{t('result.memberships')}</h3>
                {person.memberships.length ? (
                  <ul className="flex list-disc flex-col gap-1 ps-5 text-body">
                    {person.memberships.map((m) => (
                      <li key={m.org}>{t('result.membership', { org: m.org, role: m.role })}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body text-ink-2">{t('result.none')}</p>
                )}
                <h3 className="text-body font-medium">{t('result.invitations')}</h3>
                {person.invitations.length ? (
                  <ul className="flex list-disc flex-col gap-1 ps-5 text-body">
                    {person.invitations.map((i, n) => (
                      <li key={`${i.org}-${n}`}>
                        {t('result.invitation', { org: i.org, role: i.role, status: i.status })}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body text-ink-2">{t('result.none')}</p>
                )}
                <History person={person} />
              </Card>
            </section>

            <Card className="flex flex-col gap-3">
              <h2 className="text-section">{t('export.title')}</h2>
              <p className="text-body text-ink-2">{t('export.hint')}</p>
              <form action={exportAction} className="flex flex-col gap-3" noValidate>
                <input type="hidden" name="email" value={person.email} />
                <Input
                  id="export-reason"
                  name="reason"
                  autoComplete="off"
                  required
                  maxLength={500}
                  label={t('export.reason')}
                  hint={t('reasonHint')}
                  error={exported.kind === 'error' ? message(exported.code) : undefined}
                />
                <Button type="submit" variant="secondary" disabled={exporting} className="self-start">
                  {t('export.submit')}
                </Button>
              </form>
              <div aria-live="polite">
                {exported.kind === 'ready' && href ? (
                  <a
                    href={href}
                    download={exported.fileName}
                    className={buttonClass('primary', 'sm', 'self-start')}
                  >
                    {t('export.download')}
                  </a>
                ) : null}
              </div>
            </Card>

            <Card className="flex flex-col gap-3 border-danger">
              <h2 className="text-section">{t('erase.title')}</h2>
              <ul className="flex list-disc flex-col gap-1 ps-5 text-body text-ink-2">
                <li>{t('erase.what')}</li>
                <li>{t('erase.kept')}</li>
                <li>{t('erase.suppression')}</li>
                <li>{t('erase.final')}</li>
              </ul>
              {eraseError?.code === 'last_owner' ? (
                <Alert title={t('errors.last_owner')}>
                  <ul className="flex list-disc flex-col gap-0.5 ps-5">
                    {(eraseError.orgs ?? []).map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>
                </Alert>
              ) : eraseError && !eraseError.field && eraseError.code !== 'invalid_email' ? (
                <Alert title={message(eraseError.code)} />
              ) : null}
              <form action={eraseAction} className="flex flex-col gap-3" noValidate>
                <input type="hidden" name="email" value={person.email} />
                <Input
                  id="erase-reason"
                  name="reason"
                  autoComplete="off"
                  required
                  maxLength={500}
                  label={t('erase.reason')}
                  hint={t('reasonHint')}
                  error={eraseError?.field === 'reason' ? message(eraseError.code) : undefined}
                />
                <Input
                  id="erase-confirm"
                  name="confirm"
                  type="email"
                  autoComplete="off"
                  required
                  maxLength={320}
                  label={t('erase.confirm', { email: person.email })}
                  error={eraseError?.field === 'confirm' ? message(eraseError.code) : undefined}
                />
                <Button type="submit" disabled={erasing} className="self-start">
                  {t('erase.submit')}
                </Button>
              </form>
            </Card>
          </>
        ) : (
          <Card className="flex flex-col gap-3">
            <p className="text-body" role="status">
              {t('result.nothing')}
            </p>
            {person.erasedAt ? (
              <p className="text-body">
                {t('result.erasedSince', { date: when.format(new Date(person.erasedAt)) })}
              </p>
            ) : null}
            <History person={person} />
          </Card>
        )
      ) : null}

      <div aria-live="polite">
        {erased.kind === 'erased' ? (
          <p
            role="status"
            className="rounded-card border border-success bg-surface px-4 py-3 text-body"
            data-testid="person-erased"
          >
            {t('erase.done', {
              orgs: erased.summary.organizations ?? 0,
              sessions: erased.summary.sessions ?? 0,
              id: erased.requestId,
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Earlier requests about this address (masked record: kind, who, when, the staff reason). */
function History({ person }: { person: Extract<FindState, { kind: 'found' }>['person'] }) {
  const t = useTranslations('people');
  return (
    <>
      <h3 className="text-body font-medium">{t('result.requests')}</h3>
      {person.requests.length ? (
        <ul className="flex list-disc flex-col gap-1 ps-5 text-body" data-testid="person-requests">
          {person.requests.map((r, n) => (
            <li key={`${r.actor}-${n}`}>
              {t('result.request', {
                kind: t(`result.kinds.${r.kind === 'erasure' ? 'erasure' : 'access'}`),
                actor: r.actor === 'self' ? t('result.self') : r.actor,
                date: when.format(new Date(r.at)),
              })}
              {r.reason ? <span className="text-ink-2"> · {r.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-2">{t('result.none')}</p>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1">
      <dt className="text-body text-ink-2">{label}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}
