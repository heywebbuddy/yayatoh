'use client';

import type { ModPollDto, ModQuestionDto, ModStateDto } from '@yayatoh/engagement/client';
import { Alert, Button, Card, Chip, EmptyState, Label } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import type { ModeratorIntent } from '@/app/[locale]/o/[org]/e/[event]/sessions/[session]/live/actions.ts';
import { CopySnippet } from '@/components/copy-snippet.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';
import { useLiveState } from './live-state.ts';
import { PollResultsView } from './poll-results.tsx';
import { StreamBadge } from './stream-badge.tsx';

type Act = (input: ModeratorIntent) => Promise<FormState>;
type FormAction = (prev: FormState, form: FormData) => Promise<FormState>;

export interface ShareLinks {
  readonly isPublic: boolean;
  readonly participantUrl: string;
  readonly participantPath: string;
  readonly qr: { readonly d: string; readonly size: number };
  /** Only for members who may moderate (the link is a credential for a public screen). */
  readonly displayPath: string | null;
  readonly displayUrl: string | null;
}

const control = 'min-h-10 w-full rounded-pill border border-zinc-200 bg-white px-4 text-body';
const area = 'w-full rounded-card border border-zinc-200 bg-white px-4 py-2 text-body';

/**
 * The moderator console (M5.7a). Live from the session's moderation channel: questions arrive as
 * they are asked, results move with every vote. Every control is a button or a form field (no
 * drag); outcomes are announced in one polite status line.
 */
export function ModeratorConsole({
  canWrite,
  initial,
  settings,
  streamUrl,
  act,
  createPoll,
  saveSettings,
  share,
}: {
  canWrite: boolean;
  initial: ModStateDto;
  settings: { anonymousIdentity: 'hidden' | 'moderators'; qaOpen: boolean; allowAnonymous: boolean };
  streamUrl: string;
  act: Act;
  createPoll: FormAction;
  saveSettings: FormAction;
  share: ShareLinks;
}) {
  const t = useTranslations('engagement');
  const te = useTranslations();
  const { state, stream } = useLiveState(streamUrl, initial);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const run = (input: ModeratorIntent, done: string) =>
    start(async () => {
      const r = await act(input);
      setStatus(
        r.ok ? { ok: true, text: done } : { ok: false, text: te(errorMessageKey(r.code ?? 'internal')) },
      );
    });
  const pending = state.questions.filter((q) => q.state === 'pending');
  const approved = state.questions.filter((q) => q.state === 'approved');
  const dismissed = state.questions.filter((q) => q.state === 'dismissed');
  const pinned = state.stage.pinnedQuestionId;
  return (
    <div className="flex flex-col gap-6" data-moderator data-stream={streamUrl}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StreamBadge state={stream} />
        <p
          role="status"
          className={status?.ok === false ? 'text-body text-pink-700' : 'text-body text-zinc-900'}
        >
          {status?.text ?? ''}
        </p>
      </div>
      {canWrite ? null : <p className="text-body text-zinc-500">{t('moderator.viewerNotice')}</p>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="queue-heading" className="flex flex-col gap-4">
          <h2 id="queue-heading" className="text-section">
            {t('moderator.questions')}
          </h2>
          <QuestionList
            id="pending"
            title={t('moderator.pending', { count: pending.length })}
            empty={t('moderator.pendingEmpty')}
            list={pending}
            render={(q) =>
              canWrite ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        { intent: 'moderate', questionId: q.id, action: 'approve' },
                        t('moderator.done.approved'),
                      )
                    }
                  >
                    {t('moderator.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(
                        { intent: 'moderate', questionId: q.id, action: 'dismiss' },
                        t('moderator.done.dismissed'),
                      )
                    }
                  >
                    {t('moderator.dismiss')}
                  </Button>
                </>
              ) : null
            }
          />
          <QuestionList
            id="approved"
            title={t('moderator.approved', { count: approved.length })}
            empty={t('moderator.approvedEmpty')}
            list={[...approved].sort(
              (a, b) =>
                Number(b.id === pinned) - Number(a.id === pinned) ||
                Number(a.answered) - Number(b.answered) ||
                b.upvotes - a.upvotes,
            )}
            pinned={pinned}
            render={(q) =>
              canWrite ? (
                <>
                  {q.id === pinned ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => run({ intent: 'pin', questionId: null }, t('moderator.done.unpinned'))}
                    >
                      {t('moderator.unpin')}
                    </Button>
                  ) : q.answered ? null : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => run({ intent: 'pin', questionId: q.id }, t('moderator.done.pinned'))}
                    >
                      {t('moderator.pin')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        { intent: 'moderate', questionId: q.id, action: q.answered ? 'unanswer' : 'answer' },
                        q.answered ? t('moderator.done.unanswered') : t('moderator.done.answered'),
                      )
                    }
                  >
                    {q.answered ? t('moderator.unanswer') : t('moderator.answer')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(
                        { intent: 'moderate', questionId: q.id, action: 'dismiss' },
                        t('moderator.done.dismissed'),
                      )
                    }
                  >
                    {t('moderator.dismiss')}
                  </Button>
                </>
              ) : null
            }
          />
          {dismissed.length > 0 ? (
            <details className="rounded-card border border-zinc-200 p-4">
              <summary className="min-h-6 cursor-pointer text-body">
                {t('moderator.dismissed', { count: dismissed.length })}
              </summary>
              <QuestionList
                id="dismissed"
                title={null}
                empty=""
                list={dismissed}
                render={(q) =>
                  canWrite ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(
                          { intent: 'moderate', questionId: q.id, action: 'approve' },
                          t('moderator.done.approved'),
                        )
                      }
                    >
                      {t('moderator.restore')}
                    </Button>
                  ) : null
                }
              />
            </details>
          ) : null}
        </section>
        <section aria-labelledby="polls-heading" className="flex flex-col gap-4">
          <h2 id="polls-heading" className="text-section">
            {t('moderator.polls')}
          </h2>
          {state.polls.length === 0 ? (
            <EmptyState
              title={t('moderator.noPollsTitle')}
              description={canWrite ? t('moderator.noPolls') : undefined}
            />
          ) : (
            <ol className="flex list-none flex-col gap-3 p-0">
              {state.polls.map((p) => (
                <PollItem
                  key={p.id}
                  poll={p}
                  live={p.id === state.stage.livePollId}
                  canWrite={canWrite}
                  busy={busy}
                  run={run}
                />
              ))}
            </ol>
          )}
          {canWrite ? <CreatePollForm action={createPoll} /> : null}
        </section>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SettingsForm action={saveSettings} settings={settings} canWrite={canWrite} />
        <ShareCard
          share={share}
          canWrite={canWrite}
          busy={busy}
          rotate={() => run({ intent: 'rotate' }, t('moderator.done.rotated'))}
        />
      </div>
    </div>
  );
}

