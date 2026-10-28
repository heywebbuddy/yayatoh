import { type MdInline, parseMarkdown } from '@yayatoh/events/ui';
import { Fragment } from 'react';
import { headingsOf } from './model.ts';

function Inline({ nodes }: { nodes: readonly MdInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        const key = `${n.t}-${i}`;
        if (n.t === 'text') return <Fragment key={key}>{n.v}</Fragment>;
        if (n.t === 'code')
          return (
            <code key={key} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[0.88em]">
              {n.v}
            </code>
          );
        if (n.t === 'strong')
          return (
            <strong key={key} className="font-bold text-ink">
              <Inline nodes={n.c} />
            </strong>
          );
        if (n.t === 'em')
          return (
            <em key={key}>
              <Inline nodes={n.c} />
            </em>
          );
        return (
          <a
            key={key}
            href={n.href}
            rel="noopener noreferrer nofollow"
            className="font-semibold text-ember underline decoration-ember/40 underline-offset-4 hover:decoration-ember"
          >
            <Inline nodes={n.c} />
          </a>
        );
      })}
    </>
  );
}

/**
 * A post's body, typeset for reading: a comfortable measure, large type, generous spacing, anchored
 * headings (the table of contents links to them), lists, pull quotes, images with captions and code.
 * The Markdown subset is parsed, never injected as HTML.
 */
export function Article({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  const ids = headingsOf(source);
  let h = 0;
  return (
    <div className="flex max-w-[44rem] flex-col gap-6 text-[18px] leading-[1.8] text-ink-2">
      {blocks.map((b, i) => {
        const key = `${b.t}-${i}`;
        if (b.t === 'h') {
          const id = ids[h++]?.id;
          return b.level === 2 ? (
            <h2
              key={key}
              id={id}
              className="m-0 mt-6 scroll-mt-28 font-display text-[clamp(1.6rem,3vw,2.2rem)] leading-tight font-black tracking-[-0.02em] text-ink uppercase"
            >
              <Inline nodes={b.c} />
            </h2>
          ) : (
            <h3
              key={key}
              id={id}
              className="m-0 mt-2 scroll-mt-28 text-[22px] leading-snug font-extrabold text-ink"
            >
              <Inline nodes={b.c} />
            </h3>
          );
        }
        if (b.t === 'quote')
          return (
            <blockquote
              key={key}
              className="m-0 rounded-[28px] border-s-4 border-ember bg-surface p-7 font-display text-[clamp(1.2rem,2.4vw,1.7rem)] leading-snug font-bold text-ink"
            >
              <Inline nodes={b.c} />
            </blockquote>
          );
        if (b.t === 'img')
          return (
            <figure key={key} className="m-0 flex flex-col gap-2">
              <img
                src={b.src}
                alt={b.alt}
                loading="lazy"
                decoding="async"
                className="h-auto w-full rounded-[28px] border border-line object-cover"
              />
              {b.alt ? <figcaption className="text-caption text-ink-3">{b.alt}</figcaption> : null}
            </figure>
          );
        if (b.t === 'pre')
          return (
            <pre
              key={key}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable code block must be focusable
              tabIndex={0}
              className="m-0 overflow-x-auto rounded-[20px] border border-line bg-surface p-5 font-mono text-[15px] leading-relaxed text-ink"
            >
              <code>{b.v}</code>
            </pre>
          );
        if ('items' in b) {
          const List = b.t;
          return (
            <List
              key={key}
              className={
                b.t === 'ul'
                  ? 'm-0 flex list-disc flex-col gap-2 ps-6 marker:text-ember'
                  : 'm-0 flex list-decimal flex-col gap-2 ps-6 marker:font-bold marker:text-ember'
              }
            >
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inline nodes={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={key} className="m-0">
            <Inline nodes={b.c} />
          </p>
        );
      })}
    </div>
  );
}
