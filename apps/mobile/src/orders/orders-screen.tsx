/** Your orders (M7.3c): reached from Account → Orders; newest first, a page at a time. */
import { ROUTES, space, useColors } from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';
import { type MyOrderSummary, useMyOrders } from '../shop/api';
import { failureOf } from '../shop/errors';
import { formatEventStart, formatMoney } from '../shop/format';
import { Banner, Body, Button, Caption, Empty, Heading, Loading } from '../shop/ui';

function OrderRow({ order, onPress }: { order: MyOrderSummary; onPress: () => void }) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const colors = useColors();
  const when = formatEventStart(order.startsAt, order.timezone, locale);
  const total = order.totalMinor === 0 ? t('free') : formatMoney(order.totalMinor, order.currency, locale);
  const status = t(`status.${order.status}`);
  const tickets = t('tickets', { count: order.tickets });
  return (
    <Pressable
      testID={`order-${order.id}`}
      accessibilityRole="button"
      accessibilityLabel={[order.eventName, when, status, tickets, total].join('. ')}
      accessibilityHint={t('openOrder')}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surface3 : colors.surfaceSolid, borderColor: colors.line },
      ]}
    >
      <Body strong>{order.eventName}</Body>
      <Caption>{when}</Caption>
      <Caption>{order.organizerName}</Caption>
      <View style={styles.meta}>
        <Text style={[styles.status, { color: colors.ink }]}>{status}</Text>
        <Caption>{tickets}</Caption>
        <Body strong>{total}</Body>
      </View>
    </Pressable>
  );
}

export function OrdersScreen() {
  const t = useTranslations('orders');
  const core = useTranslations('core');
  const router = useRouter();
  const colors = useColors();
  const query = useMyOrders();
  const orders = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const failure = query.isError ? failureOf(query.error) : null;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <FlatList<MyOrderSummary>
        testID="orders-list"
        data={orders}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => (
          <OrderRow
            order={item}
            onPress={() => router.push({ pathname: ROUTES.order, params: { id: item.id } })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Button
              tone="secondary"
              label={t('back')}
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              testID="orders-back"
            />
            <Heading>{t('title')}</Heading>
          </View>
        }
        ListEmptyComponent={
          query.isPending ? (
            <Loading label={t('loading')} />
          ) : failure ? (
            <Banner
              tone="danger"
              title={t('errorTitle')}
              testID="orders-error"
              action={<Button label={core('common.retry')} onPress={() => void query.refetch()} />}
            >
              {failure.kind === 'network'
                ? core('errors.network')
                : failure.kind === 'unauthenticated'
                  ? t('signInAgain')
                  : core('errors.generic')}
            </Banner>
          ) : (
            <Empty
              testID="orders-empty"
              title={t('emptyTitle')}
              body={t('emptyBody')}
              action={<Button label={t('findEvents')} onPress={() => router.push('/discover')} />}
            />
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <Loading label={t('loadingMore')} testID="orders-loading-more" />
          ) : query.hasNextPage ? (
            <View style={styles.footer}>
              <Button
                tone="secondary"
                label={t('showMore')}
                onPress={() => void query.fetchNextPage()}
                testID="orders-show-more"
              />
            </View>
          ) : null
        }
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            onRefresh={() => void query.refetch()}
          />
        }
        contentContainerStyle={styles.content}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space[4], paddingBottom: space[10] },
  header: { gap: space[3], paddingBottom: space[4] },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: space[4],
    gap: space[1],
    minHeight: 44,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space[3],
    rowGap: space[1],
    marginTop: space[1],
  },
  status: { fontSize: 14, fontWeight: '800' },
  footer: { paddingVertical: space[4], alignItems: 'center' },
});