function QuestionList({
  id,
  title,
  empty,
  list,
  pinned = null,
  render,
}: {
  id: string;
  title: string | null;
  empty: string;
  list: readonly ModQuestionDto[];
  pinned?: string | null;
  render: (q: ModQuestionDto) => React.ReactNode;
}) {
  const t = useTranslations('engagement');
  return (
    <section
      aria-labelledby={title ? `${id}-heading` : undefined}
      aria-label={title ? undefined : id}
      className="flex flex-col gap-2"
    >
      {title ? (
        <h3 id={`${id}-heading`} className="text-body font-medium">
          {title}
        </h3>
      ) : null}
      {list.length === 0 ? (
        empty ? (
          <p className="text-body text-zinc-500">{empty}</p>
        ) : null
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0" data-queue={id}>
          {list.map((q) => (
            <li key={q.id} data-question={q.body}>
              <Card className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  {q.id === pinned ? <Chip>{t('onStage')}</Chip> : null}
                  {q.answered ? <Chip tone="neutral">{t('answered')}</Chip> : null}
                  {q.anonymous ? <Chip tone="neutral">{t('moderator.anonymousToAudience')}</Chip> : null}
                </div>
                <p className="text-body break-words">{q.body}</p>
                <p className="text-caption text-zinc-600">
                  {[q.authorName ?? t('anonymous'), t('upvotes', { count: q.upvotes })].join(' · ')}
                </p>
                <div className="flex flex-wrap gap-2">{render(q)}</div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PollItem({
  poll,
  live,
  canWrite,
  busy,
  run,
}: {
  poll: ModPollDto;
  live: boolean;
  canWrite: boolean;
  busy: boolean;
  run: (input: ModeratorIntent, done: string) => void;
}) {
  const t = useTranslations('engagement');
  const [confirm, setConfirm] = useState(false);
  return (
    <li data-poll={poll.question}>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={poll.state === 'open' ? 'accent' : 'neutral'}>{t(`pollState.${poll.state}`)}</Chip>
          <Label>{t(`kinds.${poll.kind}`)}</Label>
          {live ? <Chip>{t('onStage')}</Chip> : null}
          <span className="text-caption text-zinc-600">{t('votes', { count: poll.ballots })}</span>
          <span className="text-caption text-zinc-600">
            {poll.showResults ? t('moderator.resultsShown') : t('moderator.resultsHidden')}
          </span>
        </div>
        <h3 className="text-body font-medium">{poll.question}</h3>
        <PollResultsView
          kind={poll.kind}
          results={poll.results}
          labels={{
            votes: (n) => t('votes', { count: n }),
            average: (n) => t('average', { value: n }),
            noWords: t('noWords'),
          }}
        />
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            {poll.state === 'draft' ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => run({ intent: 'open', pollId: poll.id }, t('moderator.done.opened'))}
              >
                {t('moderator.open')}
              </Button>
            ) : null}
            {poll.state === 'open' ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => run({ intent: 'close', pollId: poll.id }, t('moderator.done.closed'))}
              >
                {t('moderator.close')}
              </Button>
            ) : null}
            {poll.state !== 'draft' ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    { intent: 'results', pollId: poll.id, show: !poll.showResults },
                    poll.showResults ? t('moderator.done.resultsHidden') : t('moderator.done.resultsShown'),
                  )
                }
              >
                {poll.showResults ? t('moderator.hideResults') : t('moderator.showResults')}
              </Button>
            ) : null}
            {poll.state !== 'draft' ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    { intent: 'present', pollId: live ? null : poll.id },
                    live ? t('moderator.done.offStage') : t('moderator.done.onStage'),
                  )
                }
              >
                {live ? t('moderator.takeOffStage') : t('moderator.present')}
              </Button>
            ) : null}
            {confirm ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run({ intent: 'delete', pollId: poll.id }, t('moderator.done.deleted'))}
                >
                  {t('moderator.confirmDelete')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                  {t('moderator.cancel')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
                {t('moderator.delete')}
              </Button>
            )}
          </div>
        ) : null}
      </Card>
    </li>
  );
}

