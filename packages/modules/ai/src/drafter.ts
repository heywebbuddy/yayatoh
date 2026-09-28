import { buildPrompt, type DraftRequest } from './domain/drafts.ts';

/**
 * The AI drafting port (M1.4f). Adapters turn a request into raw text; the caller cleans it
 * (`cleanDraft`) and shows it as a preview. Adapters never see the database.
 */
export interface AiDrafter {
  readonly name: string;
  draft(req: DraftRequest): Promise<string>;
}

export class AiUnavailableError extends Error {
  constructor(message = 'The AI provider is not available') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

const dateOnly = (local: string) => local.slice(0, 10);

/**
 * Deterministic drafter for dev, CI and previews: builds the draft from the event facts alone,
 * so tests can assert the exact text. Organizer notes are quoted back as data (the Markdown
 * sanitizer and renderer handle anything odd in them), never interpreted.
 */
export const fakeDrafter: AiDrafter = {
  name: 'fake',
  async draft(req) {
    const f = req.facts;
    const place = f.attendanceMode === 'online' ? 'online' : [f.venueName, f.city].filter(Boolean).join(', ');
    const when = dateOnly(f.startsLocal);
    const notes = req.notes.trim().replace(/\s+/g, ' ');
    switch (req.kind) {
      case 'tagline':
        return `${f.name}: an unforgettable ${f.profile === 'other' ? 'event' : f.profile}${place ? ` at ${place}` : ''} on ${when}.`;
      case 'description':
        return [
          `**${f.name}** takes place on ${when}${place ? ` at ${place}` : ''} (${f.timezone.replace(/_/g, ' ')} time).`,
          notes ? `What to expect: ${notes}` : 'Join us for a day worth remembering.',
          '- Doors open before the start\n- Tickets are sent by email',
        ].join('\n\n');
      case 'faq':
        return [
          `When is ${f.name}?\nIt starts on ${f.startsLocal} and ends on ${f.endsLocal} (${f.timezone.replace(/_/g, ' ')} time).`,
          `Where does it take place?\n${place ? `At ${place}.` : 'The location will be announced soon.'}`,
          'How do I get my ticket?\nYour ticket is emailed to you right after checkout.',
        ].join('\n\n');
    }
  },
};

/** A drafter that always fails (tests of the refund path). */
export const failingDrafter: AiDrafter = {
  name: 'failing',
  async draft() {
    throw new AiUnavailableError();
  },
};

/**
 * Anthropic adapter — a **stub** until the owner's Anthropic account exists (owner inbox). It
 * already builds the hardened prompt; the request itself is sent with the official
 * `@anthropic-ai/sdk` (Messages API, model `claude-opus-5` unless `AI_MODEL` says otherwise)
 * when the key is provisioned. Until then it refuses, and the app falls back to no AI drafting.
 */
export function anthropicDrafter(opts: { apiKey: string; model?: string }): AiDrafter {
  const model = opts.model ?? 'claude-opus-5';
  return {
    name: `anthropic:${model}`,
    async draft(req) {
      buildPrompt(req);
      throw new AiUnavailableError(
        'The Anthropic adapter is not enabled yet (owner inbox: AI provider account)',
      );
    },
  };
}

/**
 * Pick the drafter from configuration. `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` selects
 * the Anthropic adapter; `AI_PROVIDER=fake` (the default in dev, CI and previews) the fake one.
 * Anything else — including production without a provider — returns null: drafting is off.
 */
export function drafterFromEnv(env: Readonly<Record<string, string | undefined>>): AiDrafter | null {
  const provider = env.AI_PROVIDER ?? (env.NODE_ENV === 'production' && !env.YAYATOH_DEV_AUTH ? '' : 'fake');
  if (provider === 'fake') return fakeDrafter;
  if (provider === 'anthropic' && env.ANTHROPIC_API_KEY)
    return anthropicDrafter({
      apiKey: env.ANTHROPIC_API_KEY,
      ...(env.AI_MODEL ? { model: env.AI_MODEL } : {}),
    });
  return null;
}
