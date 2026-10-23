import { useQuery } from '@tanstack/react-query';
import {
  type SnapshotGuest,
  type SnapshotParty,
  searchGuests,
  snapshotLabels,
} from '@yayatoh/checkin-engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { useTools } from '../deps';
import { createGuestOutbox, type FlushOutcome, loadGuests } from '../guest-checkin';
import {
  Body,
  Button,
  Card,
  Chip,
  Empty,
  ErrorState,
  Field,
  Heading,
  Loading,
  Notice,
  Row,
  Screen,
} from '../ui';

type Mark = 'waiting' | 'already' | 'unknown' | 'done';

/** Guest-list check-in by name or party, offline too (M7.4c, M4.4b). */
export function GuestsScreen() {
  const t = useTranslations('tools');
  const core = useTranslations('core');
  const format = useFormatter();
  const tools = useTools();
  const { device, staff, vault, clock, newId } = tools;
  const offline = tools.useOffline();
  const eventId = device?.eventId ?? '';
  const [text, setText] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [pending, setPending] = useState(0);
  const [sendNote, setSendNote] = useState<'sent' | 'failed' | null>(null);

  const guests = useQuery({
    queryKey: ['tools', 'guests', eventId],
    queryFn: () => loadGuests(offline ? null : staff, vault, eventId, clock.now),
    enabled: !!device,
    meta: { persist: false },
  });

  const outbox = useMemo(
    () =>
      createGuestOutbox({
        vault,
        api: offline ? null : staff,
        eventId,
        now: clock.now,
        clockOffsetMs: clock.offsetMs,
        newId,
      }),
    [vault, staff, offline, eventId, clock, newId],
  );

  const flush = useCallback(async (): Promise<FlushOutcome> => {
    const r = await outbox.flush();
    setPending(r.pending);
    setMarks((m) => {
      const next = { ...m };
      for (const g of r.already) next[g] = 'already';
      for (const g of r.unknown) next[g] = 'unknown';
      return next;
    });
    return r;
  }, [outbox]);

  // Whatever is still queued from earlier (an earlier session, a lost connection) goes out when
  // the screen opens and whenever the connection returns.
  useEffect(() => {
    outbox.load().then((items) => {
      setPending(items.length);
      setMarks((m) => {
        const next = { ...m };
        for (const i of items) next[i.guestId] ??= 'waiting';
        return next;
      });
      if (items.length > 0 && !offline) void flush();
    });
  }, [outbox, offline, flush]);

  const snapshot = guests.data?.snapshot ?? null;
  const allLabels = useMemo(() => (snapshot ? snapshotLabels(snapshot) : []), [snapshot]);
  const found = useMemo(
    () => (snapshot ? searchGuests(snapshot, text, labels) : []),
    [snapshot, text, labels],
  );

  async function checkIn(guestId: string) {
    await outbox.add(guestId);
    setMarks((m) => ({ ...m, [guestId]: 'waiting' }));
    setPending((await outbox.load()).length);
    if (!offline) {
      const r = await flush();
      setMarks((m) => {
        const next = { ...m };
        for (const i of [guestId]) if (next[i] === 'waiting' && r.pending === 0) next[i] = 'done';
        return next;
      });
    }
  }

  async function sendNow() {
    const r = await flush();
    setSendNote(r.failed ? 'failed' : 'sent');
    setMarks((m) => {
      const next = { ...m };
      if (r.pending === 0) for (const k of Object.keys(next)) if (next[k] === 'waiting') next[k] = 'done';
      return next;
    });
  }

  if (!device)
    return (
      <Screen>
        <Empty title={t('hub.none')} />
      </Screen>
    );
  if (guests.isPending)
    return (
      <Screen>
        <Loading label={t('guests.loading')} />
      </Screen>
    );
  if (guests.isError)
    return (
      <Screen>
        <ErrorState
          message={t('guests.loadFailed')}
          retryLabel={core('common.retry')}
          onRetry={() => guests.refetch()}
        />
      </Screen>
    );
  if (!guests.data)
    return (
      <Screen>
        <Notice tone="warn">{t('guests.unavailable')}</Notice>
      </Screen>
    );

  const parties = snapshot?.parties ?? [];
  const searching = text.trim() !== '' || labels.length > 0;

  return (
    <Screen testID="guests-screen">
      {guests.data.source === 'saved' ? (
        <Notice tone="info" testID="guests-saved">
          {t('guests.savedCopy', {
            time: format.dateTime(new Date(guests.data.savedAt), { hour: 'numeric', minute: '2-digit' }),
          })}
        </Notice>
      ) : null}
      {pending > 0 ? (
        <Card testID="guests-pending">
          <Body>{t('guests.pending', { count: pending })}</Body>
          <Row>
            <Button label={t('guests.sendNow')} onPress={sendNow} disabled={offline} testID="guests-send" />
          </Row>
        </Card>
      ) : null}
      {sendNote ? (
        <Notice tone={sendNote === 'sent' ? 'ok' : 'warn'}>
          {sendNote === 'sent' ? t('guests.sent') : t('guests.sendFailed')}
        </Notice>
      ) : null}
      {parties.length === 0 ? (
        <Empty title={t('guests.emptyList')} />
      ) : (
        <>
          <Field
            autoComplete="off"
            label={t('guests.searchLabel')}
            value={text}
            onChangeText={setText}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            testID="guests-query"
          />
          {allLabels.length > 0 ? (
            <>
              <Body muted>{t('guests.labels')}</Body>
              <Row>
                {allLabels.map((l) => (
                  <Chip
                    key={l}
                    label={l}
                    selected={labels.includes(l.toLowerCase())}
                    onPress={() =>
                      setLabels((cur) =>
                        cur.includes(l.toLowerCase())
                          ? cur.filter((x) => x !== l.toLowerCase())
                          : [...cur, l.toLowerCase()],
                      )
                    }
                    testID={`label-${l}`}
                  />
                ))}
              </Row>
            </>
          ) : null}
          {!searching ? <Body muted>{t('guests.prompt')}</Body> : null}
          {searching && found.length === 0 ? (
            <Empty title={t('guests.none')} body={t('guests.noneBody')} />
          ) : null}
          {found.map((party) => (
            <PartyCard key={party.id} party={party} marks={marks} onCheckIn={checkIn} />
          ))}
        </>
      )}
    </Screen>
  );
}

