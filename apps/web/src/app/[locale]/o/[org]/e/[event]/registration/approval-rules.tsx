import type { TypeRulesDto } from '@yayatoh/registration';
import { Card } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { ProgramForm } from '@/components/program-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { importAudienceAction, replaceMembersAction, setTypeRulesAction } from './actions.ts';
import { MemberListForm } from './member-list-form.tsx';

/**
 * Applications, guests and substitution per type (M5.1c): whether a type is applied for (with
 * auto-approve domains and a member list), whether it is a +1 guest type (and how many guests a
 * host may bring), and when substitutions close. Viewers see the summary only.
 */
export async function ApprovalRules({
  org,
  event,
  types,
  rules,
  segments,
  canWrite,
}: {
  org: string;
  event: string;
  types: readonly { id: string; name: string }[];
  rules: readonly TypeRulesDto[];
  segments: readonly { id: string; name: string }[] | null;
  canWrite: boolean;
}) {
  const t = await getTranslations('registration.rules');
  const errors: Record<string, string> = {
    autoApproveDomains: t('errors.autoApproveDomains'),
    guest_no_approval: t('errors.guest_no_approval'),
    guestsPerHost: t('errors.guestsPerHost'),
    substitutionCutoffHours: t('errors.substitutionCutoffHours'),
    segmentId: t('errors.segmentId'),
    event_finished: t('errors.event_finished'),
  };
  return (
    <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
      <h2 id="rules-heading" className="text-section">
        {t('title')}
      </h2>
      <p className="text-body text-zinc-600">{t('hint')}</p>
      <Link
        href={`/o/${org}/e/${event}/registration/applications`}
        className="self-start text-body underline underline-offset-2"
      >
        {t('openQueue')}
      </Link>
      <ul className="flex list-none flex-col gap-3 p-0">
        {types.map((x) => {
          const r = rules.find((y) => y.registrationTypeId === x.id);
          if (!r) return null;
          return (
            <li key={x.id}>
              <Card className="flex flex-col gap-2">
                <h3 className="text-body font-medium">{x.name}</h3>
                <p className="text-caption text-zinc-600">
                  {r.kind === 'guest'
                    ? t('summaryGuest', { count: r.guestsPerHost })
                    : r.approval === 'manual'
                      ? t('summaryApproval', {
                          members: r.members,
                          domains: r.autoApproveDomains.length ? r.autoApproveDomains.join(', ') : t('none'),
                        })
                      : t('summaryOpen')}
                  {' · '}
                  {t('summaryCutoff', { hours: r.substitutionCutoffHours })}
                </p>
                {canWrite ? (
                  <details>
                    <summary className="min-h-6 cursor-pointer text-caption text-zinc-600">
                      {t('editNamed', { name: x.name })}
                    </summary>
                    <div className="flex flex-col gap-4 pt-3">
                      <ProgramForm
                        action={setTypeRulesAction.bind(null, org, event, x.id)}
                        fields={[
                          {
                            kind: 'select',
                            name: 'approval',
                            label: t('approval'),
                            options: [
                              { value: 'none', label: t('approvalNone') },
                              { value: 'manual', label: t('approvalManual') },
                            ],
                            defaultValue: r.approval,
                          },
                          {
                            kind: 'textarea',
                            name: 'autoApproveDomains',
                            label: t('autoApproveDomains'),
                            hint: t('autoApproveDomainsHint'),
                            rows: 2,
                            defaultValue: r.autoApproveDomains.join('\n'),
                          },
                          {
                            kind: 'select',
                            name: 'kind',
                            label: t('kind'),
                            options: [
                              { value: 'standard', label: t('kindStandard') },
                              { value: 'guest', label: t('kindGuest') },
                            ],
                            defaultValue: r.kind,
                          },
                          {
                            kind: 'number',
                            name: 'guestsPerHost',
                            label: t('guestsPerHost'),
                            hint: t('guestsPerHostHint'),
                            defaultValue: String(r.guestsPerHost),
                          },
                          {
                            kind: 'number',
                            name: 'substitutionCutoffHours',
                            label: t('cutoff'),
                            hint: t('cutoffHint'),
                            defaultValue: String(r.substitutionCutoffHours),
                          },
                        ]}
                        idPrefix={`rules-${x.id}`}
                        submitLabel={t('save')}
                        successLabel={t('saved')}
                        errors={errors}
                      />
                      {r.approval === 'manual' ? (
                        <>
                          <MemberListForm
                            action={replaceMembersAction.bind(null, org, event, x.id)}
                            idPrefix={`members-${x.id}`}
                            typeName={x.name}
                          />
                          {segments && segments.length > 0 ? (
                            <ProgramForm
                              action={importAudienceAction.bind(null, org, event, x.id)}
                              fields={[
                                {
                                  kind: 'select',
                                  name: 'segmentId',
                                  label: t('audience'),
                                  hint: t('audienceHint'),
                                  options: segments.map((s) => ({ value: s.id, label: s.name })),
                                },
                              ]}
                              idPrefix={`audience-${x.id}`}
                              submitLabel={t('audienceImport')}
                              successLabel={t('membersSaved')}
                              errors={errors}
                            />
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
