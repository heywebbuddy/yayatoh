import type { JourneyTrigger, StepInput } from './journey.ts';

/**
 * Journey templates (M3.7a). The shape (trigger, waits, channels, conditions) lives here; the words
 * come from the caller in the organizer's language (the console's messages), so the module holds
 * no copy. The vision journey (roadmap M3.7):
 * purchase → confirmation · T−7 d reminder · T−24 h SMS/WhatsApp · event-day push · post-event survey.
 */
export const TEMPLATE_KEYS = ['vision'] as const;
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
