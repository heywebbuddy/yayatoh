import { px, radius, space, type, useColors } from '@yayatoh/mobile-core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import type { EventSummary } from '../shop/api';
import { formatDistance, formatEventStart, formatPriceRange } from '../shop/format';

/** One search result: what, when (in the event's zone), where, from what price, how far. */
export function EventCard({ event, onPress }: { event: EventSummary; onPress: () => void }) {
  const t = useTranslations('discover');
  const locale = useLocale();
  const colors = useColors();
  const when = formatEventStart(event.startsAt, event.timezone, locale);
  const place = [event.venueName, event.city].filter(Boolean).join(', ');
  const price = formatPriceRange(event.minPriceMinor, event.maxPriceMinor, event.currency, locale, t('free'));
  const distance =
    event.distanceKm === null ? null : t('away', { distance: formatDistance(event.distanceKm, locale) });
  const cancelled = event.status === 'cancelled' || event.status === 'postponed';
  const label = [
    event.name,
    event.organizer.name,
    when,
    place,
    price ? t('priceFrom', { price }) : null,
    distance,
    event.status === 'cancelled'
      ? t('statusCancelled')
      : event.status === 'postponed'
        ? t('statusPostponed')
        : null,
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <Pressable
      testID={`event-${event.slug}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('openEvent')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? colors.surface3 : colors.surfaceSolid, borderColor: colors.line },
      ]}
    >
      <Text style={[styles.when, { color: colors.primaryInk }]}>{when}</Text>
      <Text style={[styles.name, { color: colors.ink }]}>{event.name}</Text>
      {event.tagline ? <Text style={[styles.meta, { color: colors.ink2 }]}>{event.tagline}</Text> : null}
      <Text style={[styles.meta, { color: colors.ink2 }]}>{event.organizer.name}</Text>
      {place ? <Text style={[styles.meta, { color: colors.ink2 }]}>{place}</Text> : null}
      <View style={styles.row}>
        {price ? (
          <Text style={[styles.price, { color: colors.ink }]}>{t('priceFrom', { price })}</Text>
        ) : null}
        {distance ? <Text style={[styles.meta, { color: colors.ink2 }]}>{distance}</Text> : null}
        {cancelled ? (
          <Text style={[styles.status, { color: colors.danger }]}>
            {event.status === 'cancelled' ? t('statusCancelled') : t('statusPostponed')}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.tile),
    padding: space[4],
    gap: space[1],
    minHeight: 44,
  },
  when: { fontSize: type.body.size, fontWeight: '800', textAlign: 'auto' },
  name: { fontSize: type.card.size, fontWeight: '800', textAlign: 'auto' },
  meta: { fontSize: type.body.size, textAlign: 'auto' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space[3],
    rowGap: space[1],
    marginTop: space[1],
  },
  price: { fontSize: type.body.size + 1, fontWeight: '800' },
  status: { fontSize: type.body.size, fontWeight: '800' },
});
