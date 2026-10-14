/**
 * The scan screen (M7.4b): the header with what is waiting to send, the camera (or the way to allow
 * it), the verdict panel, what the server flagged after sync, and typing a code by hand.
 *
 * `ScanView` takes the engine and its helpers as props so every state can be rendered in a test; the
 * route (`app/scan/index.tsx`) wires it to the device's runtime.
 */
import { type ComponentType, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFormatter, useTranslations } from 'use-intl';
import { px, radius, space, type, useColors } from '../../theme';
import type { ScanEngine } from '../engine';
import { type Feedback, nativeFeedback } from '../feedback';
import type { Scheduler } from '../scheduler';
import type { Direction, FlaggedScan } from '../types';
import { useEngineStatus } from '../use-scan';
import { viewFor } from '../verdicts';
import { Button } from './controls';
import { FlaggedPanel } from './flagged-panel';
import { ManualEntry } from './manual-entry';
import { QrCamera, type QrCameraProps } from './qr-camera';
import { useScanFlow } from './use-scan-flow';
import { VerdictPanel } from './verdict-panel';

export interface ScanViewProps {
  readonly engine: ScanEngine;
  readonly scheduler: Scheduler | null;
  readonly feedback?: Feedback;
  /** Swapped for a stand-in in tests that cannot load the native camera. */
  readonly Camera?: ComponentType<QrCameraProps>;
  /** The clock the camera's repeat filter reads (a test seam). */
  readonly now?: () => number;
}

export function ScanView({ engine, scheduler, feedback = nativeFeedback, Camera = QrCamera, now }: ScanViewProps) {
  const t = useTranslations('scan');
  const tc = useTranslations('core.common');
  const colors = useColors();
  const format = useFormatter();
  const status = useEngineStatus(engine);
  const { width, height } = useWindowDimensions();
  const [direction, setDirection] = useState<Direction>('in');
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [manual, setManual] = useState(false);
  const [flags, setFlags] = useState<FlaggedScan[]>([]);
  const { outcome, unavailable, submit } = useScanFlow({ engine, scheduler, feedback, direction, ...(now ? { now } : {}) });

  const timezone = engine.timezone;
  const door = engine.sessionDoor;
  const checkpoint = engine.checkpoint;

  // Reload the flags when the count changes; a new one is announced with the repeat sound and buzz.
  const [seenFlags, setSeenFlags] = useState(status.flaggedCount);
  useEffect(() => {
    let live = true;
    if (status.flaggedCount === 0) setFlags((prev) => (prev.length ? [] : prev));
    else void engine.flags().then((all) => live && setFlags(all));
    if (status.flaggedCount > seenFlags) feedback.play(viewFor('duplicate'));
    setSeenFlags(status.flaggedCount);
    return () => {
      live = false;
    };
  }, [engine, status.flaggedCount, feedback, seenFlags]);

  const onCode = useCallback((code: string) => void submit(code, 'camera'), [submit]);
  const onManual = useCallback(
    async (code: string) => {
      await submit(code, 'manual');
    },
    [submit],
  );
  const syncNow = useCallback(() => {
    void (scheduler ? scheduler.syncNow() : engine.sync()).catch(() => {});
  }, [scheduler, engine]);

  const cameraHeight = Math.round(Math.min(width * 0.9, height * 0.42));
  const queue = t('status.queue', { count: status.queueDepth });
  const updated = status.lastSyncAt
    ? t('status.updated', { time: format.dateTime(new Date(status.lastSyncAt), { hour: 'numeric', minute: '2-digit' }) })
    : null;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]} testID="scan-screen">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
            {status.eventName ?? t('title')}
          </Text>
          <Text style={[styles.sub, { color: colors.ink2 }]} testID="scan-place">
            {checkpoint ? t('header.at', { name: checkpoint.name }) : t('header.wholeEvent')}
          </Text>
          <View style={styles.statusRow}>
            <Text
              style={[styles.sub, { color: status.queueDepth > 0 ? colors.warning : colors.ink2, fontWeight: '700' }]}
              accessibilityLiveRegion="polite"
              testID="scan-queue"
            >
              {queue}
            </Text>
            {updated ? (
              <Text style={[styles.sub, { color: colors.ink2 }]} testID="scan-updated">
                {updated}
              </Text>
            ) : null}
          </View>
          {status.phase !== 'expired' ? (
            <Button
              label={status.syncing || status.flushing ? t('sync.running') : t('sync.button')}
              onPress={syncNow}
              disabled={status.syncing || status.flushing}
              testID="scan-sync"
            />
          ) : null}
          {door ? (
            <View style={styles.directions} accessibilityRole="radiogroup" accessibilityLabel={t('direction.label')}>
              <Button
                label={t('direction.in')}
                selected={direction === 'in'}
                onPress={() => setDirection('in')}
                testID="direction-in"
              />
              <Button
                label={t('direction.out')}
                selected={direction === 'out'}
                onPress={() => setDirection('out')}
                testID="direction-out"
              />
            </View>
          ) : null}
        </View>

        {status.phase === 'expired' ? (
          <Notice title={t('expired.title')} body={t('expired.body')} testID="scan-expired" />
        ) : status.phase === 'empty' ? (
          <Download
            syncing={status.syncing}
            error={status.syncError}
            onRetry={syncNow}
            retryLabel={tc('retry')}
          />
        ) : (
          <>
            <FlaggedPanel
              flags={flags}
              timezone={timezone}
              onDismiss={(id) => void engine.dismissFlag(id)}
              onDismissAll={() => void engine.dismissAllFlags()}
            />
            {manual ? (
              <ManualEntry onSubmit={onManual} onClose={() => setManual(false)} />
            ) : (
              <>
                <Camera
                  active={!manual}
                  torch={torch}
                  height={cameraHeight}
                  onCode={onCode}
                  onTorchSupport={setTorchSupported}
                  onTypeCode={() => setManual(true)}
                />
                <View style={styles.tools}>
                  {torchSupported ? (
                    <Button
                      label={torch ? t('torch.off') : t('torch.on')}
                      selected={torch}
                      onPress={() => setTorch((v) => !v)}
                      testID="torch-toggle"
                    />
                  ) : null}
                  <Button label={t('manual.open')} onPress={() => setManual(true)} testID="manual-open" />
                </View>
              </>
            )}
            {unavailable ? <Notice title={t('download.title')} body={t('download.body')} /> : null}
            <VerdictPanel outcome={outcome} timezone={timezone} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Notice({ title, body, testID }: { title: string; body: string; testID?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.notice, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]} testID={testID}>
      <Text accessibilityRole="header" style={[styles.noticeTitle, { color: colors.ink }]}>
        {title}
      </Text>
      <Text style={[styles.noticeBody, { color: colors.ink2 }]}>{body}</Text>
    </View>
  );
}

