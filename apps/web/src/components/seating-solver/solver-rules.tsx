'use client';

import type { SolverRuleDto } from '@yayatoh/seating';
import {
  DEFAULT_ACCESS_TAG,
  DEFAULT_RULE_WEIGHT,
  MAX_RULE_WEIGHT,
  MIN_RULE_WEIGHT,
  type RuleTarget,
  SOLVER_RULE_KINDS,
  type SolverRuleKind,
  type SolverRuleSpec,
  sameTarget,
} from '@yayatoh/seating/client';
import { Alert, Badge, Button, Input, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useId, useState, useTransition } from 'react';
import type { SolverState } from '@/app/[locale]/o/[org]/e/[event]/seating/solver/actions.ts';
import { useRouter } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';

type Strength = 'hard' | 'soft';
type By = 'party' | 'tag' | 'side';
type Feedback = { tone: 'success' | 'danger'; text: string } | null;

export interface RuleNames {
  readonly parties: readonly { id: string; name: string }[];
  readonly tags: readonly string[];
  readonly sides: readonly string[];
}

/** A rule in words ("Keep the Bride side apart from the Groom side"). */
export function useDescribeRule(names: RuleNames) {
  const t = useTranslations('seating.solver.rules.describe');
  return useCallback(
    (r: SolverRuleSpec): string => {
      const partyName = (id: string) => names.parties.find((p) => p.id === id)?.name ?? '?';
      const target = (x: RuleTarget) =>
        x.by === 'party'
          ? t('targetParty', { value: partyName(x.value) })
          : x.by === 'tag'
            ? t('targetTag', { value: x.value })
            : t('targetSide', { value: x.value });
      switch (r.kind) {
        case 'keep_together': {
          const g = r.params.group;
          if (g.by === 'party') return t('togetherParty');
          return g.by === 'tag'
            ? t('togetherTag', { value: g.value })
            : t('togetherSide', { value: g.value });
        }
        case 'keep_apart':
          return t('apart', { a: target(r.params.a), b: target(r.params.b) });
        case 'vip_near_stage':
          return t('vip');
        case 'access_near_exit':
          return t('access', { tag: r.params.tag });
        case 'table_max':
          return t('tableMax', { max: r.params.max });
      }
    },
    [t, names],
  );
}

function weightError(v: string) {
  const n = Number(v);
  return Number.isInteger(n) && n >= MIN_RULE_WEIGHT && n <= MAX_RULE_WEIGHT ? null : 'weight';
}

/** One saved rule: its words, hard or soft, its weight; save or remove. */
function RuleRow({
  rule,
  text,
  canWrite,
  update,
  remove,
  onDone,
}: {
  rule: SolverRuleDto;
  text: string;
  canWrite: boolean;
  update: (input: { ruleId: string; strength: Strength; weight: number }) => Promise<SolverState>;
  remove: (ruleId: string) => Promise<SolverState>;
  onDone: (f: Feedback) => void;
}) {
  const t = useTranslations('seating.solver.rules');
  const tRoot = useTranslations();
  const id = useId();
  const [strength, setStrength] = useState<Strength>(rule.strength);
  const [weight, setWeight] = useState(String(rule.weight));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (weightError(weight)) {
      setError(t('errors.weight'));
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await update({ ruleId: rule.id, strength, weight: Number(weight) });
      onDone(
        r.ok
          ? { tone: 'success', text: t('saved') }
          : { tone: 'danger', text: tRoot(errorMessageKey(r.code)) },
      );
      if (r.ok) router.refresh();
    });
  };
  const drop = () =>
    startTransition(async () => {
      const r = await remove(rule.id);
      onDone(
        r.ok
          ? { tone: 'success', text: t('removed') }
          : { tone: 'danger', text: tRoot(errorMessageKey(r.code)) },
      );
      if (r.ok) router.refresh();
    });

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{text}</span>
        <Badge tone={rule.strength === 'hard' ? 'danger' : 'neutral'}>
          {t('badge', { strength: t(rule.strength), weight: rule.weight })}
        </Badge>
      </div>
      {canWrite ? (
        <form
          onSubmit={save}
          noValidate
          aria-label={t('editLabel', { rule: text })}
          className="flex flex-wrap items-end gap-2"
        >
          <Select
            id={`${id}-strength`}
            label={t('strength')}
            value={strength}
            onValueChange={(v) => setStrength(v as Strength)}
          >
            <option value="hard">{t('hard')}</option>
            <option value="soft">{t('soft')}</option>
          </Select>
          <Input
            id={`${id}-weight`}
            label={t('weight')}
            type="number"
            inputMode="numeric"
            min={MIN_RULE_WEIGHT}
            max={MAX_RULE_WEIGHT}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            error={error ?? undefined}
            className="w-24"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {t('save')}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={drop}>
            {t('remove')}
          </Button>
        </form>
      ) : null}
    </li>
  );
}

