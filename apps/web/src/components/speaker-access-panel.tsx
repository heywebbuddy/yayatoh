import type { PortalAccountDto } from '@yayatoh/events';
import { StatusDot } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import {
  inviteSpeakerAction,
  revokeSpeakerAccessAction,
} from '@/app/[locale]/o/[org]/e/[event]/speakers/portal-actions.ts';
import { ActionButtonForm } from '@/components/portal-admin-forms.tsx';
import { ProgramForm } from '@/components/program-form.tsx';

const TONE = { invited: 'info', active: 'success', revoked: 'neutral', expired: 'neutral' } as const;

/**
 * A speaker's portal access (M5.3a, P5-7): who is invited and their state; organizers invite (or
 * re-invite, which reissues the link) and remove access. Viewers see the list only.
 */
export async function SpeakerAccessPanel({
  org,
  event,
  speakerId,
  speakerName,
  accounts,
  canWrite,
}: {
  org: string;
  event: string;
  speakerId: string;
  speakerName: string;
  accounts: readonly PortalAccountDto[];
  canWrite: boolean;
}) {
  const t = await getTranslations('speakerAccess');
  return (
    <section
      aria-label={t('headingNamed', { name: speakerName })}
      className="flex flex-col gap-2 border-t border-zinc-100 pt-2"
    >
      <h4 className="text-caption font-medium text-zinc-700">{t('heading')}</h4>
      {accounts.length === 0 ? (
        <p className="text-caption text-zinc-500">{t('none')}</p>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3">
              <span className="text-body">{a.email}</span>
              <StatusDot status={TONE[a.status]} label={t(`status.${a.status}`)} />
              {canWrite && (a.status === 'invited' || a.status === 'active') ? (
                <ActionButtonForm
                  action={revokeSpeakerAccessAction.bind(null, org, event, a.id)}
                  label={t('revoke', { email: a.email })}
                  successLabel={t('revoked')}
                  variant="ghost"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <ProgramForm
          action={inviteSpeakerAction.bind(null, org, event, speakerId)}
          idPrefix={`invite-${speakerId}`}
          submitLabel={t('invite')}
          successLabel={t('invited')}
          errors={{ email: t('emailInvalid'), event_over: t('eventOver') }}
          reset
          fields={[
            {
              kind: 'text',
              name: 'email',
              label: t('emailNamed', { name: speakerName }),
              required: true,
              maxLength: 254,
            },
          ]}
        />
      ) : null}
    </section>
  );
}
