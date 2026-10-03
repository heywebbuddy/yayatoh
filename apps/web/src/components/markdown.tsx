import { type MdInline, parseMarkdown } from '@yayatoh/events/ui';
import { Fragment, type ReactNode } from 'react';

/**
 * Organizer Markdown (sections, announcements, private info) as React elements. The parser keeps
 * raw HTML as text and only http(s)/mailto links, so nothing here is ever injected as HTML.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={className ?? 'flex flex-col gap-3 text-body leading-6 text-ink-2'}>
      {blocks.map((b, i) => {
        const key = `${b.t}-${i}`;
        if (b.t === 'h')
          return b.level === 2 ? (
            <h3 key={key} className="text-section text-ink">
              <Inline nodes={b.c} />
            </h3>
          ) : (
            <h4 key={key} className="font-medium text-ink">
              <Inline nodes={b.c} />
            </h4>
          );
        if ('items' in b) {
          const List = b.t;
          return (
            <List key={key} className={b.t === 'ul' ? 'list-disc ps-5' : 'list-decimal ps-5'}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inline nodes={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={key}>
            <Inline nodes={b.c} />
          </p>
        );
      })}
    </div>
  );
}

function Inline({ nodes }: { nodes: readonly MdInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        const k = i;
        let node: ReactNode = null;
        switch (n.t) {
          case 'text':
            node = <Fragment key={k}>{n.v}</Fragment>;
            break;
          case 'code':
            node = (
              <code key={k} className="rounded-tag bg-surface-3 px-1 font-mono text-[0.9em]">
                {n.v}
              </code>
            );
            break;
          case 'strong':
            node = (
              <strong key={k} className="font-semibold">
                <Inline nodes={n.c} />
              </strong>
            );
            break;
          case 'em':
            node = (
              <em key={k}>
                <Inline nodes={n.c} />
              </em>
            );
            break;
          case 'link':
            node = (
              <a
                key={k}
                href={n.href}
                rel="noopener noreferrer nofollow"
                className="underline underline-offset-2"
              >
                <Inline nodes={n.c} />
              </a>
            );
            break;
        }
        return node;
      })}
    </>
  );
}
