'use client';

import {
  NAME_MAX_LENGTH,
  type ParticipantStateDto,
  type PublicLiveStateDto,
  type PublicPollDto,
  type PublicQuestionDto,
  publicOrder,
  QUESTION_MAX_LENGTH,
  WORD_MAX_LENGTH,
} from '@yayatoh/engagement/client';
import { Alert, Button, Chip, EmptyState, Label, PageHeader } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import type { LiveActionState } from '@/app/[locale]/events/[slug]/live/[session]/actions.ts';
import { Link } from '@/i18n/navigation.ts';
import { keepValues } from '@/lib/keep-values.ts';
import { useLiveState } from './live-state.ts';
import { PollResultsView } from './poll-results.tsx';
import { StreamBadge } from './stream-badge.tsx';

type Vote = (pollId: string, prev: LiveActionState, form: FormData) => Promise<LiveActionState>;
type Ask = (prev: LiveActionState, form: FormData) => Promise<LiveActionState>;
type Upvote = (questionId: string) => Promise<LiveActionState>;

const IDLE: LiveActionState = { ok: false, code: null };
/** Public and phone pages: 44 px targets (the owner's UX bar). */
const field = 'min-h-11 w-full rounded-card border border-zinc-200 bg-white px-4 py-2 text-body';
const choiceRow =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-card border border-zinc-200 px-4 py-2';

/**
 * The participant view (M5.7a): the poll on stage (or any open poll) to vote in, the Q&A form, and
 * the approved questions to upvote. Everything updates live; after a dropped connection the stream
 * resumes or sends a fresh snapshot.
 */
export function ParticipantView({
  eventName,
  eventHref,
  sessionTitle,
  initial,
  me,
  defaultName,
  streamUrl,
  vote,
  ask,
  upvote,
}: {
  eventName: string;
  eventHref: string;
  sessionTitle: string;
  initial: PublicLiveStateDto;
  me: ParticipantStateDto;
  defaultName: string;
  streamUrl: string;
  vote: Vote;
  ask: Ask;
  upvote: Upvote;
}) {
  const t = useTranslations('engagement');
  const { state, stream } = useLiveState(streamUrl, initial);
  const [voted, setVoted] = useState<ReadonlySet<string>>(() => new Set(me.votedPollIds));
  const [upvoted, setUpvoted] = useState<ReadonlySet<string>>(() => new Set(me.upvotedQuestionIds));
  const open = state.polls.filter((p) => p.state === 'open');
  // The poll on stage first, then other open polls; closed polls with shown results after.
  const onStage = state.polls.find((p) => p.id === state.stage.livePollId);
  const polls = [
    ...(onStage ? [onStage] : []),
    ...open.filter((p) => p.id !== onStage?.id),
    ...state.polls.filter((p) => p.state === 'closed' && p.results && p.id !== onStage?.id),
  ];
  const questions = publicOrder(state.questions, state.stage.pinnedQuestionId);
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow={<Label>{eventName}</Label>}
        title={sessionTitle}
        description={t('participant.description')}
        actions={<StreamBadge state={stream} />}
      />
      <section aria-labelledby="live-polls-heading" className="flex flex-col gap-4">
        <h2 id="live-polls-heading" className="text-section">
          {t('participant.pollsHeading')}
        </h2>
        {polls.length === 0 ? (
          <EmptyState title={t('participant.noPollTitle')} description={t('participant.noPoll')} />
        ) : (
          polls.map((p) => (
            <PollCard
              key={p.id}
              poll={p}
              hasVoted={voted.has(p.id)}
              vote={vote.bind(null, p.id)}
              onVoted={() => setVoted((s) => (s.has(p.id) ? s : new Set(s).add(p.id)))}
            />
          ))
        )}
      </section>
      <section aria-labelledby="live-qa-heading" className="flex flex-col gap-4">
        <h2 id="live-qa-heading" className="text-section">
          {t('participant.qaHeading')}
        </h2>
        {state.stage.qaOpen ? (
          <AskForm
            ask={ask}
            allowAnonymous={state.stage.allowAnonymous}
            namesToModerators={state.stage.namesToModerators}
            defaultName={defaultName}
            pending={me.pendingQuestions}
          />
        ) : (
          <Alert tone="info" title={t('participant.qaClosed')} />
        )}
        {questions.length === 0 ? (
          <EmptyState title={t('participant.noQuestionsTitle')} description={t('participant.noQuestions')} />
        ) : (
          <ol className="flex list-none flex-col gap-3 p-0" aria-label={t('participant.questionsList')}>
            {questions.map((q) => (
              <QuestionItem
                key={q.id}
                q={q}
                pinned={q.id === state.stage.pinnedQuestionId}
                upvoted={upvoted.has(q.id)}
                upvote={upvote}
                onUpvoted={() => setUpvoted((s) => (s.has(q.id) ? s : new Set(s).add(q.id)))}
              />
            ))}
          </ol>
        )}
      </section>
      <Link
        href={eventHref}
        className="inline-flex min-h-11 items-center self-start underline underline-offset-2"
      >
        {t('participant.backToEvent')}
      </Link>
    </main>
  );
}

