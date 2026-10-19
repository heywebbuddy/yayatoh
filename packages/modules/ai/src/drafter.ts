import Anthropic from '@anthropic-ai/sdk';
import { AiOutputError, addMinutesLocal, buildComposePrompt, type ComposeRequest } from './domain/compose.ts';
import { buildPrompt, DraftOutputError, type DraftRequest } from './domain/drafts.ts';
import { fakeEmbedding } from './domain/embed.ts';
import type { Tone } from './domain/tones.ts';

/**
 * The AI drafting port (M1.4f). Adapters turn a request into raw text; the caller cleans it
 * (`cleanDraft`) and shows it as a preview. Adapters never see the database.
 */
export interface AiDrafter {
  readonly name: string;
  draft(req: DraftRequest): Promise<string>;
  /** M6.12b: a v2 draft (campaign, page, agenda, audience); the raw reply, one JSON object. */
  compose(req: ComposeRequest): Promise<string>;
  /**
   * M6.12b: one embedding per text (`EMBEDDING_DIMENSIONS` numbers each), for matchmaking. The
   * texts are opted-in networking profiles of one event of one org.
   */
  embed(texts: readonly string[]): Promise<number[][]>;
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
  async compose(req) {
    return JSON.stringify(fakeCompose(req));
  },
  async embed(texts) {
    return texts.map(fakeEmbedding);
  },
};

const OPENERS: Readonly<Record<Tone, string>> = {
  friendly: 'You are invited',
  formal: 'We are pleased to announce',
  playful: 'Guess what',
  urgent: 'Last chance',
  inspiring: 'Be part of something bigger',
};

/**
 * The fake v2 drafts: built from the facts, the tone and the brand kit alone, so tests can assert
 * them. The brand kit's first preferred word appears in every text draft; the brief is quoted
 * back as data.
 */
function fakeCompose(req: ComposeRequest): unknown {
  const brandWord = req.brand?.keywords[0] ?? null;
  const brief = req.brief.trim().replace(/\s+/g, ' ');
  const opener = OPENERS[req.tone];
  switch (req.task) {
    case 'campaign': {
      const what = req.event?.name ?? req.orgName;
      return {
        subject: `${opener}: ${what}`,
        preheader: req.event ? `${req.event.startsLocal.slice(0, 10)} · ${req.orgName}` : req.orgName,
        heading: brandWord ? `${what}, ${brandWord}` : what,
        paragraphs: [
          brief ? `About this message: ${brief}` : `${req.orgName} has news for you.`,
          req.brand ? `In the voice of ${req.brand.name}.` : 'We hope to see you there.',
        ],
        buttonLabel: req.event ? 'Get tickets' : null,
      };
    }
    case 'page':
      return {
        title: brief ? cutWords(brief, 60) : `About ${req.orgName}`,
        excerpt: `${opener} — ${req.orgName}${brandWord ? `, ${brandWord}` : ''}.`,
        body: [
          `**${req.orgName}** ${req.event ? `presents ${req.event.name}.` : 'welcomes you.'}`,
          brief ? `What to know: ${brief}` : 'More details soon.',
          brandWord ? `- ${brandWord}\n- ${req.tone}` : `- ${req.tone}`,
        ].join('\n\n'),
      };
    case 'agenda': {
      const start = req.event.startsLocal;
      const topics = brief
        ? brief
            .split(/[,;\n]+/)
            .map((t) => t.trim())
            .filter(Boolean)
        : ['Welcome', 'Keynote', 'Panel'];
      const sessions = [];
      let at = start;
      for (const [i, topic] of topics.slice(0, req.sessions).entries()) {
        sessions.push({
          title: i === 0 && !brief ? `Welcome to ${req.event.name}` : cutWords(topic, 100),
          description: `${opener}: ${topic}.`,
          startsLocal: at,
          minutes: 45,
        });
        at = addMinutesLocal(at, 60) ?? at;
      }
      return { sessions };
    }
    case 'audience': {
      const lower = brief.toLowerCase();
      const event = req.events.find((e) => lower.includes(e.name.toLowerCase())) ?? null;
      const conditions: unknown[] = [];
      const noShow = /no.?show|did ?n.?t (come|attend)|missed/.test(lower);
      conditions.push({
        type: 'participation',
        scope: event ? { kind: 'event', eventId: event.id } : { kind: 'any' },
        ...(noShow ? { checkedIn: false } : /attend|came|check/.test(lower) ? { checkedIn: true } : {}),
      });
      if (/email|newsletter|subscrib/.test(lower))
        conditions.push({ type: 'consent', channel: 'email', granted: true });
      return {
        explanation: event
          ? `People who registered for ${event.name}${noShow ? ' but did not check in' : ''}.`
          : 'People who registered for any of your events.',
        definition: { version: 1, root: { type: 'group', op: 'and', conditions } },
      };
    }
  }
}

function cutWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const c = s.slice(0, max);
  const space = c.lastIndexOf(' ');
  return (space > max / 2 ? c.slice(0, space) : c).trimEnd();
}

/** A drafter that always fails (tests of the refund path). */
export const failingDrafter: AiDrafter = {
  name: 'failing',
  async draft() {
    throw new AiUnavailableError();
  },
  async compose() {
    throw new AiUnavailableError();
  },
  async embed() {
    throw new AiUnavailableError();
  },
};

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * Anthropic adapter: the hardened prompt goes to the Messages API through the official
 * `@anthropic-ai/sdk` (model `claude-opus-5-5` unless `AI_MODEL` says otherwise). Low effort keeps
 * short copy well inside the callers' 30 s budget; a declined request is retried server-side on a
 * fallback model. Any provider failure (bad or revoked key, rate limit, outage, timeout) becomes
 * `AiUnavailableError` and a refused, truncated or empty reply an output error, so the caller
 * refunds the credit and the organizer carries on by hand.
 */
export function anthropicDrafter(opts: { apiKey: string; model?: string; client?: Anthropic }): AiDrafter {
  const model = opts.model ?? ANTHROPIC_DEFAULT_MODEL;
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, timeout: 25_000 });
  async function ask(prompt: { system: string; user: string }, unusable: () => Error): Promise<string> {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await client.beta.messages.create({
        model,
        max_tokens: 8000,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError)
        throw new AiUnavailableError(`The Anthropic API failed (${err.status ?? 'no connection'})`);
      throw err;
    }
    if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') throw unusable();
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    if (!text) throw unusable();
    return text;
  }
  return {
    name: `anthropic:${model}`,
    draft: (req) => ask(buildPrompt(req), () => new DraftOutputError()),
    compose: (req) => ask(buildComposePrompt(req), () => new AiOutputError('no usable reply')),
    async embed() {
      // Claude has no embeddings endpoint: production matchmaking needs an embeddings provider
      // behind this port (owner inbox, M6.12b). Until then attendees get suggestions from shared
      // interests instead (`suggestedMatchesQuery`).
      throw new AiUnavailableError('No embeddings provider is configured (owner inbox)');
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
  if (provider === 'anthropic' && env.ANTHROPIC_API_KEY?.trim())
    return anthropicDrafter({
      apiKey: env.ANTHROPIC_API_KEY.trim(),
      ...(env.AI_MODEL ? { model: env.AI_MODEL } : {}),
    });
  return null;
}
