import { useQueryClient } from '@tanstack/react-query';
import { YayatohApiError } from '@yayatoh/sdk';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { AssistanceAction, AssistanceRequest, StaffAssistanceReason } from '../api';
import { useTools } from '../deps';
import { toolKeys, useAssistanceQueue } from '../queries';
import {
  Body,
  Button,
  Card,
  Chip,
  Columns,
  Empty,
  ErrorState,
  Field,
  Heading,
  Loading,
  Notice,
  Pane,
  Row,
  Screen,
} from '../ui';

const STAFF_REASONS: readonly StaffAssistanceReason[] = [
  'backup',
  'supervisor',
  'medical',
  'security',
  'device',
];

/** The help-request queue of the device's event: claim, work and resolve requests, or ask for backup (M7.4c). */
export function AssistanceScreen() {
  const t = useTranslations('tools');
  const core = useTranslations('core');
  const { device, staff } = useTools();
  const queue = useAssistanceQueue();
  const qc = useQueryClient();
  const [note, setNote] = useState<'changed' | 'failed' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function work(request: AssistanceRequest, action: AssistanceAction) {
    if (!staff || !device) return;
    setBusy(request.id);
    setNote(null);
    try {
      await staff.workAssistance({ eventId: device.eventId, requestId: request.id, action });
    } catch (err) {
      setNote(err instanceof YayatohApiError && err.status === 409 ? 'changed' : 'failed');
    } finally {
      setBusy(null);
      await qc.invalidateQueries({ queryKey: toolKeys.assistance(device.eventId) });
    }
  }

  if (!device)
    return (
      <Screen>
        <Empty title={t('hub.none')} />
      </Screen>
    );

  return (
    <Screen testID="assistance-screen">
      <Columns>
        <Pane>
          <Heading>{t('nav.assistance')}</Heading>
          {note ? (
            <Notice tone="warn" testID="assistance-note">
              {note === 'changed' ? t('assistance.changed') : t('assistance.actionFailed')}
            </Notice>
          ) : null}
          {queue.isPending ? <Loading label={t('nav.assistance')} /> : null}
          {queue.isError ? (
            <ErrorState
              message={t('assistance.loadFailed')}
              retryLabel={core('common.retry')}
              onRetry={() => queue.refetch()}
            />
          ) : null}
          {queue.data && queue.data.length === 0 ? (
            <Empty title={t('assistance.empty')} body={t('assistance.emptyBody')} />
          ) : null}
          {queue.data?.map((r) => (
            <RequestCard key={r.id} request={r} busy={busy === r.id} onAction={(a) => work(r, a)} />
          ))}
        </Pane>
        <Pane>
          <RaiseForm />
        </Pane>
      </Columns>
    </Screen>
  );
}

function RequestCard({
  request: r,
  busy,
  onAction,
}: {
  request: AssistanceRequest;
  busy: boolean;
  onAction: (a: AssistanceAction) => void;
}) {
  const t = useTranslations('tools');
  const open = r.state !== 'resolved' && r.state !== 'cancelled';
  const canTake = open && !r.mine;
  const canStart = r.mine && r.state === 'assigned';
  const canResolve = r.mine && (r.state === 'assigned' || r.state === 'in_progress');
  return (
    <Card testID={`request-${r.number}`}>
      <Heading level={2}>{t('assistance.number', { number: r.number })}</Heading>
      <Body>
        {t(`assistance.reason.${r.reason}`)} · {t(`assistance.priority.${r.priority}`)} ·{' '}
        {t(`assistance.state.${r.state}`)}
      </Body>
      {r.overdue ? <Notice tone="warn">{t('assistance.overdue')}</Notice> : null}
      {r.mine ? <Notice tone="info">{t('assistance.mine')}</Notice> : null}
      {r.note ? <Body>{r.note}</Body> : null}
      {r.guest ? <Body muted>{t('assistance.guest', { name: r.guest.name })}</Body> : null}
      {r.location ? <Body muted>{t('assistance.where', { location: r.location })}</Body> : null}
      <Row>
        {canTake ? (
          <Button
            label={t('assistance.take')}
            a11yLabel={t('assistance.takeFor', { number: r.number })}
            onPress={() => onAction('take')}
            busy={busy}
            testID={`take-${r.number}`}
          />
        ) : null}
        {canStart ? (
          <Button
            label={t('assistance.start')}
            a11yLabel={t('assistance.startFor', { number: r.number })}
            onPress={() => onAction('start')}
            busy={busy}
            testID={`start-${r.number}`}
          />
        ) : null}
        {canResolve ? (
          <Button
            label={t('assistance.resolve')}
            a11yLabel={t('assistance.resolveFor', { number: r.number })}
            onPress={() => onAction('resolve')}
            busy={busy}
            testID={`resolve-${r.number}`}
          />
        ) : null}
        {r.mine && open ? (
          <Button
            label={t('assistance.cancel')}
            a11yLabel={t('assistance.cancelFor', { number: r.number })}
            onPress={() => onAction('cancel')}
            variant="danger"
            busy={busy}
            testID={`cancel-${r.number}`}
          />
        ) : null}
      </Row>
    </Card>
  );
}

function RaiseForm() {
  const t = useTranslations('tools');
  const { device, staff } = useTools();
  const qc = useQueryClient();
  const [reason, setReason] = useState<StaffAssistanceReason | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState(false);
  const [state, setState] = useState<{ kind: 'sent'; number: number } | { kind: 'failed' } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!reason) return setProblem(true);
    if (!staff || !device) return;
    setBusy(true);
    setState(null);
    try {
      const r = await staff.raiseAssistance({
        eventId: device.eventId,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        checkpointId: device.checkpointId,
      });
      setState({ kind: 'sent', number: r.number });
      setReason(null);
      setNote('');
      await qc.invalidateQueries({ queryKey: toolKeys.assistance(device.eventId) });
    } catch {
      setState({ kind: 'failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card testID="raise-form">
      <Heading level={2}>{t('assistance.raise.title')}</Heading>
      <Body>{t('assistance.raise.reasonLabel')}</Body>
      <Row>
        {STAFF_REASONS.map((r) => (
          <Chip
            key={r}
            label={t(`assistance.raise.reasons.${r}`)}
            selected={reason === r}
            onPress={() => {
              setReason(r);
              setProblem(false);
            }}
            testID={`raise-${r}`}
          />
        ))}
      </Row>
      {problem ? <Notice tone="stop">{t('assistance.raise.reasonMissing')}</Notice> : null}
      <Field
        label={t('assistance.raise.noteLabel')}
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
        testID="raise-note"
      />
      {state?.kind === 'sent' ? (
        <Notice tone="ok">{t('assistance.raise.sent', { number: state.number })}</Notice>
      ) : null}
      {state?.kind === 'failed' ? <Notice tone="stop">{t('assistance.raise.failed')}</Notice> : null}
      <Button label={t('assistance.raise.send')} onPress={send} busy={busy} testID="raise-send" />
    </Card>
  );
}
