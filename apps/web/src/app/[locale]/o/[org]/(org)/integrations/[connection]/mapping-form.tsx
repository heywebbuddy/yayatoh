'use client';

import { type FieldSpec, type MappingRule, TRANSFORMS } from '@yayatoh/integrations/client';
import { Alert, Button, Card, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { MappingState } from '../actions.ts';

/**
 * The field-mapping editor (M6.4a): one row per target field, each with its source, a transform
 * from the allowlist and a default. One editor for every connector; a save adds a version.
 * Server validation owns the messages (the same rules the engine applies).
 */
export function MappingForm({
  direction,
  objectType,
  version,
  rules,
  sources,
  targets,
  canManage,
  action,
}: {
  direction: 'pull' | 'push';
  objectType: string;
  version: number | null;
  rules: readonly MappingRule[];
  sources: readonly FieldSpec[];
  targets: readonly FieldSpec[];
  canManage: boolean;
  action: (prev: MappingState, form: FormData) => Promise<MappingState>;
}) {
  const t = useTranslations('integrations.mapping');
  const tField = useTranslations('integrations.fields');
  const [state, formAction, pending] = useActionState(action, { status: 'idle' } as MappingState);
  const label = (f: FieldSpec) => (tField.has(f.key) ? tField(f.key) : f.label);
  // Controlled rows: a refused save keeps what was chosen (the form is never reset under the user).
  const [rows, setRows] = useState(() =>
    targets.map((target) => {
      const r = rules.find((x) => x.target === target.key);
      return { source: r?.source ?? '', transform: r?.transform ?? 'none', default: r?.default ?? '' };
    }),
  );
  const setRow = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const targetLabel = (key: string) => {
    const f = targets.find((x) => x.key === key) ?? sources.find((x) => x.key === key);
    return f ? label(f) : key;
  };
  const rowError = (i: number) => {
    const issue = state.status === 'error' ? state.issues?.find((x) => x.index === i) : undefined;
    if (!issue) return undefined;
    const field = issue.field ? targetLabel(issue.field) : '';
    return t.has(`issue.${issue.code}`) ? t(`issue.${issue.code}`, { field }) : t('issue.other', { field });
  };
  const general = state.status === 'error';
  const id = (part: string, i: number) => `${objectType}-${direction}-${part}-${i}`;
  const headingId = `${objectType}-${direction}-mapping`;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="m-0 text-section">
          {t(`title.${direction}`)}
        </h3>
        {version ? <span className="text-caption text-ink-2">{t('version', { version })}</span> : null}
      </div>
      <p className="m-0 text-body text-ink-2">{t(`help.${direction}`)}</p>
      <div aria-live="polite" className="empty:hidden">
        {state.status === 'saved' ? (
          <Alert tone="success" title={t('saved', { version: state.version ?? 0 })} />
        ) : null}
        {general ? <Alert tone="danger" title={t('invalid')} /> : null}
      </div>
      <form action={formAction} noValidate aria-labelledby={headingId} className="flex flex-col gap-4">
        <input type="hidden" name="rows" value={targets.length} />
        {targets.map((target, i) => {
          const row = rows[i] ?? { source: '', transform: 'none', default: '' };
          const error = rowError(i);
          return (
            <fieldset
              key={target.key}
              className="grid gap-3 rounded-tile border border-line p-3 sm:grid-cols-3"
              disabled={!canManage}
            >
              <legend className="px-1 text-[13px] font-bold text-ink">
                {label(target)}
                {target.required ? <span className="text-ink-2"> ({t('required')})</span> : null}
              </legend>
              <input type="hidden" name={`target.${i}`} value={target.key} />
              <input type="hidden" name={`row.${target.key}`} value={i} />
              <Select
                id={id('source', i)}
                name={`source.${i}`}
                label={t('source')}
                value={row.source}
                onChange={(e) => setRow(i, { source: e.target.value })}
                error={error}
              >
                <option value="">{t('notMapped')}</option>
                {sources.map((s) => (
                  <option key={s.key} value={s.key}>
                    {label(s)}
                  </option>
                ))}
              </Select>
              <Select
                id={id('transform', i)}
                name={`transform.${i}`}
                label={t('transform')}
                value={row.transform}
                onChange={(e) => setRow(i, { transform: e.target.value as MappingRule['transform'] })}
              >
                {TRANSFORMS.map((x) => (
                  <option key={x} value={x}>
                    {t(`transforms.${x}`)}
                  </option>
                ))}
              </Select>
              <Input
                id={id('default', i)}
                name={`default.${i}`}
                label={t('default')}
                maxLength={200}
                autoComplete="off"
                value={row.default}
                onChange={(e) => setRow(i, { default: e.target.value })}
              />
            </fieldset>
          );
        })}
        {canManage ? (
          <div>
            <Button type="submit" variant="secondary" disabled={pending}>
              {t(`save.${direction}`)}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