/** A "who" picker: party, tag or side, then which one. */
function TargetPicker({
  id,
  label,
  names,
  by,
  value,
  onBy,
  onValue,
  error,
  allowEach = false,
}: {
  id: string;
  label: string;
  names: RuleNames;
  by: By | 'each';
  value: string;
  onBy: (b: By | 'each') => void;
  onValue: (v: string) => void;
  error?: string;
  allowEach?: boolean;
}) {
  const t = useTranslations('seating.solver.rules.add');
  return (
    <fieldset className="m-0 flex flex-wrap items-end gap-2 border-0 p-0">
      <legend className="mb-1 text-[13px] font-bold text-ink">{label}</legend>
      <Select
        id={`${id}-by`}
        label={t('by')}
        value={by}
        onValueChange={(v) => {
          onBy(v as By | 'each');
          onValue('');
        }}
      >
        {allowEach ? <option value="each">{t('byEach')}</option> : null}
        {!allowEach ? <option value="party">{t('byParty')}</option> : null}
        <option value="tag">{t('byTag')}</option>
        <option value="side">{t('bySide')}</option>
      </Select>
      {by === 'party' ? (
        <Select
          id={`${id}-value`}
          label={t('party')}
          value={value}
          onValueChange={(v) => onValue(v)}
          error={error}
        >
          <option value="">{t('choose')}</option>
          {names.parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      ) : by === 'tag' || by === 'side' ? (
        <>
          <Input
            id={`${id}-value`}
            label={by === 'tag' ? t('tag') : t('side')}
            value={value}
            maxLength={40}
            list={`${id}-options`}
            onChange={(e) => onValue(e.target.value)}
            error={error}
          />
          <datalist id={`${id}-options`}>
            {(by === 'tag' ? names.tags : names.sides).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </>
      ) : null}
    </fieldset>
  );
}

/**
 * The rule builder (M6.12a): the event's rules in words with hard/soft and weight, and a form
 * to add one. Plain form controls only (keyboard and screen reader friendly), checked inline
 * before anything is sent.
 */
export function SolverRules({
  rules,
  names,
  canWrite,
  add,
  update,
  remove,
}: {
  rules: readonly SolverRuleDto[];
  names: RuleNames;
  canWrite: boolean;
  add: (input: { spec: SolverRuleSpec; strength: Strength; weight: number }) => Promise<SolverState>;
  update: (input: { ruleId: string; strength: Strength; weight: number }) => Promise<SolverState>;
  remove: (ruleId: string) => Promise<SolverState>;
}) {
  const t = useTranslations('seating.solver.rules');
  const tRoot = useTranslations();
  const describe = useDescribeRule(names);
  const router = useRouter();
  const id = useId();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<SolverRuleKind>('keep_together');
  const [groupBy, setGroupBy] = useState<By | 'each'>('each');
  const [groupValue, setGroupValue] = useState('');
  const [aBy, setABy] = useState<By | 'each'>('party');
  const [aValue, setAValue] = useState('');
  const [bBy, setBBy] = useState<By | 'each'>('party');
  const [bValue, setBValue] = useState('');
  const [tag, setTag] = useState(DEFAULT_ACCESS_TAG);
  const [max, setMax] = useState('8');
  const [strength, setStrength] = useState<Strength>('hard');
  const [weight, setWeight] = useState(String(DEFAULT_RULE_WEIGHT));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const target = (by: By | 'each', value: string): RuleTarget | null =>
    by === 'each' || !value.trim() ? null : ({ by, value: value.trim() } as RuleTarget);

  function build(): { spec: SolverRuleSpec | null; errs: Record<string, string> } {
    const errs: Record<string, string> = {};
    let spec: SolverRuleSpec | null = null;
    if (kind === 'keep_together') {
      if (groupBy === 'each') spec = { kind, params: { group: { by: 'party' } } };
      else if (!groupValue.trim()) errs.group = t('errors.value');
      else spec = { kind, params: { group: { by: groupBy, value: groupValue.trim() } } as never };
    } else if (kind === 'keep_apart') {
      const a = target(aBy, aValue);
      const b = target(bBy, bValue);
      if (!a) errs.a = t('errors.value');
      if (!b) errs.b = t('errors.value');
      if (a && b && sameTarget(a, b)) errs.b = t('errors.same');
      if (a && b && !errs.b) spec = { kind, params: { a, b } };
    } else if (kind === 'vip_near_stage') spec = { kind, params: {} };
    else if (kind === 'access_near_exit') {
      if (!tag.trim()) errs.tag = t('errors.value');
      else spec = { kind, params: { tag: tag.trim() } };
    } else {
      const n = Number(max);
      if (!Number.isInteger(n) || n < 1 || n > 40) errs.max = t('errors.max');
      else spec = { kind, params: { max: n } };
    }
    if (weightError(weight)) errs.weight = t('errors.weight');
    return { spec: Object.keys(errs).length ? null : spec, errs };
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { spec, errs } = build();
    setErrors(errs);
    if (!spec) {
      setFeedback(null);
      return;
    }
    startTransition(async () => {
      const r = await add({ spec, strength, weight: Number(weight) });
      if (r.ok) {
        setFeedback({ tone: 'success', text: t('added') });
        setGroupValue('');
        setAValue('');
        setBValue('');
        router.refresh();
      } else {
        const known: Record<string, string> = {
          duplicate_rule: t('errors.duplicate'),
          too_many_rules: t('errors.tooMany'),
          unknown_party: t('errors.unknownParty'),
        };
        setFeedback({
          tone: 'danger',
          text: (r.reason && known[r.reason]) || tRoot(errorMessageKey(r.code)),
        });
      }
    });
  };

  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3">
      <h2 id={`${id}-h`} className="m-0 text-h3 font-bold text-ink">
        {t('heading')}
      </h2>
      <div aria-live="polite">{feedback ? <Alert tone={feedback.tone} title={feedback.text} /> : null}</div>
      {rules.length ? (
        <ul aria-label={t('listLabel')} className="m-0 flex list-none flex-col gap-2 p-0">
          {rules.map((r) => (
            <RuleRow
              key={`${r.id}:${r.strength}:${r.weight}`}
              rule={r}
              text={describe(r)}
              canWrite={canWrite}
              update={update}
              remove={remove}
              onDone={setFeedback}
            />
          ))}
        </ul>
      ) : (
        <p className="m-0 text-body text-ink-2">{t('empty')}</p>
      )}
      {canWrite ? (
        <form
          onSubmit={submit}
          aria-labelledby={`${id}-add`}
          noValidate
          className="flex flex-col gap-3 rounded-md border border-line p-3"
        >
          <h3 id={`${id}-add`} className="m-0 text-body font-bold text-ink">
            {t('add.heading')}
          </h3>
          <Select
            id={`${id}-kind`}
            label={t('add.kind')}
            value={kind}
            onValueChange={(v) => {
              setKind(v as SolverRuleKind);
              setErrors({});
            }}
          >
            {SOLVER_RULE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
          {kind === 'keep_together' ? (
            <TargetPicker
              id={`${id}-group`}
              label={t('add.together')}
              names={names}
              by={groupBy}
              value={groupValue}
              onBy={setGroupBy}
              onValue={setGroupValue}
              error={errors.group}
              allowEach
            />
          ) : kind === 'keep_apart' ? (
            <>
              <TargetPicker
                id={`${id}-a`}
                label={t('add.first')}
                names={names}
                by={aBy}
                value={aValue}
                onBy={setABy}
                onValue={setAValue}
                error={errors.a}
              />
              <TargetPicker
                id={`${id}-b`}
                label={t('add.second')}
                names={names}
                by={bBy}
                value={bValue}
                onBy={setBBy}
                onValue={setBValue}
                error={errors.b}
              />
            </>
          ) : kind === 'access_near_exit' ? (
            <Input
              id={`${id}-tag`}
              label={t('add.accessTag')}
              hint={t('add.accessHint')}
              value={tag}
              maxLength={40}
              list={`${id}-tags`}
              onChange={(e) => setTag(e.target.value)}
              error={errors.tag}
            />
          ) : kind === 'table_max' ? (
            <Input
              id={`${id}-max`}
              label={t('add.max')}
              type="number"
              inputMode="numeric"
              min={1}
              max={40}
              value={max}
              onChange={(e) => setMax(e.target.value)}
              error={errors.max}
              className="w-24"
            />
          ) : (
            <p className="m-0 text-caption text-ink-2">{t('add.vipHint')}</p>
          )}
          <datalist id={`${id}-tags`}>
            {names.tags.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <fieldset className="m-0 flex flex-wrap items-center gap-4 border-0 p-0">
            <legend className="mb-1 text-[13px] font-bold text-ink">{t('strength')}</legend>
            {(['hard', 'soft'] as const).map((s) => (
              <label key={s} className="flex min-h-6 items-center gap-2 text-body">
                <input
                  type="radio"
                  name={`${id}-strength`}
                  value={s}
                  checked={strength === s}
                  onChange={() => setStrength(s)}
                  className="size-5"
                />
                {t(s)}
              </label>
            ))}
          </fieldset>
          <p className="m-0 text-caption text-ink-2">{t('strengthHint')}</p>
          <Input
            id={`${id}-weight`}
            label={t('weight')}
            hint={t('weightHint')}
            type="number"
            inputMode="numeric"
            min={MIN_RULE_WEIGHT}
            max={MAX_RULE_WEIGHT}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            error={errors.weight}
            className="w-24"
          />
          <div>
            <Button type="submit" variant="secondary" disabled={pending}>
              {t('add.submit')}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
