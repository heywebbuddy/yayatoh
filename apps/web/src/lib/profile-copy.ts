/**
 * Profile copy (M4.2a vocabulary sweep): a profile can reword any message for its events under
 * `profileCopy.<profile>.<message key>` — a wedding says "guests" where the console says
 * "ticket holders" or "attendees". Nav labels use the vocabulary overlay (`vocab.*`); this covers
 * the sentences around them. The event layout merges these into the messages its client
 * components see; server components use `profileT`.
 */
type Messages = { [k: string]: string | Messages };

function merge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = typeof v === 'string' || typeof b !== 'object' ? v : merge(b, v);
  }
  return out;
}

/** The messages with this profile's rewording applied (unchanged for profiles without any). */
export function profileMessages<M extends object>(messages: M, profile: string): M {
  const all = messages as unknown as Messages;
  const copy = (all.profileCopy as Messages | undefined)?.[profile];
  return (typeof copy === 'object' ? merge(all, copy) : all) as unknown as M;
}

interface Translator {
  (key: string, values?: Record<string, string | number | Date>): string;
  has(key: string): boolean;
}

/** A server translator that prefers the profile's rewording of a key. */
export function profileT(t: Translator, profile: string) {
  return (key: string, values?: Record<string, string | number | Date>) => {
    const own = `profileCopy.${profile}.${key}`;
    return t.has(own) ? t(own, values) : t(key, values);
  };
}
