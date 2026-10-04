'use client';

import { SLACK_ALERT_SEVERITIES } from '@yayatoh/integrations/client';
import { Alert, Button, Card, Checkbox, Select, Switch, TimePicker } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { SlackFormState } from '../slack-actions.ts';

export interface SlackChannelOption {
  readonly id: string;
  readonly name: string;
  readonly isPrivate: boolean;
  readonly isMember: boolean;
}

/**
 * Slack settings (M6.4c): the channel (from the workspace, through the port), alerts at or above
 * a severity, and the daily digest at a local time in the org's zone. Amounts in the digest are
 * offered only to the connection's owner with finance access. Server validation owns the messages.
 */
export function SlackSettingsForm({
  channels,
  initial,
  timeZone,
  financeAllowed,
  canManage,
  primary,
  action,
}: {
  channels: readonly SlackChannelOption[];
  initial: {
    channelId: string | null;
    alertsEnabled: boolean;
    alertMinSeverity: string;
    digestEnabled: boolean;
    digestTime: string;
    includeFinance: boolean;
  };
  timeZone: string;
  financeAllowed: boolean;
  canManage: boolean;
  /** Save is the screen's one primary action until a channel is chosen. */
  primary: boolean;
  action: (prev: SlackFormState, form: FormData) => Promise<SlackFormState>;
}) {
  const t = useTranslations('integrations.slack');
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as SlackFormState);
  const [channel, setChannel] = useState(initial.channelId ?? '');
  const [alerts, setAlerts] = useState(initial.alertsEnabled);
  const [severity, setSeverity] = useState(initial.alertMinSeverity);
  const [digest, setDigest] = useState(initial.digestEnabled);
  const [time, setTime] = useState(initial.digestTime);
  const [finance, setFinance] = useState(initial.includeFinance);
  const fieldError = (name: string) => {
    const code = state.status === 'error' ? state.fields?.[name] : undefined;
    if (!code) return undefined;
    return t.has(`fieldError.${name}.${code}`) ? t(`fieldError.${name}.${code}`) : t('fieldError.invalid');
  };
  const general =
    state.status === 'error' && !state.fields
      ? t.has(`error.${state.code}`)
        ? t(`error.${state.code}`)
        : t('error.internal')
      : null;
  return (
    <Card className="flex flex-col gap-4">
      <h3 id="slack-settings-heading" className="m-0 text-section">
        {t('settingsTitle')}
      </h3>
      <div aria-live="polite" className="empty:hidden">
        {state.status === 'saved' ? <Alert tone="success" title={t('saved')} /> : null}
        {state.status === 'error' && state.fields ? <Alert tone="danger" title={t('invalid')} /> : null}
        {general ? <Alert tone="danger" title={general} /> : null}
      </div>
      <form
        action={formAction}
        noValidate
        aria-labelledby="slack-settings-heading"
        className="flex flex-col gap-4"
      >
        <fieldset disabled={!canManage} className="m-0 flex flex-col gap-4 border-0 p-0">
          <Select
            id="slack-channel"
            name="channel"
            label={t('channel')}
            hint={t('channelHint')}
            value={channel}
            onValueChange={setChannel}
            placeholder={t('channelPlaceholder')}
            error={fieldError('channel')}
            required
          >
            <option value="" hidden>
              {t('channelPlaceholder')}
            </option>
            {channels.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.isMember}>
                {`#${c.name}`}
                {c.isPrivate ? ` · ${t('private')}` : ''}
                {!c.isMember ? ` · ${t('notInChannel')}` : ''}
              </option>
            ))}
          </Select>
          <Switch
            id="slack-alerts"
            name="alerts"
            label={t('alerts')}
            hint={t('alertsHint')}
            checked={alerts}
            onChange={(e) => setAlerts(e.target.checked)}
          />
          {alerts ? (
            <Select
              id="slack-severity"
              name="severity"
              label={t('severity')}
              value={severity}
              onValueChange={setSeverity}
              error={fieldError('severity')}
            >
              {SLACK_ALERT_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`severities.${s}`)}
                </option>
              ))}
            </Select>
          ) : (
            <input type="hidden" name="severity" value={severity} />
          )}
          <Switch
            id="slack-digest"
            name="digest"
            label={t('digest')}
            hint={t('digestHint')}
            checked={digest}
            onChange={(e) => setDigest(e.target.checked)}
          />
          {digest ? (
            <TimePicker
              id="slack-digest-time"
              name="digestTime"
              label={t('digestTime')}
              hint={t('digestTimeHint', { zone: timeZone })}
              value={time}
              onValueChange={setTime}
              minuteStep={15}
              timeZone={timeZone}
              error={fieldError('digestTime')}
              required
            />
          ) : (
            <input type="hidden" name="digestTime" value={time} />
          )}
          {financeAllowed || initial.includeFinance ? (
            <Checkbox
              id="slack-finance"
              name="finance"
              label={t('finance')}
              hint={fieldError('finance') ?? t('financeHint')}
              checked={finance}
              onChange={(e) => setFinance(e.target.checked)}
              disabled={!financeAllowed && !finance}
            />
          ) : (
            <p className="m-0 text-caption text-ink-2">{t('noAmounts')}</p>
          )}
        </fieldset>
        {canManage ? (
          <div>
            <Button type="submit" variant={primary ? 'primary' : 'secondary'} disabled={pending}>
              {t('save')}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
