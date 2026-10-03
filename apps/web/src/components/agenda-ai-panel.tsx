'use client';

import { AGENDA_MAX_SESSIONS } from '@yayatoh/ai/ui';
import { Alert, Button, Checkbox, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, useTransition } from 'react';
import type { AgendaProposal } from '@/app/[locale]/o/[org]/e/[event]/sessions/actions.ts';
import { AiComposePanel } from '@/components/ai-compose-panel.tsx';
import type { ProgramFormState } from '@/components/program-form.tsx';
import type { AiComposeResult, AiComposeSetup, AiComposeValues } from '@/lib/ai-compose.ts';
import { errorMessageKey } from '@/lib/errors.ts';

/**
 * M6.12b: "Draft an agenda with AI". Proposed sessions (inside the event's dates, in its time
 * zone) come back as a checklist; the organizer keeps some or all and adds them through the
 * normal session command, then edits them like any other session. Nothing is published by AI.
 */
export function AgendaAiPanel({
  setup,
  timeZone,
  locale,
  draft,
  add,
}: {
  setup: AiComposeSetup;
  timeZone: string;
  locale: string;
  draft: (values: AiComposeValues, sessions: number) => Promise<AiComposeResult<AgendaProposal[]>>;
  add: (proposals: AgendaProposal[]) => Promise<ProgramFormState & { added?: number }>;
}) {
  const t = useTranslations('program.ai');
  const te = useTranslations();
  const id = useId();
  const [count, setCount] = useState(4);
  const countRef = useRef(4);
  const [kept, setKept] = useState<Set<number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const end = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' });

  return (
    <AiComposePanel<AgendaProposal[]>
      setup={setup}
      run={async (v) => {
        const res = await draft(v, countRef.current);
        setKept(res.value ? new Set(res.value.map((_, i) => i)) : null);
        setError(null);
        return res;
      }}
      briefLabel={t('brief')}
      briefHint={t('briefHint')}
      extra={
        <Select
          id={`${id}-count`}
          label={t('count')}
          value={String(count)}
          onValueChange={(v) => {
            setCount(Number(v));
            countRef.current = Number(v);
          }}
          options={Array.from({ length: AGENDA_MAX_SESSIONS }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1),
            text: String(i + 1),
          }))}
        />
      }
      renderPreview={(sessions, done) => {
        const chosen = kept ?? new Set(sessions.map((_, i) => i));
        return (
          <div className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-1.5 text-[13px] font-bold text-ink">{t('pick')}</legend>
              <ul className="flex list-none flex-col gap-2 p-0" data-testid="ai-agenda">
                {sessions.map((s, i) => (
                  <li key={`${s.startsAt}-${s.title}`} className="flex flex-col gap-0.5">
                    <Checkbox
                      id={`${id}-s${i}`}
                      checked={chosen.has(i)}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        setKept(next);
                      }}
                      label={t('session', {
                        title: s.title,
                        start: fmt.format(new Date(s.startsAt)),
                        end: end.format(new Date(s.endsAt)),
                      })}
                    />
                    {s.description ? <p className="ps-8 text-caption text-ink-2">{s.description}</p> : null}
                  </li>
                ))}
              </ul>
            </fieldset>
            {error ? <Alert title={error} /> : null}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                disabled={pending || chosen.size === 0}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const res = await add(sessions.filter((_, i) => chosen.has(i)));
                    if (res.ok) done(t('added', { count: res.added ?? 0 }));
                    else setError(te(errorMessageKey(res.code)));
                  })
                }
              >
                {t('add', { count: chosen.size })}
              </Button>
              <Button type="button" variant="secondary" onClick={() => done(t('discarded'))}>
                {t('discard')}
              </Button>
            </div>
          </div>
        );
      }}
    />
  );
}