function CreatePollForm({ action }: { action: FormAction }) {
  const t = useTranslations('engagement');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  const [kind, setKind] = useState('single');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setKind('single');
    }
  }, [state]);
  const bad = (f: string) => !state.ok && (state.fields ?? []).includes(f);
  const reason = state.ok ? null : state.reason;
  const optionsError = bad('options')
    ? reason === 'duplicate'
      ? t('moderator.errors.duplicate')
      : t('moderator.errors.options')
    : null;
  const general =
    !state.ok && state.code && !(state.fields ?? []).length ? te(errorMessageKey(state.code)) : null;
  return (
    <section aria-labelledby="new-poll-heading">
      <Card size="panel" className="flex flex-col gap-3">
        <h3 id="new-poll-heading" className="text-body font-medium">
          {t('moderator.newPoll')}
        </h3>
        <form ref={ref} action={formAction} onSubmit={keepValues(formAction)} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="poll-kind" className="text-caption text-zinc-600">
              {t('moderator.kind')}
            </label>
            <select
              id="poll-kind"
              name="kind"
              className={control}
              value={kind}
              onChange={(e) => setKind(e.currentTarget.value)}
            >
              {(['single', 'multi', 'rating', 'word_cloud'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="poll-question" className="text-caption text-zinc-600">
              {t('moderator.question')}
            </label>
            <input
              id="poll-question"
              name="question"
              maxLength={200}
              className={control}
              aria-invalid={bad('question') || undefined}
              aria-describedby={bad('question') ? 'poll-question-error' : undefined}
            />
            {bad('question') ? (
              <p id="poll-question-error" className="text-caption text-pink-700">
                {t('moderator.errors.question')}
              </p>
            ) : null}
          </div>
          {kind === 'single' || kind === 'multi' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="poll-options" className="text-caption text-zinc-600">
                {t('moderator.options')}
              </label>
              <textarea
                id="poll-options"
                name="options"
                rows={4}
                className={area}
                aria-invalid={optionsError ? true : undefined}
                aria-describedby={optionsError ? 'poll-options-error' : 'poll-options-hint'}
              />
              {optionsError ? (
                <p id="poll-options-error" className="text-caption text-pink-700">
                  {optionsError}
                </p>
              ) : (
                <p id="poll-options-hint" className="text-caption text-zinc-500">
                  {t('moderator.optionsHint')}
                </p>
              )}
            </div>
          ) : null}
          {kind === 'multi' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="poll-max" className="text-caption text-zinc-600">
                {t('moderator.maxChoices')}
              </label>
              <input
                id="poll-max"
                name="maxChoices"
                type="number"
                min={1}
                max={10}
                className={control}
                aria-invalid={bad('maxChoices') || undefined}
                aria-describedby={bad('maxChoices') ? 'poll-max-error' : undefined}
              />
              {bad('maxChoices') ? (
                <p id="poll-max-error" className="text-caption text-pink-700">
                  {t('moderator.errors.maxChoices')}
                </p>
              ) : null}
            </div>
          ) : null}
          {kind === 'rating' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="poll-scale" className="text-caption text-zinc-600">
                {t('moderator.scale')}
              </label>
              <select id="poll-scale" name="ratingScale" defaultValue="5" className={control}>
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {t('moderator.scaleOption', { max: n })}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {general ? <Alert title={general} /> : null}
          {state.ok ? (
            <p role="status" className="rounded-card border border-accent-300 bg-accent-50 px-4 py-3 text-body text-accent-text">
              {t('moderator.pollAdded')}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="self-start">
            {t('moderator.addPoll')}
          </Button>
        </form>
      </Card>
    </section>
  );
}

function SettingsForm({
  action,
  settings,
  canWrite,
}: {
  action: FormAction;
  settings: { anonymousIdentity: 'hidden' | 'moderators'; qaOpen: boolean; allowAnonymous: boolean };
  canWrite: boolean;
}) {
  const t = useTranslations('engagement');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <section aria-labelledby="settings-heading">
      <Card size="panel" className="flex flex-col gap-3">
        <h2 id="settings-heading" className="text-section">
          {t('moderator.settings')}
        </h2>
        <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-3">
          <fieldset disabled={!canWrite} className="flex flex-col gap-3">
            <legend className="sr-only">{t('moderator.settings')}</legend>
            <label className="flex min-h-10 items-center gap-3">
              <input type="checkbox" name="qaOpen" defaultChecked={settings.qaOpen} className="size-5" />
              {t('moderator.qaOpen')}
            </label>
            <label className="flex min-h-10 items-center gap-3">
              <input
                type="checkbox"
                name="allowAnonymous"
                defaultChecked={settings.allowAnonymous}
                className="size-5"
              />
              {t('moderator.allowAnonymous')}
            </label>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="anon-identity" className="text-caption text-zinc-600">
                {t('moderator.identity')}
              </label>
              <select
                id="anon-identity"
                name="anonymousIdentity"
                defaultValue={settings.anonymousIdentity}
                className={control}
                aria-describedby="anon-identity-hint"
              >
                <option value="hidden">{t('moderator.identityHidden')}</option>
                <option value="moderators">{t('moderator.identityModerators')}</option>
              </select>
              <p id="anon-identity-hint" className="text-caption text-zinc-500">
                {t('moderator.identityHint')}
              </p>
            </div>
          </fieldset>
          {!state.ok && state.code ? <Alert title={te(errorMessageKey(state.code))} /> : null}
          {state.ok ? (
            <p role="status" className="rounded-card border border-accent-300 bg-accent-50 px-4 py-3 text-body text-accent-text">
              {t('moderator.settingsSaved')}
            </p>
          ) : null}
          {canWrite ? (
            <Button type="submit" variant="secondary" disabled={pending} className="self-start">
              {t('moderator.saveSettings')}
            </Button>
          ) : null}
        </form>
      </Card>
    </section>
  );
}

function ShareCard({
  share,
  canWrite,
  busy,
  rotate,
}: {
  share: ShareLinks;
  canWrite: boolean;
  busy: boolean;
  rotate: () => void;
}) {
  const t = useTranslations('engagement');
  const [confirm, setConfirm] = useState(false);
  return (
    <section aria-labelledby="share-heading">
      <Card size="panel" className="flex flex-col gap-4">
        <h2 id="share-heading" className="text-section">
          {t('moderator.share')}
        </h2>
        {share.isPublic ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <svg
              role="img"
              aria-label={t('qrLabel', { url: share.participantUrl })}
              data-testid="participant-qr"
              viewBox={`0 0 ${share.qr.size} ${share.qr.size}`}
              shapeRendering="crispEdges"
              className="size-32 shrink-0 text-ink"
            >
              <rect width={share.qr.size} height={share.qr.size} className="fill-white" />
              <path d={share.qr.d} fill="currentColor" />
            </svg>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-body">{t('moderator.participantHint')}</p>
              <Link
                href={share.participantPath}
                className="inline-flex min-h-10 items-center break-all underline underline-offset-2"
              >
                {t('moderator.participantLink')}
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-body text-zinc-600">{t('moderator.notPublic')}</p>
        )}
        {canWrite && share.displayPath ? (
          <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3">
            <h3 className="text-body font-medium">{t('moderator.bigScreen')}</h3>
            <p className="text-caption text-zinc-600">{t('moderator.bigScreenHint')}</p>
            <Link
              href={share.displayPath}
              className="inline-flex min-h-10 items-center underline underline-offset-2"
              data-testid="display-link"
            >
              {t('moderator.openBigScreen')}
            </Link>
            {share.displayUrl ? (
              <CopySnippet code={share.displayUrl} label={t('moderator.copyBigScreen')} />
            ) : null}
            {confirm ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setConfirm(false);
                    rotate();
                  }}
                >
                  {t('moderator.confirmRotate')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                  {t('moderator.cancel')}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="self-start" onClick={() => setConfirm(true)}>
                {t('moderator.rotate')}
              </Button>
            )}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
