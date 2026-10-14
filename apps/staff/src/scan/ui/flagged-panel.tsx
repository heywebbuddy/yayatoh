/**
 * Scans the server judged differently once they synced (M7.4b): mostly a ticket two doors admitted
 * while both were offline. Shown above the camera until staff dismiss them, so a duplicate found
 * after the fact is seen, not buried.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';
import { px, radius, space, type, useColors } from '../../theme';
import type { FlaggedScan } from '../types';
import { Button } from './controls';

export interface FlaggedPanelProps {
  readonly flags: readonly FlaggedScan[];
  readonly timezone: string | null;
  readonly onDismiss: (scanId: string) => void;
  readonly onDismissAll: () => void;
}

const kindOf = (serverResult: string) =>
  serverResult === 'duplicate_offline' || serverResult === 'duplicate'
    ? 'duplicate'
    : serverResult === 'rejected'
      ? 'rejected'
      : 'other';

export function FlaggedPanel({ flags, timezone, onDismiss, onDismissAll }: FlaggedPanelProps) {
  const t = useTranslations('scan.flagged');
  const format = useFormatter();
  const colors = useColors();
  const open = flags.filter((f) => !f.dismissed);
  if (open.length === 0) return null;
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: 'numeric', minute: '2-digit', ...(timezone ? { timeZone: timezone } : {}) });
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.box, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}
      testID="flagged-panel"
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('title', { count: open.length })}
      </Text>
      {open.slice(0, 5).map((f) => (
        <View key={f.scanId} style={styles.item} testID={`flag-${f.scanId}`}>
          <Text style={[styles.name, { color: colors.ink }]}>{f.holderName ?? t('unknownHolder')}</Text>
          <Text style={[styles.body, { color: colors.ink2 }]}>{t(kindOf(f.serverResult))}</Text>
          <Text style={[styles.body, { color: colors.ink2 }]}>{t('when', { time: time(f.scannedAt) })}</Text>
          <Button label={t('dismiss')} onPress={() => onDismiss(f.scanId)} testID={`flag-dismiss-${f.scanId}`} />
        </View>
      ))}
      {open.length > 1 ? <Button label={t('dismissAll')} onPress={onDismissAll} testID="flag-dismiss-all" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: px(radius.card), borderWidth: 2, padding: space[4], gap: space[3] },
  title: { fontSize: type.card.size, fontWeight: '800', textAlign: 'auto' },
  item: { gap: space[1] },
  name: { fontSize: 18, fontWeight: '700', textAlign: 'auto' },
  body: { fontSize: type.prose.size, lineHeight: type.prose.size * 1.4, textAlign: 'auto' },
});
