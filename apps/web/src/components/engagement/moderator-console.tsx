'use client';

import type { ModPollDto, ModQuestionDto, ModStateDto } from '@yayatoh/engagement/client';
import {
  Alert,
  Avatar,
  Button,
  buttonClass,
  Checkbox,
  cardClass,
  cx,
  EmptyState,
  Input,
  Select,
  StatusDot,
  StatusPill,
  Tag,
  Textarea,
} from '@yayatoh/ui';
import { ChartColumn, ExternalLink, MessageCircleQuestion, Monitor } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import type { ModeratorIntent } from '@/app/[locale]/o/[org]/e/[event]/sessions/[session]/live/actions.ts';
import { CopySnippet } from '@/components/copy-snippet.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { initialsOf } from '@/lib/initials.ts';
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

/** A panel of the console (ADR 0022 `Card size="panel"`), as a labelled section. */
const PANEL = cx(cardClass('default', 'panel'), 'flex flex-col gap-5');
/** A row inside a panel: an inset tile. */
const ROW = 'flex flex-col gap-3 rounded-tile border border-line bg-surface-2 p-4';
const POLL_TONE = { draft: 'waiting', open: 'success', closed: 'neutral' } as const;

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
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <StreamBadge state={stream} />
        <p
          role="status"
          className={cx('m-0 text-body font-semibold', status?.ok === false ? 'text-danger' : 'text-ink')}
        >
          {status?.text ?? ''}
        </p>
      </div>
      {canWrite ? null : <Alert tone="info" title={t('moderator.viewerNotice')} />}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="queue-heading" className={PANEL}>
          <h2 id="queue-heading" className="m-0 text-card text-ink">
            {t('moderator.questions')}
          </h2>
          <QuestionList
            id="pending"
            title={t('moderator.pending', { count: pending.length })}
            empty={t('moderator.pendingEmpty')}
            emptyAction={
              <Link href="#share-heading" className={buttonClass('secondary', 'md')}>
                {t('moderator.shareAudienceLink')}
              </Link>
            }
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
            emptyAction={
              canWrite && pending.length > 0 ? (
                <Link href="#pending-heading" className={buttonClass('primary', 'md')}>
                  {t('moderator.reviewWaiting')}
                </Link>
              ) : (
                <Link href="#settings-heading" className={buttonClass('secondary', 'md')}>
                  {t('moderator.checkSettings')}
                </Link>
              )
            }
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
            <details className="rounded-tile border border-line bg-surface-2 px-4 py-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-body font-bold text-primary-ink">
                {t('moderator.dismissed', { count: dismissed.length })}
              </summary>
              <div className="pt-2 pb-2">
                <QuestionList
                  id="dismissed"
                  title={null}
                  label={t('moderator.dismissed', { count: dismissed.length })}
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
              </div>
            </details>
          ) : null}
        </section>
        <section aria-labelledby="polls-heading" className={PANEL}>
          <h2 id="polls-heading" className="m-0 text-card text-ink">
            {t('moderator.polls')}
          </h2>
          {state.polls.length === 0 ? (
            <EmptyState
              icon={<ChartColumn />}
              className="py-8"
              title={t('moderator.noPollsTitle')}
              description={canWrite ? t('moderator.noPolls') : t('moderator.noPollsViewer')}
              action={
                canWrite ? (
                  <Link href="#new-poll-heading" className={buttonClass('primary', 'md')}>
                    {t('moderator.createFirstPoll')}
                  </Link>
                ) : (
                  <Link href="#share-heading" className={buttonClass('secondary', 'md')}>
                    {t('moderator.howToJoin')}
                  </Link>
                )
              }
            />
          ) : (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
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
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
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
  emptyAction,
  list,
  pinned = null,
  label,
  render,
}: {
  id: string;
  title: string | null;
  /** The list's name when it has no visible heading. */
  label?: string;
  empty: string;
  /** The next step offered when the list is empty. */
  emptyAction?: React.ReactNode;
  list: readonly ModQuestionDto[];
  pinned?: string | null;
  render: (q: ModQuestionDto) => React.ReactNode;
}) {
  const t = useTranslations('engagement');
  return (
    <section
      aria-labelledby={title ? `${id}-heading` : undefined}
      aria-label={title ? undefined : label}
      className="flex flex-col gap-3"
    >
      {title ? (
        <h3 id={`${id}-heading`} className="m-0 text-body font-extrabold text-ink tabular-nums">
          {title}
        </h3>
      ) : null}
      {list.length === 0 ? (
        empty ? (
          <EmptyState icon={<MessageCircleQuestion />} className="py-8" title={empty} action={emptyAction} />
        ) : null
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-queue={id}>
          {list.map((q) => {
            const actions = render(q);
            return (
              <li key={q.id} data-question={q.body} className={cx(ROW, q.id === pinned && 'border-primary')}>
                {q.id === pinned || q.answered || q.anonymous ? (
                  <div className="flex flex-wrap gap-2">
                    {q.id === pinned ? <StatusPill tone="brand" label={t('onStage')} live /> : null}
                    {q.answered ? <StatusPill tone="success" label={t('answered')} /> : null}
                    {q.anonymous ? (
                      <StatusPill tone="neutral" label={t('moderator.anonymousToAudience')} />
                    ) : null}
                  </div>
                ) : null}
                <p className="m-0 text-body font-semibold break-words text-ink">{q.body}</p>
                <div className="flex items-center gap-2">
                  {q.authorName ? (
                    <Avatar initials={initialsOf(q.authorName)} label={q.authorName} size={24} decorative />
                  ) : null}
                  <p className="m-0 text-caption text-ink-2 tabular-nums">
                    {[q.authorName ?? t('anonymous'), t('upvotes', { count: q.upvotes })].join(' · ')}
                  </p>
                </div>
                {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
              </li>
            );
          })}
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
    <li data-poll={poll.question} className={cx(ROW, live && 'border-primary')}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill
          tone={POLL_TONE[poll.state]}
          label={t(`pollState.${poll.state}`)}
          live={poll.state === 'open'}
        />
        {live ? <StatusPill tone="brand" label={t('onStage')} /> : null}
        <Tag>{t(`kinds.${poll.kind}`)}</Tag>
        <span className="text-caption font-bold text-ink tabular-nums">
          {t('votes', { count: poll.ballots })}
        </span>
        {poll.state === 'draft' ? null : (
          <StatusDot
            status={poll.showResults ? 'success' : 'neutral'}
            label={poll.showResults ? t('moderator.resultsShown') : t('moderator.resultsHidden')}
          />
        )}
      </div>
      <h3 className="m-0 text-card text-ink">{poll.question}</h3>
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
              variant="dark"
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
                variant="danger"
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
    : undefined;
  const general =
    !state.ok && state.code && !(state.fields ?? []).length ? te(errorMessageKey(state.code)) : null;
  return (
    <section aria-labelledby="new-poll-heading" className="flex flex-col gap-4 border-t border-line pt-5">
      <h3 id="new-poll-heading" className="m-0 text-body font-extrabold text-ink">
        {t('moderator.newPoll')}
      </h3>
      <form
        ref={ref}
        action={formAction}
        onSubmit={keepValues(formAction)}
        noValidate
        className="flex flex-col gap-4"
      >
        <Select
          id="poll-kind"
          name="kind"
          label={t('moderator.kind')}
          value={kind}
          onValueChange={(v) => setKind(v)}
        >
          {(['single', 'multi', 'rating', 'word_cloud'] as const).map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </Select>
        <Input
          id="poll-question"
          name="question"
          maxLength={200}
          label={t('moderator.question')}
          error={bad('question') ? t('moderator.errors.question') : undefined}
        />
        {kind === 'single' || kind === 'multi' ? (
          <Textarea
            id="poll-options"
            name="options"
            rows={4}
            label={t('moderator.options')}
            hint={t('moderator.optionsHint')}
            error={optionsError}
          />
        ) : null}
        {kind === 'multi' ? (
          <Input
            id="poll-max"
            name="maxChoices"
            type="number"
            min={1}
            max={10}
            label={t('moderator.maxChoices')}
            error={bad('maxChoices') ? t('moderator.errors.maxChoices') : undefined}
          />
        ) : null}
        {kind === 'rating' ? (
          <Select id="poll-scale" name="ratingScale" defaultValue="5" label={t('moderator.scale')}>
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {t('moderator.scaleOption', { max: n })}
              </option>
            ))}
          </Select>
        ) : null}
        {general ? <Alert title={general} /> : null}
        {state.ok ? <Alert tone="success" title={t('moderator.pollAdded')} /> : null}
        <Button type="submit" disabled={pending} className="self-start">
          {t('moderator.addPoll')}
        </Button>
      </form>
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
    <section aria-labelledby="settings-heading" className={PANEL}>
      <h2 id="settings-heading" className="m-0 text-card text-ink">
        {t('moderator.settings')}
      </h2>
      <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col gap-4">
        <fieldset disabled={!canWrite} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <legend className="sr-only">{t('moderator.settings')}</legend>
          <div className="flex flex-col">
            <Checkbox
              id="live-qa-open"
              name="qaOpen"
              defaultChecked={settings.qaOpen}
              label={t('moderator.qaOpen')}
            />
            <Checkbox
              id="live-allow-anonymous"
              name="allowAnonymous"
              defaultChecked={settings.allowAnonymous}
              label={t('moderator.allowAnonymous')}
            />
          </div>
          <Select
            id="anon-identity"
            name="anonymousIdentity"
            defaultValue={settings.anonymousIdentity}
            label={t('moderator.identity')}
            hint={t('moderator.identityHint')}
          >
            <option value="hidden">{t('moderator.identityHidden')}</option>
            <option value="moderators">{t('moderator.identityModerators')}</option>
          </Select>
        </fieldset>
        {!state.ok && state.code ? <Alert title={te(errorMessageKey(state.code))} /> : null}
        {state.ok ? <Alert tone="success" title={t('moderator.settingsSaved')} /> : null}
        {canWrite ? (
          <Button type="submit" variant="secondary" disabled={pending} className="self-start">
            {t('moderator.saveSettings')}
          </Button>
        ) : null}
      </form>
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
    <section aria-labelledby="share-heading" className={PANEL}>
      <h2 id="share-heading" className="m-0 text-card text-ink">
        {t('moderator.share')}
      </h2>
      {share.isPublic ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* QR codes stay black on white in both themes, so every phone can read them. */}
          <svg
            role="img"
            aria-label={t('qrLabel', { url: share.participantUrl })}
            data-testid="participant-qr"
            viewBox={`0 0 ${share.qr.size} ${share.qr.size}`}
            shapeRendering="crispEdges"
            className="size-36 shrink-0 rounded-tile border border-line bg-white p-2 text-black"
          >
            <rect width={share.qr.size} height={share.qr.size} className="fill-white" />
            <path d={share.qr.d} fill="currentColor" />
          </svg>
          <div className="flex min-w-0 flex-col items-start gap-3">
            <p className="m-0 text-body text-ink-2">{t('moderator.participantHint')}</p>
            <Link href={share.participantPath} className={buttonClass('secondary')}>
              <ExternalLink aria-hidden="true" />
              {t('moderator.participantLink')}
            </Link>
          </div>
        </div>
      ) : (
        <Alert tone="info" title={t('moderator.notPublic')} />
      )}
      {canWrite && share.displayPath ? (
        <div className="flex flex-col gap-3 border-t border-line pt-5">
          <h3 className="m-0 text-body font-extrabold text-ink">{t('moderator.bigScreen')}</h3>
          <p className="m-0 text-caption text-ink-2">{t('moderator.bigScreenHint')}</p>
          <Link
            href={share.displayPath}
            className={buttonClass('secondary', 'md', 'self-start')}
            data-testid="display-link"
          >
            <Monitor aria-hidden="true" />
            {t('moderator.openBigScreen')}
          </Link>
          {share.displayUrl ? (
            <CopySnippet code={share.displayUrl} label={t('moderator.copyBigScreen')} />
          ) : null}
          {confirm ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="danger"
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
    </section>
  );
}
