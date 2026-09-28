'use client';

import { Alert, buttonClass } from '@yayatoh/ui';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type DragEvent, type ReactNode, useEffect, useRef, useState, useTransition } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';
import type { FormState } from '@/lib/form-state.ts';

export interface SectionItem {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly visible: boolean;
}

const DRAG_TYPE = 'application/x-yayatoh-section';

/**
 * The event's content sections in page order (M1.4d). Reorder by dragging a row, or with the
 * Move up / Move down buttons (the keyboard and screen-reader path); every move is announced.
 */
export function SectionList({
  sections,
  editors,
  canWrite,
  move,
  reorder,
}: {
  sections: readonly SectionItem[];
  editors: Readonly<Record<string, ReactNode>>;
  canWrite: boolean;
  move: (sectionId: string, direction: 'up' | 'down') => Promise<FormState>;
  reorder: (order: string[]) => Promise<FormState>;
}) {
  const t = useTranslations('content');
  const te = useTranslations();
  const [order, setOrder] = useState(sections);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // A move is saving from the click until the server answers (not until the page refresh after
  // it). A keyboard press in that time is queued, never dropped: people press Enter again as soon
  // as they hear the first move announced.
  const saving = useRef(false);
  const queued = useRef<{ id: string; direction: 'up' | 'down' } | null>(null);
  const orderNow = useRef(order);
  orderNow.current = order;
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  useEffect(() => setOrder(sections), [sections]);
  // After a move commits, put focus back on the moved row's button (buttons stay enabled while a
  // move is saving, so keyboard focus is never dropped).
  useEffect(() => {
    if (!focusTarget) return;
    buttons.current.get(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const announce = (next: readonly SectionItem[], id: string) => {
    const i = next.findIndex((s) => s.id === id);
    const s = next[i];
    if (s) setMessage(t('moved', { title: s.title, position: i + 1, total: next.length }));
  };
  const run = (
    next: readonly SectionItem[],
    id: string,
    call: () => Promise<FormState>,
    focusKey: string,
  ) => {
    const before = orderNow.current;
    orderNow.current = next;
    setOrder(next);
    setError(null);
    saving.current = true;
    startTransition(async () => {
      const res = await call();
      saving.current = false;
      if (!res.ok) {
        queued.current = null;
        orderNow.current = before;
        setOrder(before);
        setError(te(errorMessageKey(res.code)));
        return;
      }
      announce(next, id);
      // Keep focus on the moved row: the same button, or its sibling once it hits an end.
      const i = next.findIndex((s) => s.id === id);
      setFocusTarget(
        focusKey.endsWith(':up') && i === 0
          ? `${id}:down`
          : focusKey.endsWith(':down') && i === next.length - 1
            ? `${id}:up`
            : focusKey,
      );
      const again = queued.current;
      queued.current = null;
      if (again) step(again.id, again.direction);
    });
  };
  const step = (id: string, direction: 'up' | 'down') => {
    if (saving.current) {
      queued.current = { id, direction };
      return;
    }
    const current = orderNow.current;
    const i = current.findIndex((s) => s.id === id);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= current.length) return;
    const next = [...current];
    [next[i], next[j]] = [next[j] as SectionItem, next[i] as SectionItem];
    run(next, id, () => move(id, direction), `${id}:${direction}`);
  };
  const drop = (e: DragEvent<HTMLLIElement>, targetId: string) => {
    e.preventDefault();
    if (saving.current) return;
    const id = e.dataTransfer.getData(DRAG_TYPE) || dragging;
    setDragging(null);
    if (!id || id === targetId) return;
    const moving = order.find((s) => s.id === id);
    if (!moving) return;
    const rest = order.filter((s) => s.id !== id);
    const at = rest.findIndex((s) => s.id === targetId);
    const from = order.findIndex((s) => s.id === id);
    const to = order.findIndex((s) => s.id === targetId);
    // Dropping on a row below puts it after that row; on a row above, before it.
    const next = [...rest.slice(0, from < to ? at + 1 : at), moving, ...rest.slice(from < to ? at + 1 : at)];
    run(next, id, () => reorder(next.map((s) => s.id)), `${id}:up`);
  };

  return (
    <div className="flex flex-col gap-3">
      {canWrite ? <p className="text-caption text-zinc-500">{t('reorderHint')}</p> : null}
      <ol aria-label={t('sectionsLabel')} className="flex list-none flex-col gap-2 p-0">
        {order.map((s, i) => (
          <li
            key={s.id}
            draggable={canWrite}
            data-section-id={s.id}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, s.id);
              e.dataTransfer.setData('text/plain', s.title);
              e.dataTransfer.effectAllowed = 'move';
              setDragging(s.id);
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              if (canWrite) e.preventDefault();
            }}
            onDrop={(e) => drop(e, s.id)}
            className={`flex flex-col gap-2 rounded-card border bg-white px-4 py-3 ${dragging === s.id ? 'border-zinc-900 opacity-60' : 'border-zinc-200'}`}
          >
            <div className="flex flex-wrap items-center gap-3">
              {canWrite ? (
                <GripVertical aria-hidden="true" className="size-4 shrink-0 cursor-grab text-zinc-400" />
              ) : null}
              <span className="font-mono text-caption text-zinc-500">{i + 1}</span>
              <span className="min-w-0 flex-1 font-medium">{s.title}</span>
              <span className="text-caption text-zinc-500">
                {t(`kinds.${s.kind as 'text'}`)}
                {s.visible ? '' : ` · ${t('hidden')}`}
              </span>
              {canWrite ? (
                <span className="flex gap-1">
                  <button
                    ref={(el) => {
                      buttons.current.set(`${s.id}:up`, el);
                    }}
                    type="button"
                    className={buttonClass('ghost', 'sm')}
                    disabled={i === 0}
                    aria-label={t('moveUp', { title: s.title })}
                    onClick={() => step(s.id, 'up')}
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    ref={(el) => {
                      buttons.current.set(`${s.id}:down`, el);
                    }}
                    type="button"
                    className={buttonClass('ghost', 'sm')}
                    disabled={i === order.length - 1}
                    aria-label={t('moveDown', { title: s.title })}
                    onClick={() => step(s.id, 'down')}
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </button>
                </span>
              ) : null}
            </div>
            {editors[s.id] ?? null}
          </li>
        ))}
      </ol>
      <div aria-live="polite" className="flex flex-col gap-2">
        {message ? (
          <p role="status" className="text-caption text-zinc-600">
            {message}
          </p>
        ) : null}
        {error ? <Alert title={error} /> : null}
      </div>
    </div>
  );
}
