/**
 * The conditions the registration form builder edits (M5.1b): one question compared with one
 * value, which covers the common "show this when that" rules. The engine accepts the full safe
 * JsonLogic subset; anything the builder did not write shows as a custom condition.
 */
export const CONDITION_OPS = ['eq', 'ne', 'includes'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface SimpleCondition {
  readonly key: string;
  readonly op: ConditionOp;
  readonly value: string | number | boolean;
}

interface QuestionLike {
  readonly key: string;
  readonly type: string;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

/** The value a condition compares with, typed like the answer it is compared to. */
export function typedValue(field: QuestionLike, raw: string): string | number | boolean {
  if (field.type === 'checkbox' || field.type === 'consent') return raw === 'true';
  if (field.type === 'number' || field.type === 'count') return Number(raw);
  return raw.trim();
}

/** Which operators make sense for a question. */
export function opsFor(field: QuestionLike): readonly ConditionOp[] {
  if (field.type === 'multi_select') return ['includes'];
  return ['eq', 'ne'];
}

export function toLogic(c: SimpleCondition): unknown {
  const v = { var: c.key };
  if (c.op === 'includes') return { in: [c.value, v] };
  return { [c.op === 'eq' ? '==' : '!=']: [v, c.value] };
}

/** The builder's reading of a stored condition: null (always), simple, or custom. */
export function fromLogic(l: unknown): SimpleCondition | 'custom' | null {
  if (l === null || l === undefined) return null;
  if (typeof l !== 'object' || Array.isArray(l)) return 'custom';
  const [op, args] = Object.entries(l as Record<string, unknown>)[0] ?? [];
  if (!Array.isArray(args) || args.length !== 2) return 'custom';
  const scalar = (x: unknown): x is string | number | boolean =>
    typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean';
  const varOf = (x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) && typeof (x as { var?: unknown }).var === 'string'
      ? (x as { var: string }).var
      : null;
  if ((op === '==' || op === '!=') && varOf(args[0]) && scalar(args[1]))
    return { key: varOf(args[0]) as string, op: op === '==' ? 'eq' : 'ne', value: args[1] };
  if (op === 'in' && scalar(args[0]) && varOf(args[1]))
    return { key: varOf(args[1]) as string, op: 'includes', value: args[0] };
  return 'custom';
}

/** How a compared value reads: an option's label, Yes/No, or the value itself. */
export function valueLabel(
  field: QuestionLike | undefined,
  value: string | number | boolean,
  yesNo: { yes: string; no: string },
): string {
  if (typeof value === 'boolean') return value ? yesNo.yes : yesNo.no;
  const option = field?.options.find((o) => o.value === value);
  return option?.label ?? String(value);
}
