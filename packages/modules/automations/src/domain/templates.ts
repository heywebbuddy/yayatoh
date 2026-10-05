import type { JourneyTrigger, StepInput } from './journey.ts';

/**
 * Journey templates (M3.7a). The shape (trigger, waits, channels, conditions) lives here; the words
 * come from the caller in the organizer's language (the console's messages), so the module holds
 * no copy. The vision journey (roadmap M3.7):
 * purchase → confirmation · T−7 d reminder · T−24 h SMS/WhatsApp · event-day push · post-event survey.
 */
export const TEMPLATE_KEYS = ['vision', 'invoice_reminders'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** The message steps of the vision journey, in order (each needs a subject and body). */
export const VISION_MESSAGES = ['confirmation', 'week', 'day', 'eventDay'] as const;
export type VisionMessage = (typeof VISION_MESSAGES)[number];

export type TemplateCopy = Readonly<
  Record<VisionMessage, { readonly subject: string; readonly body: string }>
>;

export interface JourneyTemplate {
  readonly trigger: JourneyTrigger;
  readonly steps: readonly StepInput[];
}

/**
 * The vision journey, 5 steps: a confirmation at purchase (email), a reminder 7 days before the
 * start (email, same wall-clock time), a text 1 day before (SMS; the organizer can switch it to
 * WhatsApp), a push on the morning of the event (09:00 local) and the post-event survey the
 * morning after the event ends (10:00 local).
 */
export function visionTemplate(copy: TemplateCopy): JourneyTemplate {
  return {
    trigger: 'order_paid',
    steps: [
      { anchor: 'trigger', offsetDays: 0, offsetMinutes: 0, action: 'email', ...copy.confirmation },
      { anchor: 'event_start', offsetDays: -7, offsetMinutes: 0, action: 'email', ...copy.week },
      { anchor: 'event_start', offsetDays: -1, offsetMinutes: 0, action: 'sms', ...copy.day },
      {
        anchor: 'event_start',
        offsetDays: 0,
        offsetMinutes: 0,
        atTime: '09:00',
        action: 'push',
        ...copy.eventDay,
      },
      { anchor: 'event_end', offsetDays: 1, offsetMinutes: 0, atTime: '10:00', action: 'survey' },
    ],
  };
}

/** M5.1d: the invoice reminder journey's messages (P5-5: 7 days before, on, 7 days after due). */
export const INVOICE_REMINDER_MESSAGES = ['before', 'due', 'overdue'] as const;
export type InvoiceReminderMessage = (typeof INVOICE_REMINDER_MESSAGES)[number];

export type InvoiceReminderCopy = Readonly<
  Record<InvoiceReminderMessage, { readonly subject: string; readonly body: string }>
>;

/**
 * Invoice reminders (M5.1d, P5-5): when a pay-later invoice is issued, three emails at 09:00 in
 * the event's timezone: 7 days before it is due, on the due date and 7 days after. Paying (or the
 * organizer voiding it) ends the run, so nobody is reminded of an invoice they settled; steps
 * whose time has passed when the invoice is issued are skipped. Never cancels a registration.
 */
export function invoiceRemindersTemplate(copy: InvoiceReminderCopy): JourneyTemplate {
  const at = { anchor: 'invoice_due', offsetMinutes: 0, atTime: '09:00', action: 'email' } as const;
  return {
    trigger: 'invoice_issued',
    steps: [
      { ...at, offsetDays: -7, ...copy.before },
      { ...at, offsetDays: 0, ...copy.due },
      { ...at, offsetDays: 7, ...copy.overdue },
    ],
  };
}
