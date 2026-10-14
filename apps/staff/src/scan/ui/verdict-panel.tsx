/**
 * The verdict, big enough to read at arm's length (M7.4b): a solid colour block with a glyph, the
 * headline in large type, the holder's name and what to do next. Colour is never the only signal:
 * the glyph, the words, the sound and the vibration say the same thing.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';
import { px, radius, space, useColors } from '../../theme';
import type { ScanOutcome } from '../types';
import { viewFor } from '../verdicts';
import { TONE_GLYPH, toneColors } from './tone-colors';

export interface VerdictPanelProps {
  /** `null` shows the idle "ready" state. */
  readonly outcome: ScanOutcome | null;
  /** The event's time zone, for "admitted at 14:05". */
  readonly timezone: string | null;
}

export function VerdictPanel({ outcome, timezone }: VerdictPanelProps) {
  const t = useTranslations('scan');
  const format = useFormatter();
  const colors = useColors();

  if (!outcome) {
    return (
      <View
        style={[styles.panel, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
        testID="verdict-idle"
      >
        <Text style={[styles.idle, { color: colors.ink2 }]}>{t('ready')}</Text>
      </View>
    );
  }

  const view = viewFor(outcome.verdict);
  const { fill, text } = toneColors(view.tone, colors);
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: 'numeric', minute: '2-digit', ...(timezone ? { timeZone: timezone } : {}) });

  let hint: string | null = null;
  if (view.id === 'duplicate' || view.id === 'duplicate_offline') {
    const first = outcome.firstAdmission;
    hint = first
      ? first.checkpointName
        ? t('verdict.duplicate.hintWhere', { time: time(first.at), place: first.checkpointName })
        : t('verdict.duplicate.hintWhen', { time: time(first.at) })
      : t('verdict.duplicate.hint');
  } else if (view.hint) {
    hint = t(`verdict.${view.key}.hint`);
  }
  const title = t(`verdict.${view.key}.title`);
  const name = outcome.holderName;
  const label = [title, name, outcome.typeName, hint].filter(Boolean).join('. ');

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={label}
      style={[styles.panel, { backgroundColor: fill, borderColor: fill }]}
      testID="verdict-panel"
    >
      <Text style={[styles.glyph, { color: text }]} importantForAccessibility="no" testID={`verdict-glyph-${view.tone}`}>
        {TONE_GLYPH[view.tone]}
      </Text>
      <Text style={[styles.title, { color: text }]} testID="verdict-title">
        {title}
      </Text>
      {name ? <Text style={[styles.name, { color: text }]}>{name}</Text> : null}
      {outcome.typeName ? <Text style={[styles.detail, { color: text }]}>{outcome.typeName}</Text> : null}
      {hint ? <Text style={[styles.detail, { color: text }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: px(radius.card),
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space[5],
    paddingVertical: space[5],
    gap: space[1],
    minHeight: 144,
    justifyContent: 'center',
  },
  glyph: { fontSize: 44, fontWeight: '800', textAlign: 'auto' },
  title: { fontSize: 36, lineHeight: 42, fontWeight: '800', textAlign: 'auto' },
  name: { fontSize: 26, lineHeight: 32, fontWeight: '700', textAlign: 'auto' },
  detail: { fontSize: 20, lineHeight: 26, fontWeight: '600', textAlign: 'auto' },
  idle: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
});
