import { z } from 'zod';

/**
 * Journeys (M3.7a): an org's automation for one event (or every event of a series). A trigger
 * enrolls a person; each step waits (relative to the trigger or to the event's start or end, in
 * the event's timezone), checks an optional condition and does one thing. Browser-safe: the
 * builder validates drafts with the same schemas the commands use.
 */

/** What enrolls a person. `rsvp` (M4.1d) is reserved: see `FUTURE_TRIGGERS`. */
export const JOURNEY_TRIGGERS = [
  'order_paid',
  'checked_in',
  'event_time',
  /** M5.1d: a pay-later invoice was issued (the buyer); payment or a void ends the run. */
  'invoice_issued',
] as const;
export type JourneyTrigger = (typeof JOURNEY_TRIGGERS)[number];
/**
 * Extension point: triggers that arrive later. Each one needs only a subscriber that calls
 * `enrollTx` with its trigger name and person (M4.1d adds `rsvp` from `rsvp.submitted@1`), plus the
 * value in the `journeys_trigger_check` constraint and this list moved into `JOURNEY_TRIGGERS`.
 */
export const FUTURE_TRIGGERS = ['rsvp'] as const;

/** What a step's wait is measured from. */
export const WAIT_ANCHORS = [
  'trigger',
  'event_start',
  'event_end',
  /** M5.1d: the invoice's due date (start of the day, event timezone); `invoice_issued` only. */
  'invoice_due',
] as const;
export type WaitAnchor = (typeof WAIT_ANCHORS)[number];

/** What a step does: send a message on one channel, add a label, or invite to the survey. */
export const STEP_ACTIONS = ['email', 'sms', 'whatsapp', 'push', 'label', 'survey'] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];
export const MESSAGE_ACTIONS = ['email', 'sms', 'whatsapp', 'push'] as const;
export type MessageAction = (typeof MESSAGE_ACTIONS)[number];
export const isMessageAction = (a: string): a is MessageAction =>
  (MESSAGE_ACTIONS as readonly string[]).includes(a);

/** Only if…: checked when the step is due, never earlier. */
export const STEP_CONDITIONS = [
  'checked_in',
  'not_checked_in',
  'has_seat',
  'no_seat',
  'answered_survey',
  'not_answered_survey',
] as const;
export type StepCondition = (typeof STEP_CONDITIONS)[number];

export const MAX_STEPS = 20;
export const MAX_OFFSET_DAYS = 365;
/** Hours and minutes on top of the days: under a week. */
export const MAX_OFFSET_MINUTES = 7 * 24 * 60 - 1;
export const SUBJECT_MAX = 150;
export const BODY_MAX = 2000;
export const LABEL_MAX = 40;

const tidy = (s: string) => s.trim().replace(/[ \t]+/g, ' ');

export const JourneyName = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(120));

const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => (s == null ? null : tidy(s) || null))
    .pipe(z.string().max(max).nullable());

/** One step as the builder and the commands see it. `id` keeps a step's identity across edits. */
export const StepInput = z
  .object({
    id: z.uuid().nullish(),
    anchor: z.enum(WAIT_ANCHORS),
    offsetDays: z.int().min(-MAX_OFFSET_DAYS).max(MAX_OFFSET_DAYS).default(0),
    offsetMinutes: z.int().min(-MAX_OFFSET_MINUTES).max(MAX_OFFSET_MINUTES).default(0),
    /** A wall-clock time in the event's zone after the days are applied (`09:00`), or none. */
    atTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullish()
      .transform((v) => v ?? null),
    action: z.enum(STEP_ACTIONS),
    subject: optionalText(SUBJECT_MAX),
    body: optionalText(BODY_MAX),
    label: optionalText(LABEL_MAX),
    condition: z
      .enum(STEP_CONDITIONS)
      .nullish()
      .transform((v) => v ?? null),
  })
  .superRefine((s, ctx) => {
    if (s.offsetDays * s.offsetMinutes < 0)
      ctx.addIssue({ code: 'custom', path: ['offsetMinutes'], message: 'same_direction' });
    if (s.anchor === 'trigger' && (s.offsetDays < 0 || s.offsetMinutes < 0))
      ctx.addIssue({ code: 'custom', path: ['offsetDays'], message: 'after_trigger' });
    if (isMessageAction(s.action)) {
      if (!s.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'required' });
      if (!s.body) ctx.addIssue({ code: 'custom', path: ['body'], message: 'required' });
    }
    if (s.action === 'label' && !s.label)
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'required' });
  });
export type StepInput = z.input<typeof StepInput>;
export type Step = z.output<typeof StepInput>;

export const StepsInput = z.array(StepInput).max(MAX_STEPS);

/**
 * Step rules that depend on the journey: a journey that starts at a time relative to the event has
 * no trigger moment of its own, so its steps wait from the event's start or end.
 */
export function stepProblems(
  trigger: JourneyTrigger,
  steps: readonly Step[],
): { index: number; field: string }[] {
  const out: { index: number; field: string }[] = [];
  steps.forEach((s, index) => {
    if (trigger === 'event_time' && s.anchor === 'trigger') out.push({ index, field: 'anchor' });
    // Only an invoice has a due date to wait from.
    if (trigger !== 'invoice_issued' && s.anchor === 'invoice_due') out.push({ index, field: 'anchor' });
  });
  return out;
}

/** Placeholders a message may use; filled per person when the step runs. */
export const PLACEHOLDERS = ['name', 'event', 'when'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
/**
 * M5.1d: an `invoice_issued` journey's messages may also use the invoice's number, the balance
 * still due, its due date and the buyer's link to view and pay it.
 */
export const INVOICE_PLACEHOLDERS = ['invoice', 'balance', 'due', 'link'] as const;
export type InvoicePlaceholder = (typeof INVOICE_PLACEHOLDERS)[number];

/**
 * Replace `{name}`, `{event}` and `{when}` (and, when given, the invoice placeholders); anything
 * else in braces stays as written.
 */
export function fillPlaceholders(
  text: string,
  values: Readonly<Record<Placeholder, string>> & Partial<Readonly<Record<InvoicePlaceholder, string>>>,
): string {
  return text.replace(/\{(name|event|when|invoice|balance|due|link)\}/g, (m, k: string) => {
    const v = (values as Record<string, string | undefined>)[k];
    return v === undefined ? m : v;
  });
}
