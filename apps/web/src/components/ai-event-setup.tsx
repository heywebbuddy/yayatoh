'use client';

import { timeZoneLabel } from '@yayatoh/ai/ui';
import { Alert, Button, Input, Select, Textarea } from '@yayatoh/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';
import type {
  CreateFromAiState,
  EventSetupProposal,
} from '@/app/[locale]/o/[org]/(org)/events/new/ai/actions.ts';
import { AiComposePanel } from '@/components/ai-compose-panel.tsx';
import { useRouter } from '@/i18n/navigation.ts';
import type { AiComposeResult, AiComposeSetup, AiComposeValues } from '@/lib/ai-compose.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Draft = EventSetupProposal['draft'];

const toInput = (local: string) => local.replace(' ', 'T');

/** One list the organizer can trim: a heading and rows that each have a Remove button. */
function RowList({ title, children, empty }: { title: string; children: React.ReactNode[]; empty: string }) {
  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <legend className="mb-1 text-[15px] font-extrabold">{title}</legend>
      {children.length > 0 ? children : <p className="m-0 text-body text-ink-2">{empty}</p>}
    </fieldset>
  );
}

/**
 * The reviewable proposal: every part is editable and every list can be trimmed. Pressing Create
 * makes a draft event through the normal commands; until then nothing exists. Parts the
 * organization cannot use (no ticketing or sessions module) are noted instead of silently lost.
 */