function PartyCard({
  party,
  marks,
  onCheckIn,
}: {
  party: SnapshotParty;
  marks: Record<string, Mark>;
  onCheckIn: (guestId: string) => void;
}) {
  return (
    <Card testID={`party-${party.id}`}>
      <Heading level={2}>{party.name}</Heading>
      {party.tags.length > 0 ? <Body muted>{party.tags.join(' · ')}</Body> : null}
      {party.guests.map((g) => (
        <GuestRow key={g.id} guest={g} mark={marks[g.id]} onCheckIn={() => onCheckIn(g.id)} />
      ))}
    </Card>
  );
}

function GuestRow({
  guest,
  mark,
  onCheckIn,
}: {
  guest: SnapshotGuest;
  mark: Mark | undefined;
  onCheckIn: () => void;
}) {
  const t = useTranslations('tools');
  const format = useFormatter();
  const name =
    guest.name ?? (guest.guestOf ? t('guests.guestOf', { name: guest.guestOf }) : t('guests.unnamed'));
  const arrived = guest.arrivedAt !== null || mark === 'done' || mark === 'already';
  const places = guest.places.map((p) => p.label).join(', ') || t('guests.noPlace');
  return (
    <Card testID={`guest-${guest.id}`}>
      <Body>{name}</Body>
      <Body muted>
        {t(`guests.status.${guest.status}`)} · {places}
      </Body>
      {guest.arrivedAt ? (
        <Notice tone="ok">
          {t('guests.arrived', {
            time: format.dateTime(new Date(guest.arrivedAt), { hour: 'numeric', minute: '2-digit' }),
          })}
        </Notice>
      ) : null}
      {mark === 'waiting' ? <Notice tone="info">{t('guests.waiting')}</Notice> : null}
      {mark === 'done' ? <Notice tone="ok">{t('guests.sent')}</Notice> : null}
      {mark === 'already' ? <Notice tone="warn">{t('guests.already', { name })}</Notice> : null}
      {mark === 'unknown' ? <Notice tone="stop">{t('guests.unknown', { name })}</Notice> : null}
      {!arrived && mark !== 'waiting' && mark !== 'unknown' && guest.status !== 'declined' ? (
        <Button
          label={t('guests.checkIn')}
          a11yLabel={t('guests.checkInFor', { name })}
          onPress={onCheckIn}
          testID={`guest-checkin-${guest.id}`}
        />
      ) : null}
    </Card>
  );
}