function Download({
  syncing,
  error,
  onRetry,
  retryLabel,
}: {
  syncing: boolean;
  error: 'offline' | 'not_assigned' | 'bad_scope' | null;
  onRetry: () => void;
  retryLabel: string;
}) {
  const t = useTranslations('scan.download');
  const colors = useColors();
  return (
    <View
      style={[styles.notice, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
      testID="scan-download"
    >
      <Text accessibilityRole="header" style={[styles.noticeTitle, { color: colors.ink }]}>
        {t('title')}
      </Text>
      {syncing ? (
        <ActivityIndicator accessibilityLabel={t('title')} color={colors.primary} size="large" />
      ) : null}
      <Text style={[styles.noticeBody, { color: colors.ink2 }]}>{t('body')}</Text>
      {error && !syncing ? (
        <Text
          accessibilityRole="alert"
          style={[styles.noticeBody, { color: colors.danger, fontWeight: '700' }]}
          testID="scan-download-error"
        >
          {t(error === 'offline' ? 'failedOffline' : error === 'not_assigned' ? 'failedNotAssigned' : 'failedScope')}
        </Text>
      ) : null}
      {!syncing ? <Button variant="primary" label={retryLabel} onPress={onRetry} testID="scan-download-retry" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space[4], gap: space[3], flexGrow: 1 },
  header: { gap: space[1] },
  title: { fontSize: 24, fontWeight: '800', textAlign: 'auto' },
  sub: { fontSize: type.body.size + 2, textAlign: 'auto' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space[4], rowGap: space[1] },
  directions: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  notice: { borderRadius: px(radius.card), borderWidth: StyleSheet.hairlineWidth, padding: space[5], gap: space[3] },
  noticeTitle: { fontSize: type.card.size, fontWeight: '800', textAlign: 'auto' },
  noticeBody: { fontSize: type.prose.size + 1, lineHeight: (type.prose.size + 1) * 1.5, textAlign: 'auto' },
});