function Review({
  org,
  proposal,
  profiles,
  modules,
  create,
  onDiscard,
}: {
  org: string;
  proposal: EventSetupProposal;
  profiles: readonly { key: string; label: string }[];
  modules: { ticketing: boolean; sessions: boolean };
  create: (payload: unknown) => Promise<CreateFromAiState>;
  onDiscard: () => void;
}) {
  const t = useTranslations('aiSetup');
  const te = useTranslations();
  const id = useId();
  const router = useRouter();
  const locale = useLocale();
  const d: Draft = proposal.draft;
  const [requestKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(d.name);
  const [tagline, setTagline] = useState(d.tagline);
  const [profile, setProfile] = useState<string>(d.profile);
  const [startsLocal, setStarts] = useState(toInput(d.startsLocal));
  const [endsLocal, setEnds] = useState(toInput(d.endsLocal));
  const [venueName, setVenue] = useState(d.venueName);
  const [city, setCity] = useState(d.city);
  const [description, setDescription] = useState(d.description);
  const [tickets, setTickets] = useState(d.tickets.map((x) => ({ ...x, price: String(x.price) })));
  const [agenda, setAgenda] = useState(d.agenda.map((x) => ({ ...x, startsLocal: x.startsLocal })));
  const [faqs, setFaqs] = useState(d.faqs);
  const [repeatDays, setRepeatDays] = useState(String(d.repeatDays));
  const [pickups, setPickups] = useState(d.pickups.join('\n'));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await create({
        requestKey,
        name,
        tagline,
        profile,
        startsLocal,
        endsLocal,
        venueName,
        city,
        timezone: proposal.timezone,
        repeatDays: Number(repeatDays) || 0,
        pickups: pickups
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
        description,
        tickets,
        agenda,
        faqs,
      });
      if (res.ok && res.slug) {
        const note = res.skipped && res.skipped.length > 0 ? '&partial=1' : '';
        router.push(`/o/${org}/e/${res.slug}/media?created=1${note}`);
        return;
      }
      setError(te(errorMessageKey(res.code)));
    });

  const remove = <T,>(list: T[], set: (v: T[]) => void, i: number) => set(list.filter((_, j) => j !== i));
  const rowBox = 'flex flex-col gap-3 rounded-tile border border-line bg-surface-2 p-3.5';

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Alert tone="info" title={t('review.title')}>
        {t('review.hint')}
      </Alert>
      <div className="grid gap-4 md:grid-cols-2">
        <Input
          id={`${id}-name`}
          label={t('fields.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={160}
          required
        />
        <Select
          id={`${id}-profile`}
          label={t('fields.profile')}
          value={profile}
          onValueChange={setProfile}
          options={profiles.map((p) => ({ value: p.key, label: p.label, text: p.label }))}
        />
        <Input
          id={`${id}-tagline`}
          label={t('fields.tagline')}
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          maxLength={280}
          className="md:col-span-2"
        />
        <Input
          id={`${id}-starts`}
          type="datetime-local"
          label={t('fields.starts')}
          hint={timeZoneLabel(proposal.timezone, locale)}
          value={startsLocal}
          onChange={(e) => setStarts(e.target.value)}
          required
        />
        <Input
          id={`${id}-ends`}
          type="datetime-local"
          label={t('fields.ends')}
          value={endsLocal}
          onChange={(e) => setEnds(e.target.value)}
          required
        />
        <Input
          id={`${id}-venue`}
          label={t('fields.venue')}
          value={venueName}
          onChange={(e) => setVenue(e.target.value)}
          maxLength={160}
        />
        <Input
          id={`${id}-city`}
          label={t('fields.city')}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          maxLength={120}
        />
        {profile === 'tour' ? (
          <>
            <Input
              id={`${id}-repeat`}
              type="number"
              min={0}
              max={30}
              label={t('fields.repeatDays')}
              hint={t('fields.repeatDaysHint')}
              value={repeatDays}
              onChange={(e) => setRepeatDays(e.target.value)}
            />
            <Textarea
              id={`${id}-pickups`}
              label={t('fields.pickups')}
              hint={t('fields.pickupsHint')}
              rows={3}
              value={pickups}
              onChange={(e) => setPickups(e.target.value)}
            />
          </>
        ) : null}
      </div>
      <Textarea
        id={`${id}-desc`}
        label={t('fields.description')}
        rows={6}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={6000}
        hint={t('fields.descriptionHint')}
      />

      <RowList title={t('tickets.title')} empty={t('tickets.none')}>
        {modules.ticketing
          ? tickets.map((tk, i) => (
              <div key={`${tk.name}-${i}`} className={rowBox}>
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                  <Input
                    id={`${id}-t${i}-n`}
                    label={t('tickets.name')}
                    value={tk.name}
                    onChange={(e) =>
                      setTickets(tickets.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                    maxLength={120}
                  />
                  <Input
                    id={`${id}-t${i}-p`}
                    label={t('tickets.price', { currency: proposal.currency })}
                    inputMode="decimal"
                    value={tk.price}
                    onChange={(e) =>
                      setTickets(tickets.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                    }
                  />
                  <Input
                    id={`${id}-t${i}-q`}
                    label={t('tickets.quantity')}
                    inputMode="numeric"
                    value={String(tk.quantity)}
                    onChange={(e) =>
                      setTickets(
                        tickets.map((x, j) =>
                          j === i ? { ...x, quantity: Number(e.target.value.replace(/\D/g, '')) || 1 } : x,
                        ),
                      )
                    }
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(tickets, setTickets, i)}
                  >
                    {t('remove')}
                  </Button>
                </div>
              </div>
            ))
          : [
              <p key="off" className="m-0 text-body text-ink-2">
                {t('tickets.off')}
              </p>,
            ]}
      </RowList>

      <RowList title={t('agenda.title')} empty={t('agenda.none')}>
        {modules.sessions
          ? agenda.map((s, i) => (
              <div key={`${s.startsLocal}-${i}`} className={rowBox}>
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                  <Input
                    id={`${id}-a${i}-t`}
                    label={t('agenda.session')}
                    value={s.title}
                    onChange={(e) =>
                      setAgenda(agenda.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                    }
                    maxLength={160}
                  />
                  <Input
                    id={`${id}-a${i}-s`}
                    type="datetime-local"
                    label={t('agenda.starts')}
                    value={toInput(s.startsLocal)}
                    onChange={(e) =>
                      setAgenda(agenda.map((x, j) => (j === i ? { ...x, startsLocal: e.target.value } : x)))
                    }
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(agenda, setAgenda, i)}
                  >
                    {t('remove')}
                  </Button>
                </div>
              </div>
            ))
          : [
              <p key="off" className="m-0 text-body text-ink-2">
                {t('agenda.off')}
              </p>,
            ]}
      </RowList>

      <RowList title={t('faqs.title')} empty={t('faqs.none')}>
        {faqs.map((f, i) => (
          <div key={`${f.question}-${i}`} className={rowBox}>
            <Input
              id={`${id}-f${i}-q`}
              label={t('faqs.question')}
              value={f.question}
              onChange={(e) =>
                setFaqs(faqs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))
              }
              maxLength={300}
            />
            <Textarea
              id={`${id}-f${i}-a`}
              label={t('faqs.answer')}
              rows={2}
              value={f.answer}
              onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
              maxLength={1500}
            />
            <div>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(faqs, setFaqs, i)}>
                {t('remove')}
              </Button>
            </div>
          </div>
        ))}
      </RowList>

      <div role="status" aria-live="polite">
        {error ? <Alert title={error} /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? t('creating') : t('create')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDiscard} disabled={pending}>
          {t('discard')}
        </Button>
        <p className="m-0 text-caption text-ink-2">{t('confirmNote')}</p>
      </div>
    </form>
  );
}

/**
 * "Create with AI" in the console: describe the event, review the proposal, edit it, and only
 * then create a draft. Credits, rate limits and the AI-off state come from the shared AI panel.
 */
export function AiEventSetup({
  org,
  setup,
  profiles,
  modules,
  propose,
  create,
}: {
  org: string;
  setup: AiComposeSetup;
  profiles: readonly { key: string; label: string }[];
  modules: { ticketing: boolean; sessions: boolean };
  propose: (values: AiComposeValues) => Promise<AiComposeResult<EventSetupProposal>>;
  create: (payload: unknown) => Promise<CreateFromAiState>;
}) {
  const t = useTranslations('aiSetup');
  return (
    <AiComposePanel<EventSetupProposal>
      setup={setup}
      run={propose}
      voice={false}
      briefRequired
      briefLabel={t('brief')}
      briefHint={t('briefHint')}
      draftLabel={t('propose')}
      renderPreview={(value, done) => (
        <Review
          org={org}
          proposal={value}
          profiles={profiles}
          modules={modules}
          create={create}
          onDiscard={() => done()}
        />
      )}
    />
  );
}
