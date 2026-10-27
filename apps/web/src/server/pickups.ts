import 'server-only';
import { pickupPointsQuery } from '@yayatoh/events';
import { getFormQuery, publishFormCommand } from '@yayatoh/forms';
import { type Ctx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { getTranslations } from 'next-intl/server';
import { ports } from './ports.ts';

/** The checkout question the pickup list drives (a required choice among the tour's points). */
export const PICKUP_QUESTION_KEY = 'pickup_point';

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/**
 * Keep the tour's checkout question in step with its pickup points. The buyer picks a point in the
 * normal checkout questions, so checkout itself does not change: the answer is stored with the
 * order like any other. With no points the question is removed. Every change publishes a new
 * immutable version of the form, as editing the questions by hand does.
 */
export async function syncPickupQuestion(ctx: Ctx, eventId: string): Promise<void> {
  const points = await executeQuery(pickupPointsQuery, { eventId }, ctx, ports);
  const subject = { kind: 'checkout_questions', subjectType: 'event', subjectId: eventId } as const;
  const current = await executeQuery(getFormQuery, subject, ctx, ports);
  const others = (current?.definition.fields ?? []).filter((f) => f.key !== PICKUP_QUESTION_KEY);
  const t = await getTranslations('tourPickups');
  const field =
    points.length === 0
      ? []
      : [
          {
            key: PICKUP_QUESTION_KEY,
            type: 'select' as const,
            label: t('question'),
            help: null,
            required: true,
            sensitive: false,
            options: points.map((p) => ({
              value: p.id,
              label: clip(p.address ? `${p.name} · ${p.address}` : p.name, 120),
            })),
            min: null,
            max: null,
            showIf: null,
          },
        ];
  if (field.length === 0 && others.length === (current?.definition.fields.length ?? 0)) return;
  await executeCommand(
    publishFormCommand,
    { ...subject, definition: { fields: [...field, ...others] } },
    ctx,
    ports,
  );
}
