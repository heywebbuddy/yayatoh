import { useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { useTools } from '../deps';
import {
  checkReason,
  MANUAL_REASONS,
  type ManualReason,
  type ManualResult,
  manualCheckIn,
  verdictTone,
} from '../manual-checkin';
import { Body, Button, Card, Chip, Field, Heading, Notice, Row } from '../ui';

/**
 * Manual check-in for one ticket holder (M7.4c): a reason is required, the note is required for
 * "another reason", and the verdict is shown in words and a tone glyph, not by colour alone.
 */
export function ManualCheckInPanel({
  shortCode,
  holderName,
  onClose,
}: {
  shortCode: string;
  holderName: string;
  onClose: (result: ManualResult | null) => void;
}) {
  const t = useTranslations('tools');
  const core = useTranslations('core');
  const format = useFormatter();
  const { device, staff, offlineCheckIn, vault, clock, newId, useOffline, feedback } = useTools();
  const offline = useOffline();
  const [reason, setReason] = useState<ManualReason | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<ManualResult | null>(null);
  // One key per attempt: tapping twice, or a retry after a lost answer, is the same check-in.
  const key = useRef<string | null>(null);

  async function confirm() {
    const checked = checkReason(reason, note);
    if (!checked.ok) return setProblem(checked.problem);
    if (!device) return;
    setProblem(null);
    setFailed(false);
    setBusy(true);
    key.current ??= newId();
    try {
      const r = await manualCheckIn(
        {
          api: staff,
          offline: offlineCheckIn,
          vault,
          eventId: device.eventId,
          checkpointId: device.checkpointId,
          now: clock.now,
          newKey: () => key.current as string,
          isOffline: () => offline,
        },
        { shortCode, reason: checked.text },
      );
      setResult(r);
      if (r.via !== 'none') {
        feedback?.(verdictTone(r.result));
        key.current = null;
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (result && result.via !== 'none') {
    const tone = verdictTone(result.result);
    return (
      <Card testID="manual-result">
        <Notice tone={tone} testID="manual-verdict">
          {t(`verdict.${result.result}`)}
        </Notice>
        <Body>{result.holderName ?? holderName}</Body>
        {result.firstAdmittedAt ? (
          <Body muted>
            {t('manual.firstAdmitted', {
              time: format.dateTime(new Date(result.firstAdmittedAt), { hour: 'numeric', minute: '2-digit' }),
            })}
          </Body>
        ) : null}
        {result.via === 'offline' ? <Notice tone="info">{t('manual.offlineNote')}</Notice> : null}
        <Button label={core('common.close')} onPress={() => onClose(result)} testID="manual-done" />
      </Card>
    );
  }

  return (
    <Card testID="manual-panel">
      <Heading level={2}>{t('manual.title', { name: holderName })}</Heading>
      <Body>{t('manual.reasonLabel')}</Body>
      <Row>
        {MANUAL_REASONS.map((r) => (
          <Chip
            key={r}
            testID={`reason-${r}`}
            label={t(`manual.reasons.${r}`)}
            selected={reason === r}
            onPress={() => {
              setReason(r);
              setProblem(null);
            }}
          />
        ))}
      </Row>
      <Field
        autoComplete="off"
        label={t('manual.noteLabel')}
        hint={t('manual.noteHint')}
        value={note}
        onChangeText={(v) => {
          setNote(v);
          setProblem(null);
        }}
        multiline
        error={problem ? t(`manual.errors.${problem}`) : null}
        testID="manual-note"
      />
      {failed ? <Notice tone="stop">{t('manual.failed')}</Notice> : null}
      {result?.via === 'none' ? <Notice tone="warn">{t('manual.noWay')}</Notice> : null}
      <Row>
        <Button label={t('manual.confirm')} onPress={confirm} busy={busy} testID="manual-confirm" />
        <Button
          label={t('manual.cancel')}
          onPress={() => onClose(null)}
          variant="secondary"
          testID="manual-cancel"
        />
      </Row>
    </Card>
  );
}
