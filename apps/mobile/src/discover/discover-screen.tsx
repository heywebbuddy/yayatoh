/**
 * Discover (M7.3c): search the marketplace's upcoming events by words, category, date range and
 * distance. Soonest first, or nearest first once "near me" is on. Results come a page at a time from
 * the API's keyset cursor. The location is asked for only when the person taps "near me".
 */
import { ROUTES, space, useColors } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { type EventSummary, flattenEvents, useEventSearch } from '../shop/api';
import {
  DATE_PRESETS,
  type DatePreset,
  type DateRange,
  presetOf,
  presetRange,
  rangeErrors,
} from '../shop/dates';
import { failureOf } from '../shop/errors';
import { CATEGORIES, type DiscoverFilters, hasFilters } from '../shop/filters';
import { useShopPorts } from '../shop/ports';
import { Banner, Body, Button, Caption, Chip, Empty, Field, Heading, Loading } from '../shop/ui';
import { EventCard } from './event-card';

type NearState = 'off' | 'locating' | 'on' | 'denied' | 'denied_blocked' | 'unavailable';

const SEARCH_DEBOUNCE_MS = 350;

export function DiscoverScreen() {
  const t = useTranslations('discover');
  const core = useTranslations('core');
  const router = useRouter();
  const colors = useColors();
  const ports = useShopPorts();

  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [custom, setCustom] = useState(false);
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [near, setNear] = useState<DiscoverFilters['near']>(null);
  const [nearState, setNearState] = useState<NearState>('off');

  // Search as the person types, once they pause.
  useEffect(() => {
    const id = setTimeout(() => setQ(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);

  const filters = useMemo<DiscoverFilters>(() => ({ q, category, range, near }), [q, category, range, near]);
  const search = useEventSearch(filters);
  const events = useMemo(() => flattenEvents(search.data), [search.data]);

  const now = ports.now();
  const activePreset = presetOf(range, now);
  const errors = custom ? rangeErrors(fromText, toText) : [];

  const choosePreset = (preset: DatePreset) => {
    setCustom(false);
    setFromText('');
    setToText('');
    setRange(activePreset === preset ? { from: null, to: null } : presetRange(preset, now));
  };
  const anyDate = () => {
    setCustom(false);
    setFromText('');
    setToText('');
    setRange({ from: null, to: null });
  };
  const applyTyped = (from: string, to: string) => {
    setFromText(from);
    setToText(to);
    if (rangeErrors(from, to).length === 0) setRange({ from: from.trim() || null, to: to.trim() || null });
  };

  const toggleNear = async () => {
    if (near || nearState === 'locating') {
      setNear(null);
      setNearState('off');
      return;
    }
    setNearState('locating');
    const result = await ports.location.requestNearMe();
    if (result.status === 'granted') {
      setNear(result.near);
      setNearState('on');
    } else if (result.status === 'denied') {
      setNearState(result.canAskAgain ? 'denied' : 'denied_blocked');
    } else {
      setNearState('unavailable');
    }
  };

  const clearAll = () => {
    setText('');
    setQ('');
    setCategory(null);
    anyDate();
    setNear(null);
    setNearState('off');
  };

  const open = useCallback(
    (slug: string) => router.push({ pathname: ROUTES.event, params: { slug } }),
    [router],
  );

  const failure = search.isError ? failureOf(search.error) : null;
  const filtered = hasFilters(filters);

  const header = (
    <View style={styles.header}>
      <Heading>{t('title')}</Heading>
      <Field
        testID="discover-search"
        label={t('searchLabel')}
        placeholder={t('searchPlaceholder')}
        value={text}
        onChangeText={setText}
        returnKeyType="search"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        maxLength={100}
      />
      {text ? (
        <Button
          tone="secondary"
          label={t('clearSearch')}
          onPress={() => setText('')}
          testID="discover-clear-search"
        />
      ) : null}

      <Caption>{t('category')}</Caption>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        <Chip
          label={t('categoryAll')}
          selected={category === null}
          onPress={() => setCategory(null)}
          testID="category-all"
        />
        {CATEGORIES.map((c) => (
          <Chip
            key={c}
            testID={`category-${c}`}
            label={t(`categories.${c}`)}
            selected={category === c}
            onPress={() => setCategory(category === c ? null : c)}
          />
        ))}
      </ScrollView>

      <Caption>{t('when')}</Caption>
      <View style={styles.wrap}>
        <Chip
          label={t('whenAny')}
          selected={!custom && range.from === null && range.to === null}
          onPress={anyDate}
          testID="when-any"
        />
        {DATE_PRESETS.map((p) => (
          <Chip
            key={p}
            testID={`when-${p}`}
            label={t(`preset.${p}`)}
            selected={!custom && activePreset === p}
            onPress={() => choosePreset(p)}
          />
        ))}
        <Chip
          label={t('pickDates')}
          selected={custom}
          onPress={() => setCustom(!custom)}
          testID="when-custom"
        />
      </View>
      {custom ? (
        <View style={styles.dates}>
          <Field
            testID="date-from"
            label={t('dateFrom')}
            placeholder="2027-05-01"
            value={fromText}
            onChangeText={(v) => applyTyped(v, toText)}
            keyboardType="numbers-and-punctuation"
            autoComplete="off"
            autoCapitalize="none"
            maxLength={10}
            error={errors.includes('from_format') ? t('dateError.from_format') : null}
          />
          <Field
            testID="date-to"
            label={t('dateTo')}
            placeholder="2027-05-31"
            value={toText}
            onChangeText={(v) => applyTyped(fromText, v)}
            keyboardType="numbers-and-punctuation"
            autoComplete="off"
            autoCapitalize="none"
            maxLength={10}
            error={
              errors.includes('to_format')
                ? t('dateError.to_format')
                : errors.includes('order')
                  ? t('dateError.order')
                  : null
            }
          />
        </View>
      ) : null}

      <View style={styles.wrap}>
        <Chip
          testID="near-me"
          label={nearState === 'locating' ? t('nearMeLocating') : t('nearMe')}
          selected={nearState === 'on'}
          onPress={() => void toggleNear()}
        />
        {filtered ? (
          <Chip label={t('clearFilters')} selected={false} onPress={clearAll} testID="clear-filters" />
        ) : null}
      </View>
      {nearState === 'denied' || nearState === 'denied_blocked' ? (
        <Banner
          tone="warning"
          title={t('nearMeDeniedTitle')}
          testID="near-me-denied"
          action={
            nearState === 'denied_blocked' ? (
              <Button
                tone="secondary"
                label={t('openSettings')}
                onPress={() => void ports.location.openSettings()}
              />
            ) : null
          }
        >
          {nearState === 'denied_blocked' ? t('nearMeBlocked') : t('nearMeDenied')}
        </Banner>
      ) : null}
      {nearState === 'unavailable' ? (
        <Banner tone="warning" title={t('nearMeUnavailableTitle')} testID="near-me-unavailable">
          {t('nearMeUnavailable')}
        </Banner>
      ) : null}
      {events.length > 0 ? (
        <Caption testID="sort-order">{near ? t('sortNearest') : t('sortSoonest')}</Caption>
      ) : null}
    </View>
  );

  const body = search.isPending ? (
    <Loading label={t('loading')} />
  ) : failure ? (
    <Banner
      tone="danger"
      title={t('errorTitle')}
      testID="search-error"
      action={<Button label={core('common.retry')} onPress={() => void search.refetch()} />}
    >
      {failure.kind === 'network'
        ? core('errors.network')
        : failure.kind === 'rate_limited'
          ? t('rateLimited')
          : core('errors.generic')}
    </Banner>
  ) : null;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <FlatList<EventSummary>
        testID="discover-list"
        data={events}
        keyExtractor={(e) => e.slug}
        renderItem={({ item }) => <EventCard event={item} onPress={() => open(item.slug)} />}
        ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          body ??
          (search.isFetching ? null : (
            <Empty
              testID="discover-empty"
              title={filtered ? t('emptyTitle') : t('emptyNoFiltersTitle')}
              body={filtered ? t('emptyBody') : t('emptyNoFiltersBody')}
              action={
                filtered ? <Button tone="secondary" label={t('clearFilters')} onPress={clearAll} /> : null
              }
            />
          ))
        }
        ListFooterComponent={
          search.isFetchingNextPage ? (
            <Loading label={t('loadingMore')} testID="loading-more" />
          ) : search.hasNextPage ? (
            <View style={styles.footer}>
              <Button
                tone="secondary"
                label={t('showMore')}
                onPress={() => void search.fetchNextPage()}
                testID="show-more"
              />
            </View>
          ) : events.length > 0 ? (
            <View style={styles.footer}>
              <Body muted>{t('endOfResults')}</Body>
            </View>
          ) : null
        }
        onEndReached={() => {
          if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={search.isRefetching && !search.isFetchingNextPage}
            onRefresh={() => void search.refetch()}
            accessibilityLabel={t('refresh')}
          />
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space[4], paddingBottom: space[10] },
  header: { gap: space[3], paddingBottom: space[4] },
  chips: { gap: space[2], paddingVertical: space[1], paddingEnd: space[4] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  dates: { gap: space[3] },
  footer: { paddingVertical: space[4], alignItems: 'center' },
});
