'use client';

import { cx } from '@yayatoh/ui';
import { Check, Link2, MessageCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Heading } from './model.ts';

const LINKEDIN_GLYPH = 'in';
const X_GLYPH = 'X';

/** A thin bar at the top of the window that fills as the article is read (applied through the DOM after mount). */
export function ReadingProgress({ label, targetId }: { label: string; targetId: string }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    const target = document.getElementById(targetId);
    if (!el || !target) return;
    const update = () => {
      const r = target.getBoundingClientRect();
      const total = r.height - window.innerHeight * 0.6;
      const p = total <= 0 ? 1 : Math.min(1, Math.max(0, -r.top / total));
      el.style.transform = `scaleX(${p.toFixed(3)})`;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [targetId]);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-[60] h-1 bg-transparent"
    >
      <div ref={bar} className="h-full origin-left scale-x-0 bg-linear-to-r from-ember via-flame to-rose" />
    </div>
  );
}

/** The table of contents: links to the headings; the one being read is highlighted. */
export function Toc({ headings, label }: { headings: readonly Heading[]; label: string }) {
  const [active, setActive] = useState(headings[0]?.id ?? '');
  useEffect(() => {
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((e): e is HTMLElement => e !== null);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );
    for (const e of els) io.observe(e);
    return () => io.disconnect();
  }, [headings]);
  if (headings.length === 0) return null;
  return (
    <nav aria-label={label} className="flex flex-col gap-3">
      <p className="m-0 text-caption font-bold tracking-widest text-ink-3 uppercase">{label}</p>
      <ol className="m-0 flex list-none flex-col gap-1 border-s border-line p-0">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              aria-current={active === h.id ? 'location' : undefined}
              className={cx(
                '-ms-px block border-s-2 py-1.5 text-body leading-snug transition-colors motion-reduce:transition-none',
                h.level === 3 ? 'ps-6' : 'ps-4',
                active === h.id
                  ? 'border-ember font-bold text-ink'
                  : 'border-transparent text-ink-2 hover:text-ink',
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Share to WhatsApp, LinkedIn and X, or copy the link. The page's own address is read in the browser. */
export function ShareButtons({
  title,
  label,
  whatsapp,
  linkedin,
  x,
  copy,
  copied,
}: {
  title: string;
  label: string;
  whatsapp: string;
  linkedin: string;
  x: string;
  copy: string;
  copied: string;
}) {
  const [url, setUrl] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => setUrl(window.location.href.split('#')[0] ?? ''), []);
  const enc = encodeURIComponent;
  const btn =
    'inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-ink transition-colors hover:border-ember hover:text-ember motion-reduce:transition-none';
  const share = (href: string) => (url ? href : '#');
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-caption font-bold tracking-widest text-ink-3 uppercase">{label}</p>
      <div className="flex flex-wrap gap-2">
        <a
          href={share(`https://wa.me/?text=${enc(`${title} ${url}`)}`)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={whatsapp}
          title={whatsapp}
          className={btn}
        >
          <MessageCircle aria-hidden="true" className="size-5" />
          <span className="sr-only">{whatsapp}</span>
        </a>
        <a
          href={share(`https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={linkedin}
          title={linkedin}
          className={btn}
        >
          <span aria-hidden="true" className="font-display text-[16px] leading-none font-black">
            {LINKEDIN_GLYPH}
          </span>
          <span className="sr-only">{linkedin}</span>
        </a>
        <a
          href={share(`https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}`)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={x}
          title={x}
          className={btn}
        >
          <span aria-hidden="true" className="font-display text-[18px] leading-none font-black">
            {X_GLYPH}
          </span>
          <span className="sr-only">{x}</span>
        </a>
        <button
          type="button"
          aria-label={copy}
          title={copy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setDone(true);
              setTimeout(() => setDone(false), 2000);
            } catch {
              /* clipboard blocked: the address bar still has it */
            }
          }}
          className={btn}
        >
          {done ? (
            <Check aria-hidden="true" className="size-5" />
          ) : (
            <Link2 aria-hidden="true" className="size-5" />
          )}
        </button>
      </div>
      <p role="status" className="m-0 min-h-5 text-caption text-ink-2">
        {done ? copied : ''}
      </p>
    </div>
  );
}
