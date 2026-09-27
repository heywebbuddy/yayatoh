import { cx } from '@yayatoh/ui';

export interface ListedMessage {
  readonly key: string;
  readonly direction: 'in' | 'out';
  readonly subject: string | null;
  readonly body: string;
  readonly author: string;
  readonly when: string;
}

/** A conversation, oldest first. `out` is the organizer; `in` is the contact. */
export function MessageList({ messages, label }: { messages: readonly ListedMessage[]; label: string }) {
  return (
    <ol aria-label={label} className="flex list-none flex-col gap-3 p-0">
      {messages.map((m) => (
        <li
          key={m.key}
          className={cx(
            'flex max-w-[85%] flex-col gap-1 rounded-card border px-4 py-3',
            m.direction === 'out'
              ? 'self-end border-zinc-200 bg-zinc-50'
              : 'self-start border-zinc-200 bg-white',
          )}
        >
          <p className="text-caption text-zinc-500">
            {m.author} · {m.when}
          </p>
          {m.subject ? <p className="text-body font-medium">{m.subject}</p> : null}
          <p className="whitespace-pre-line text-body">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
