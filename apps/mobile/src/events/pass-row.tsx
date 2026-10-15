import { px, radius, space, TOUCH_TARGET_PX, type, useColors } from '@yayatoh/mobile-core';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocale, useTranslations } from 'use-intl';
import type { Pass } from '../shop/api';
import { formatEventDay, formatMoney } from '../shop/format';
import { maxQuantity, minQuantity, type PassStatus } from '../shop/selection';
import { Button } from '../shop/ui';

const TARGET = Math.max(TOUCH_TARGET_PX, 44);

/** One ticket type: name, all-in price, availability, and the quantity stepper (or why there is none). */
export function PassRow({
  pass,
  status,
  quantity,
  timeZone,
  onChange,
  onBuyOnWeb,
}: {
  pass: Pass;
  status: PassStatus;
  quantity: number;
  timeZone: string;
  onChange: (next: 1 | -1) => void;
  onBuyOnWeb: () => void;
}) {
  const t = useTranslations('discover.event');
  const locale = useLocale();
  const colors = useColors();
  const price = pass.allInMinor === 0 ? t('free') : formatMoney(pass.allInMinor, pass.currency, locale);
  const min = minQuantity(pass);
  const max = maxQuantity(pass);

  const note =
    status === 'sold_out'
      ? t('soldOut')
      : status === 'not_yet_on_sale'
        ? t('notYetOnSale')
        : status === 'sales_ended'
          ? t('salesEnded')
          : null;

  return (
    <View
      testID={`pass-${pass.id}`}
      style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
    >
      <Text style={[styles.name, { color: colors.ink }]}>{pass.name}</Text>
      {pass.description ? (
        <Text style={[styles.meta, { color: colors.ink2 }]}>{pass.description}</Text>
      ) : null}
      <Text style={[styles.price, { color: colors.ink }]} testID={`pass-price-${pass.id}`}>
        {pass.isDonation ? t('donationFrom', { price }) : price}
        {pass.allInMinor > 0 ? (
          <Text style={[styles.meta, { color: colors.ink2 }]}>{`  ${t('allIn')}`}</Text>
        ) : null}
      </Text>
      {pass.regularAllInMinor !== null && pass.earlyEndsAt ? (
        <Text style={[styles.meta, { color: colors.success }]}>
          {t('earlyBird', {
            date: formatEventDay(pass.earlyEndsAt, timeZone, locale),
            regular: formatMoney(pass.regularAllInMinor, pass.currency, locale),
          })}
        </Text>
      ) : null}
      {pass.fewLeft && status === 'buyable' ? (
        <Text style={[styles.warn, { color: colors.warning }]}>{t('fewLeft')}</Text>
      ) : null}
      {pass.accessDates.length > 0 ? (
        <Text style={[styles.meta, { color: colors.ink2 }]}>
          {t('accessDates', { dates: pass.accessDates.map((d) => d.name).join(', ') })}
        </Text>
      ) : null}

      {note ? (
        <Text style={[styles.note, { color: colors.danger }]} testID={`pass-note-${pass.id}`}>
          {note}
        </Text>
      ) : null}

      {status === 'web_only' ? (
        <View style={styles.webOnly}>
          <Text style={[styles.meta, { color: colors.ink }]}>{t('webOnly.passBody')}</Text>
          <Button
            tone="secondary"
            label={t('webOnly.action')}
            onPress={onBuyOnWeb}
            testID={`buy-on-web-${pass.id}`}
          />
        </View>
      ) : null}

      {status === 'buyable' ? (
        <View style={styles.stepper}>
          <Pressable
            testID={`decrease-${pass.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('decrease', { name: pass.name })}
            accessibilityState={{ disabled: quantity <= 0 }}
            disabled={quantity <= 0}
            onPress={() => onChange(-1)}
            style={[
              styles.step,
              {
                borderColor: colors.lineStrong,
                backgroundColor: colors.surface2,
                opacity: quantity <= 0 ? 0.5 : 1,
              },
            ]}
          >
            <Text style={[styles.stepLabel, { color: colors.ink }]}>−</Text>
          </Pressable>
          <Text
            testID={`quantity-${pass.id}`}
            accessibilityLabel={t('quantity', { name: pass.name, count: quantity })}
            accessibilityLiveRegion="polite"
            style={[styles.quantity, { color: colors.ink }]}
          >
            {quantity}
          </Text>
          <Pressable
            testID={`increase-${pass.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('increase', { name: pass.name })}
            accessibilityState={{ disabled: quantity >= max }}
            disabled={quantity >= max}
            onPress={() => onChange(1)}
            style={[
              styles.step,
              {
                borderColor: colors.lineStrong,
                backgroundColor: colors.surface2,
                opacity: quantity >= max ? 0.5 : 1,
              },
            ]}
          >
            <Text style={[styles.stepLabel, { color: colors.ink }]}>+</Text>
          </Pressable>
          <View style={styles.limits}>
            {min > 1 ? (
              <Text style={[styles.meta, { color: colors.ink2 }]}>{t('minPerOrder', { count: min })}</Text>
            ) : null}
            <Text style={[styles.meta, { color: colors.ink2 }]}>
              {quantity >= max ? t('maxReached', { count: max }) : t('maxPerOrder', { count: max })}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.tile),
    padding: space[4],
    gap: space[1],
  },
  name: { fontSize: type.card.size - 2, fontWeight: '800', textAlign: 'auto' },
  meta: { fontSize: type.body.size, fontWeight: '500', textAlign: 'auto' },
  price: { fontSize: type.card.size, fontWeight: '800', textAlign: 'auto' },
  warn: { fontSize: type.body.size, fontWeight: '700', textAlign: 'auto' },
  note: { fontSize: type.body.size + 1, fontWeight: '800', textAlign: 'auto' },
  webOnly: { gap: space[2], marginTop: space[2] },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[2],
  },
  step: {
    minWidth: TARGET,
    minHeight: TARGET,
    borderRadius: px(radius.control),
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: { fontSize: 24, fontWeight: '800', lineHeight: 28 },
  quantity: { minWidth: TARGET, textAlign: 'center', fontSize: type.card.size, fontWeight: '800' },
  limits: { flexShrink: 1, flexGrow: 1, minWidth: 120 },
});
