/**
 * My tickets (M7.3b): upcoming and past, grouped by event, with keyset paging, pull to refresh, a
 * "last synced" line and a copy that is still there with the network off.
 */
import {
  BrandScope,
  px,
  radius,
  space,
  TOUCH_TARGET_PX,
  type,
  useColors,
  useIsOffline,
  useSession,
} from '@yayatoh/mobile-core';
import { useRouter } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFormatter, useTranslations } from 'use-intl';
import type { TicketSummary, TicketWhen } from '../api';
import { formatDay, formatEventRange } from '../format';
import { groupByEvent, type TicketGroup } from '../group';
import { useLastSynced, useTicketList, useTicketSync } from '../hooks';
import { hrefs } from '../nav';
import { Banner, Button, Caption, EmptyState, Heading, Loading, Segmented } from '../ui';
import { PendingLinkResume } from './pending-resume';

function TicketCard({ ticket, onOpen }: { ticket: TicketSummary; onOpen: () => void }) {
  return (
    <BrandScope color={ticket.accentColor}>
      <TicketCardBody ticket={ticket} onOpen={onOpen} />
    </BrandScope>
  );
}

function TicketCardBody({ ticket, onOpen }: { ticket: TicketSummary; onOpen: () => void }) {
  const t = useTranslations('tickets');
  const format = useFormatter();
  const colors = useColors();
  const span = ticket.date ?? ticket.event;
  const when = formatEventRange(
    format,
    span.startsAt,
    span.endsAt,
    ticket.event.timezone,
    t('common.rangeSeparator'),
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('list.cardLabel', {
        type: ticket.ticketTypeName,
        event: ticket.event.name,
        when,
        holder: ticket.holderName,
      })}
      accessibilityHint={t('list.openTicket')}
      onPress={onOpen}
      testID={`ticket-card-${ticket.id}`}
      style={[styles.card, { backgroundColor: colors.surfaceSolid, borderColor: colors.line }]}
    >
      <View style={[styles.accent, { backgroundColor: colors.primary }]} />
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{ticket.ticketTypeName}</Text>
        <Text style={[styles.cardLine, { color: colors.ink2 }]}>
          {t('list.holder', { name: ticket.holderName })}
        </Text>
        {ticket.seatLabel ? (
          <Text style={[styles.cardLine, { color: colors.ink2 }]}>
            {t('list.cardSeat', { seat: ticket.seatLabel })}
          </Text>
        ) : null}
        {ticket.pendingTransfer ? (
          <Text style={[styles.pending, { color: colors.warning, backgroundColor: colors.warningSoft }]}>
            {t('list.transferPending')}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function GroupHeader({ group }: { group: TicketGroup }) {
  const t = useTranslations('tickets');
  const format = useFormatter();
  const colors = useColors();
  return (
    <View style={styles.groupHeader} accessible accessibilityRole="header">
      <Text style={[styles.groupTitle, { color: colors.ink }]}>{group.event.name}</Text>
      <Text style={[styles.cardLine, { color: colors.ink2 }]}>
        {formatDay(format, group.startsAt, group.event.timezone)}
      </Text>
      <Text style={[styles.cardLine, { color: colors.ink2 }]}>
        {formatEventRange(
          format,
          group.startsAt,
          group.endsAt,
          group.event.timezone,
          t('common.rangeSeparator'),
        )}
      </Text>
      <Text style={[styles.cardLine, { color: colors.ink2 }]}>
        {`${group.organizerName} · ${t('list.ticketCount', { count: group.data.length })}`}
      </Text>
    </View>
  );
}

export function TicketsListScreen() {
  const t = useTranslations('tickets');
  const format = useFormatter();
  const colors = useColors();
  const router = useRouter();
  const session = useSession();
  const offline = useIsOffline();
  const [when, setWhen] = useState<TicketWhen>('upcoming');
  const list = useTicketList(when);
  const { sync, syncing, outcome } = useTicketSync();
  const lastSynced = useLastSynced();

  // One sync when the tab opens (skipped if one just ran): this is what keeps the QR codes on the phone.
  useEffect(() => {
    if (session.status === 'signedIn') void sync({ onlyIfStale: true });
  }, [session.status, sync]);

  const refresh = useCallback(() => void sync({ force: true }), [sync]);
  const pages = list.data?.pages;
  const groups = useMemo(() => groupByEvent(pages?.flatMap((p) => p.data) ?? []), [pages]);
  const open = useCallback((id: string) => router.push(hrefs.ticket(id)), [router]);

  const syncedLine = lastSynced
    ? t('common.syncedAt', {
        when: format.dateTime(new Date(lastSynced), { dateStyle: 'medium', timeStyle: 'short' }),
      })
    : t('common.neverSynced');

  const header = (
    <View style={styles.header}>
      <Heading>{t('list.title')}</Heading>
      <Segmented
        options={[
          { value: 'upcoming', label: t('list.upcoming') },
          { value: 'past', label: t('list.past') },
        ]}
        value={when}
        onChange={setWhen}
      />
      <Caption testID="last-synced">{syncedLine}</Caption>
      {offline ? (
        <Banner tone="info" testID="offline-note">
          {t('common.offline')}
        </Banner>
      ) : null}
      {!offline &&
      (outcome?.kind === 'failed' || (outcome?.kind === 'synced' && outcome.failedDetails > 0)) ? (
        <Banner tone="warning" testID="refresh-failed">
          {t('list.refreshFailed')}
        </Banner>
      ) : null}
    </View>
  );

  let body: ReactNode = null;
  if (list.isPending && list.fetchStatus !== 'paused') {
    body = <Loading label={t('list.loading')} />;
  } else if (list.isPending) {
    body = <EmptyState title={t('list.loadFailed')} body={t('list.offlineNothing')} testID="offline-empty" />;
  } else if (list.isError && !list.data) {
    body = (
      <EmptyState
        title={t('list.loadFailed')}
        action={<Button label={t('common.retry')} onPress={() => void list.refetch()} testID="retry" />}
        testID="list-error"
      />
    );
  } else if (groups.length === 0) {
    body =
      when === 'upcoming' ? (
        <EmptyState
          testID="empty-upcoming"
          title={t('list.emptyUpcomingTitle')}
          body={t('list.emptyUpcomingBody')}
          action={
            <Button
              label={t('list.findEvents')}
              onPress={() => router.push(hrefs.discover())}
              testID="find-events"
            />
          }
        />
      ) : (
        <EmptyState testID="empty-past" title={t('list.emptyPastTitle')} body={t('list.emptyPastBody')} />
      );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.screen, { backgroundColor: colors.canvas }]}
      testID="tickets-screen"
    >
      <PendingLinkResume />
      <SectionList
        sections={body ? [] : groups.map((g) => ({ ...g, data: g.data }))}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TicketCard ticket={item} onOpen={() => open(item.id)} />}
        renderSectionHeader={({ section }) => <GroupHeader group={section as unknown as TicketGroup} />}
        ListHeaderComponent={header}
        ListEmptyComponent={body}
        ListFooterComponent={
          list.isFetchingNextPage ? <Loading label={t('list.loadingMore')} /> : <View style={styles.footer} />
        }
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={refresh}
            accessibilityLabel={t('list.refresh')}
            tintColor={colors.primary}
          />
        }
        testID="tickets-list"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: space[4], paddingBottom: space[10], gap: space[2] },
  header: { gap: space[3], paddingTop: space[4], paddingBottom: space[2] },
  groupHeader: { gap: 2, paddingTop: space[4], paddingBottom: space[2] },
  groupTitle: { fontSize: type.card.size, fontWeight: '800', textAlign: 'auto' },
  card: {
    minHeight: TOUCH_TARGET_PX,
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: px(radius.card),
    overflow: 'hidden',
    marginBottom: space[2],
  },
  accent: { width: space[2] },
  cardText: { flex: 1, padding: space[4], gap: space[1] },
  cardTitle: { fontSize: type.prose.size, fontWeight: '800', textAlign: 'auto' },
  cardLine: { fontSize: type.body.size, textAlign: 'auto' },
  pending: {
    alignSelf: 'flex-start',
    fontSize: type.caption.size,
    fontWeight: '800',
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: px(radius.tag),
    overflow: 'hidden',
  },
  footer: { height: space[6] },
});
