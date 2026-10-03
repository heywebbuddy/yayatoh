'use client';

import { Button, cx, Textarea } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, type ReactNode, useActionState, useEffect, useRef, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { useRealtime } from '@/lib/use-realtime.ts';

/**
 * One chat conversation (M5.8b), shared by attendees and an exhibitor's booth people: the
 * messages as a live log (a polite live region, so new messages are announced), and the composer
 * (Enter sends, Shift+Enter adds a line; the Send button too). New messages arrive over the
 * caller's own inbox stream; a reconnect that can't be replayed re-reads the page. Messages the
 * organizer removed show as removed. Without script, the form still posts and the page reloads.
 */
export interface ChatMessageView {
  readonly id: string;
  readonly body: string | null;
  readonly fromMe: boolean;
  readonly removed: boolean;
  /** ISO time. */
  readonly at: string;
}

interface Wire extends ChatMessageView {
  readonly conversationId: string;
}

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

function merge(a: readonly ChatMessageView[], b: readonly ChatMessageView[]): ChatMessageView[] {
  const byId = new Map<string, ChatMessageView>();
  for (const m of [...a, ...b]) {
    const seen = byId.get(m.id);
    // A removal wins over an earlier copy of the same message.
    byId.set(m.id, seen?.removed ? seen : m);
  }
  return [...byId.values()].sort((x, y) => (x.at === y.at ? (x.id < y.id ? -1 : 1) : x.at < y.at ? -1 : 1));
}

export function ChatThread({
  messages: initial,
  conversationId,
  streamUrl,
  channel,
  timeZone,
  locale,
  otherName,
  send,
  markRead,
  closed,
}: {
  messages: readonly ChatMessageView[];
  conversationId: string | null;
  /** The caller's inbox stream (their own channel is passed along as `channel`). */
  streamUrl: string;
  channel: string | null;
  timeZone: string;
  locale: string;
  /** The other side as the viewer knows them (a person's name, an exhibitor's, "Visitor"). */
  otherName: string;
  send: Action;
  markRead?: () => Promise<FormState>;
  /** Why no message may be sent now (replaces the composer), or null. */
  closed: ReactNode | null;
}) {
  const t = useTranslations('chat');
  const tAll = useTranslations();
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessageView[]>(() => merge([], initial));
  const form = useRef<HTMLFormElement>(null);
  const reading = useRef(false);

  // A re-rendered page (after sending, or a snapshot) brings the stored messages: merge them.
  useEffect(() => setMessages((cur) => merge(cur, initial)), [initial]);

  const read = () => {
    if (!markRead || !conversationId || reading.current) return;
    reading.current = true;
    void markRead().finally(() => {
      reading.current = false;
    });
  };

  const url = channel ? `${streamUrl}?channel=${encodeURIComponent(channel)}` : null;
  const state = useRealtime(url, ['message', 'removed', 'snapshot'], {
    message: (data) => {
      const m = data as Wire | null;
      if (!m) return;
      if (!conversationId) {
        // The first message of a new chat: the page learns its conversation by re-reading.
        if (m.fromMe) router.refresh();
        return;
      }
      if (m.conversationId !== conversationId) return;
      setMessages((cur) => merge(cur, [m]));
      if (!m.fromMe) read();
    },
    removed: (data) => {
      const r = data as { conversationId: string; id: string } | null;
      if (!r || r.conversationId !== conversationId) return;
      setMessages((cur) => cur.map((m) => (m.id === r.id ? { ...m, body: null, removed: true } : m)));
    },
    snapshot: () => router.refresh(),
  });

  const [result, action, pending] = useActionState(async (prev: FormState, data: FormData) => {
    const r = await send(prev, data);
    if (r.ok) {
      form.current?.reset();
      router.refresh();
    }
    return r;
  }, INITIAL_FORM_STATE);

  const refusal = (() => {
    if (result.ok || !result.code) return null;
    const key = `chat.errors.${result.reason ?? result.code}`;
    return tAll.has(key) ? tAll(key) : tAll(errorMessageKey(result.code));
  })();
  const bodyError = !result.ok && result.fields?.includes('body') ? refusal : null;

  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' });
  const day = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' });
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      form.current?.requestSubmit();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <p className="text-body text-ink-2">{t('noMessages', { name: otherName })}</p>
      ) : null}
      <ol
        role="log"
        aria-live="polite"
        aria-label={t('logLabel', { name: otherName })}
        className="m-0 flex list-none flex-col gap-2 p-0"
      >
        {messages.map((m, i) => {
          const at = new Date(m.at);
          const prev = messages[i - 1];
          const newDay = !prev || day.format(new Date(prev.at)) !== day.format(at);
          return (
            <li key={m.id} className="flex flex-col gap-2" data-chat-message={m.fromMe ? 'mine' : 'theirs'}>
              {newDay ? <p className="self-center text-caption text-ink-2">{day.format(at)}</p> : null}
              <div
                className={cx(
                  'flex max-w-[85%] flex-col gap-1 rounded-card px-3.5 py-2.5',
                  m.fromMe ? 'self-end bg-primary-soft text-primary-ink' : 'self-start bg-surface-3 text-ink',
                )}
              >
                <span className="sr-only">{m.fromMe ? t('you') : otherName}: </span>
                {m.removed ? (
                  <span className="text-body italic text-ink-2">{t('removed')}</span>
                ) : (
                  <span className="text-body whitespace-pre-wrap break-words">{m.body}</span>
                )}
                <time dateTime={m.at} className="self-end text-caption tabular-nums opacity-80">
                  {time.format(at)}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
      {closed ? (
        <div className="rounded-card border border-line bg-surface p-4 text-body text-ink-2">{closed}</div>
      ) : (
        <form ref={form} action={action} className="flex flex-col gap-2" noValidate>
          <Textarea
            id="chat-body"
            name="body"
            label={t('messageLabel')}
            hint={t('messageHint')}
            error={bodyError ?? undefined}
            rows={3}
            maxLength={2000}
            onKeyDown={onKey}
            required
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-caption text-ink-2" aria-live="polite">
              {state === 'live' ? t('live') : state === 'offline' ? t('reconnecting') : t('connecting')}
            </span>
            <Button type="submit" variant="primary" loading={pending}>
              {t('send')}
            </Button>
          </div>
          {refusal && !bodyError && !pending ? (
            <p role="alert" className="text-caption font-semibold text-danger">
              {refusal}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}

/** A list of chats that re-reads itself when a message arrives on the viewer's inbox. */
export function ChatInboxLive({ streamUrl, channel }: { streamUrl: string; channel: string | null }) {
  const router = useRouter();
  useRealtime(
    channel ? `${streamUrl}?channel=${encodeURIComponent(channel)}` : null,
    ['message', 'removed'],
    {
      message: () => router.refresh(),
      removed: () => router.refresh(),
    },
  );
  return null;
}