function useMessage() {
  const t = useTranslations('engagement.errors');
  return (code: string | null) => {
    if (!code) return null;
    const known = [
      'already_voted',
      'already_upvoted',
      'closed',
      'qa_closed',
      'rate_limited',
      'choose_one',
      'too_many',
      'unknown_option',
      'rating',
      'word',
      'required',
      'not_allowed',
      'not_found',
    ];
    return t(known.includes(code) ? code : 'unknown');
  };
}

function PollCard({
  poll,
  hasVoted,
  vote,
  onVoted,
}: {
  poll: PublicPollDto;
  hasVoted: boolean;
  vote: (prev: LiveActionState, form: FormData) => Promise<LiveActionState>;
  onVoted: () => void;
}) {
  const t = useTranslations('engagement');
  const message = useMessage();
  const id = useId();
  const [state, action, pending] = useActionState(vote, IDLE);
  const [clientError, setClientError] = useState<string | null>(null);
  useEffect(() => {
    if (state.ok || state.code === 'already_voted') onVoted();
  }, [state, onVoted]);
  const done = hasVoted || state.ok;
  const error = clientError ?? (state.ok ? null : message(state.code));
  const errorId = `${id}-error`;
  const labels = {
    votes: (n: number) => t('votes', { count: n }),
    average: (n: string) => t('average', { value: n }),
    noWords: t('noWords'),
  };
  return (
    <article
      aria-labelledby={`${id}-q`}
      className="flex flex-col gap-4 rounded-card border border-zinc-200 p-4 sm:p-5"
      data-poll={poll.question}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chip tone={poll.state === 'open' ? 'accent' : 'neutral'}>
          {poll.state === 'open' ? t('pollState.open') : t('pollState.closed')}
        </Chip>
        <span className="text-caption text-zinc-600">{t('votes', { count: poll.ballots })}</span>
      </div>
      <h3 id={`${id}-q`} className="text-[20px] font-medium">
        {poll.question}
      </h3>
      {poll.state === 'open' && !done ? (
        <form
          action={action}
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const empty =
              poll.kind === 'word_cloud'
                ? !String(f.get('word') ?? '').trim()
                : poll.kind === 'rating'
                  ? !f.get('rating')
                  : f.getAll('option').length === 0;
            const tooMany = poll.kind === 'multi' && f.getAll('option').length > poll.maxChoices;
            const problem = empty
              ? message(
                  poll.kind === 'word_cloud' ? 'word' : poll.kind === 'rating' ? 'rating' : 'choose_one',
                )
              : tooMany
                ? message('too_many')
                : null;
            setClientError(problem);
            if (!problem) keepValues(action)(e);
          }}
        >
          {poll.kind === 'word_cloud' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-word`} className="text-caption text-zinc-600">
                {t('participant.yourWord')}
              </label>
              <input
                id={`${id}-word`}
                name="word"
                maxLength={WORD_MAX_LENGTH}
                autoComplete="off"
                className={field}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
            </div>
          ) : (
            <fieldset
              className="flex flex-col gap-2"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : `${id}-hint`}
            >
              <legend className="sr-only">{poll.question}</legend>
              <p id={`${id}-hint`} className="text-caption text-zinc-600">
                {poll.kind === 'multi'
                  ? t('participant.chooseUpTo', { count: poll.maxChoices })
                  : poll.kind === 'rating'
                    ? t('participant.rateHint', { max: poll.ratingScale ?? 5 })
                    : t('participant.chooseOne')}
              </p>
              {poll.kind === 'rating' ? (
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: poll.ratingScale ?? 5 }, (_, i) => String(i + 1)).map((v) => (
                    <label key={v} className={`${choiceRow} min-w-11 justify-center font-medium`}>
                      <input type="radio" name="rating" value={v} className="size-5" />
                      {v}
                    </label>
                  ))}
                </div>
              ) : (
                poll.options.map((o) => (
                  <label key={o.id} className={choiceRow}>
                    <input
                      type={poll.kind === 'single' ? 'radio' : 'checkbox'}
                      name="option"
                      value={o.id}
                      className="size-5 shrink-0"
                    />
                    <span>{o.label}</span>
                  </label>
                ))
              )}
            </fieldset>
          )}
          {error ? (
            <p id={errorId} role="alert" className="text-caption text-pink-700">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={pending} className="self-start">
            {t('participant.vote')}
          </Button>
        </form>
      ) : null}
      {done ? (
        <p role="status" className="rounded-card border border-accent-300 bg-accent-50 px-4 py-3 text-body text-accent-text">
          {t('participant.voted')}
        </p>
      ) : null}
      {poll.results ? (
        <PollResultsView kind={poll.kind} results={poll.results} labels={labels} />
      ) : done ? (
        <p className="text-caption text-zinc-600">{t('participant.resultsLater')}</p>
      ) : null}
    </article>
  );
}

function AskForm({
  ask,
  allowAnonymous,
  namesToModerators,
  defaultName,
  pending: waiting,
}: {
  ask: Ask;
  allowAnonymous: boolean;
  namesToModerators: boolean;
  defaultName: string;
  pending: number;
}) {
  const t = useTranslations('engagement');
  const message = useMessage();
  const [state, action, pending] = useActionState(ask, IDLE);
  const [anonymous, setAnonymous] = useState(false);
  const [length, setLength] = useState(0);
  const [clientError, setClientError] = useState<{ field: string; message: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setLength(0);
      setAnonymous(false);
    }
  }, [state]);
  const serverField = state.ok ? null : (state.field ?? (state.code === 'required' ? 'body' : null));
  const bodyError =
    clientError?.field === 'body'
      ? clientError.message
      : serverField === 'body'
        ? message(state.code === 'required' ? 'required' : state.code)
        : null;
  const nameError =
    clientError?.field === 'name' ? clientError.message : serverField === 'name' ? t('errors.name') : null;
  const formError = !state.ok && state.code && !serverField ? message(state.code) : null;
  return (
    <form
      ref={formRef}
      action={action}
      noValidate
      aria-labelledby="ask-heading"
      className="flex flex-col gap-3 rounded-card border border-zinc-200 p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const problem = !String(f.get('body') ?? '').trim()
          ? { field: 'body', message: t('errors.required') }
          : f.get('anonymous') !== 'on' && !String(f.get('name') ?? '').trim()
            ? { field: 'name', message: t('errors.name') }
            : null;
        setClientError(problem);
        if (!problem) keepValues(action)(e);
      }}
    >
      <h3 id="ask-heading" className="text-body font-medium">
        {t('participant.askHeading')}
      </h3>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ask-body" className="text-caption text-zinc-600">
          {t('participant.yourQuestion')}
        </label>
        <textarea
          id="ask-body"
          name="body"
          rows={3}
          maxLength={QUESTION_MAX_LENGTH}
          className={field}
          onChange={(e) => setLength(e.currentTarget.value.length)}
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? 'ask-body-error' : 'ask-body-count'}
        />
        <p id="ask-body-count" className="text-caption text-zinc-500">
          {t('participant.charactersLeft', { count: QUESTION_MAX_LENGTH - length })}
        </p>
        {bodyError ? (
          <p id="ask-body-error" className="text-caption text-pink-700">
            {bodyError}
          </p>
        ) : null}
      </div>
      {anonymous && !namesToModerators ? null : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ask-name" className="text-caption text-zinc-600">
            {t('participant.yourName')}
          </label>
          <input
            id="ask-name"
            name="name"
            defaultValue={defaultName}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="name"
            className={field}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'ask-name-error' : undefined}
          />
          {nameError ? (
            <p id="ask-name-error" className="text-caption text-pink-700">
              {nameError}
            </p>
          ) : null}
        </div>
      )}
      {allowAnonymous ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            name="anonymous"
            className="size-5"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.currentTarget.checked)}
          />
          <span>{t('participant.anonymous')}</span>
        </label>
      ) : null}
      {anonymous ? (
        <p className="text-caption text-zinc-600">
          {namesToModerators ? t('participant.anonymousHintModerators') : t('participant.anonymousHint')}
        </p>
      ) : null}
      {formError ? <Alert title={formError} /> : null}
      {state.ok || waiting > 0 ? (
        <p role="status" className="rounded-card border border-accent-300 bg-accent-50 px-4 py-3 text-body text-accent-text">
          {t('participant.sent')}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {t('participant.send')}
      </Button>
    </form>
  );
}

function QuestionItem({
  q,
  pinned,
  upvoted,
  upvote,
  onUpvoted,
}: {
  q: PublicQuestionDto;
  pinned: boolean;
  upvoted: boolean;
  upvote: Upvote;
  onUpvoted: () => void;
}) {
  const t = useTranslations('engagement');
  const message = useMessage();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex flex-col gap-2 rounded-card border border-zinc-200 p-4" data-question={q.body}>
      <div className="flex flex-wrap gap-2">
        {pinned ? <Chip>{t('onStage')}</Chip> : null}
        {q.answered ? <Chip tone="neutral">{t('answered')}</Chip> : null}
      </div>
      <p className="text-body break-words">{q.body}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-caption text-zinc-600">{q.authorName ?? t('anonymous')}</span>
        <Button
          variant="secondary"
          size="lg"
          aria-pressed={upvoted}
          disabled={upvoted || busy}
          onClick={() =>
            start(async () => {
              const r = await upvote(q.id);
              if (r.ok || r.code === 'already_upvoted') onUpvoted();
              setError(r.ok || r.code === 'already_upvoted' ? null : message(r.code));
            })
          }
        >
          {t('participant.upvote', { count: q.upvotes })}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-caption text-pink-700">
          {error}
        </p>
      ) : null}
    </li>
  );
}
