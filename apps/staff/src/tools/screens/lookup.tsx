import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useTools } from '../deps';
import { downloadManifest, type HolderMatch, type LookupOutcome, lookupHolders } from '../lookup';
import { Body, Button, Card, Empty, ErrorState, Field, Heading, Loading, Notice, Row, Screen } from '../ui';
import { ManualCheckInPanel } from './manual-panel';

/** Find a guest by name, phone or email, then check them in by hand with a reason (M7.4c). */
export function LookupScreen() {
  const t = useTranslations('tools');
  const core = useTranslations('core');
  const { device, staff, manifest, useOffline } = useTools();
  const offline = useOffline();
  const eventId = device?.eventId ?? '';
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<LookupOutcome | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  // The phone's saved manifest first (M7.4b); without one, the manifest pages are downloaded
  // through the device's staff route and held in memory only.
  const saved = useQuery({
    queryKey: ['tools', 'manifest-saved', eventId],
    queryFn: manifest,
    meta: { persist: false },
    enabled: !!device,
  });
  const download = useQuery({
    queryKey: ['tools', 'manifest-download', eventId],
    queryFn: () => downloadManifest(staff as NonNullable<typeof staff>, eventId),
    enabled: !!device && !!staff && saved.isSuccess && !saved.data && !offline,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    meta: { persist: false },
  });
  const source = saved.data ?? download.data ?? null;

  if (!device)
    return (
      <Screen>
        <Empty title={t('hub.none')} />
      </Screen>
    );

  async function search() {
    if (!source) return;
    setOpen(null);
    setOutcome(await lookupHolders(source, text));
  }

  const loading = saved.isPending || (download.isFetching && !download.data);

  return (
    <Screen testID="lookup-screen">
      <Field
        autoComplete="off"
        label={t('lookup.queryLabel')}
        hint={t('lookup.queryHint')}
        value={text}
        onChangeText={setText}
        onSubmitEditing={search}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        error={outcome?.state === 'too_short' ? t('lookup.tooShort') : null}
        testID="lookup-query"
      />
      <Button label={t('lookup.search')} onPress={search} disabled={!source} testID="lookup-search" />
      {loading ? <Loading label={t('lookup.loading')} /> : null}
      {download.isError && !source ? (
        <ErrorState
          message={t('lookup.loadFailed')}
          retryLabel={core('common.retry')}
          onRetry={() => download.refetch()}
        />
      ) : null}
      {saved.isSuccess && !source && !loading && !download.isError ? (
        <Notice tone="warn" testID="lookup-unavailable">
          {t('lookup.unavailable')}
        </Notice>
      ) : null}
      {source ? (
        <Body muted testID="lookup-source">
          {source.origin === 'device' ? t('lookup.sourceDevice') : t('lookup.sourceDownload')}
        </Body>
      ) : null}
      {outcome?.state === 'done' ? (
        outcome.matches.length === 0 ? (
          <Empty title={t('lookup.none')} body={t('lookup.noneBody')} />
        ) : (
          <>
            <Heading level={2}>{t('lookup.results', { count: outcome.matches.length })}</Heading>
            {outcome.matches.map((m) => (
              <MatchCard
                key={m.ticketId}
                match={m}
                open={open === m.ticketId}
                admitted={m.admittedHere || !!done[m.ticketId]}
                onOpen={() => setOpen(m.ticketId)}
                onClose={(r) => {
                  setOpen(null);
                  if (r && r.via !== 'none' && (r.result === 'admitted' || r.result === 'provisional'))
                    setDone((d) => ({ ...d, [m.ticketId]: true }));
                }}
              />
            ))}
          </>
        )
      ) : null}
    </Screen>
  );
}

function MatchCard({
  match,
  open,
  admitted,
  onOpen,
  onClose,
}: {
  match: HolderMatch;
  open: boolean;
  admitted: boolean;
  onOpen: () => void;
  onClose: (r: Parameters<React.ComponentProps<typeof ManualCheckInPanel>['onClose']>[0]) => void;
}) {
  const t = useTranslations('tools');
  const void_ = match.status === 'void';
  return (
    <Card testID={`match-${match.shortCode}`}>
      <Heading level={2}>{match.holderName}</Heading>
      <Body muted>{t('lookup.pass', { type: match.typeName, code: match.shortCode })}</Body>
      {void_ ? <Notice tone="stop">{t('lookup.voidPass')}</Notice> : null}
      {admitted && !void_ ? <Notice tone="info">{t('lookup.admittedHere')}</Notice> : null}
      {open ? (
        <ManualCheckInPanel shortCode={match.shortCode} holderName={match.holderName} onClose={onClose} />
      ) : (
        <Row>
          <Button
            label={t('lookup.checkIn')}
            onPress={onOpen}
            disabled={void_}
            testID={`checkin-${match.shortCode}`}
            a11yLabel={t('lookup.checkInFor', { name: match.holderName })}
          />
        </Row>
      )}
    </Card>
  );
}
