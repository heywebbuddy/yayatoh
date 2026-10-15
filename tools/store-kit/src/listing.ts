/**
 * Store listing checks (M7.5a): the App Store and Google Play limits, applied to every locale of
 * `apps/<app>/store/store.config.json` (EAS Metadata format) and `apps/<app>/store/play.json`.
 *
 * Lengths are counted in UTF-16 code units (`string.length`), which is never less than what the
 * stores count, so a text that passes here fits in both.
 */

/** The app catalogs' locale codes (ADR 0016) and the store codes each store uses for them. */
export const STORE_LOCALES = {
  en: { apple: 'en-US', play: 'en-US' },
  ar: { apple: 'ar-SA', play: 'ar' },
  de: { apple: 'de-DE', play: 'de-DE' },
  es: { apple: 'es-ES', play: 'es-ES' },
  fr: { apple: 'fr-FR', play: 'fr-FR' },
  hi: { apple: 'hi', play: 'hi-IN' },
  it: { apple: 'it', play: 'it-IT' },
  ja: { apple: 'ja', play: 'ja-JP' },
  nl: { apple: 'nl-NL', play: 'nl-NL' },
  pt: { apple: 'pt-BR', play: 'pt-BR' },
  ru: { apple: 'ru', play: 'ru-RU' },
  'zh-CN': { apple: 'zh-Hans', play: 'zh-CN' },
  'zh-TW': { apple: 'zh-Hant', play: 'zh-TW' },
} as const;

export const APPLE_LIMITS = {
  title: 30,
  subtitle: 30,
  promoText: 170,
  description: 4000,
  keywords: 100,
  releaseNotes: 4000,
  reviewNotes: 4000,
} as const;

export const PLAY_LIMITS = {
  title: 30,
  shortDescription: 80,
  fullDescription: 4000,
  releaseNotes: 500,
} as const;

export const APPLE_ADVISORY_LEVELS = ['NONE', 'INFREQUENT_OR_MILD', 'FREQUENT_OR_INTENSE'] as const;
export const APPLE_ADVISORY_BOOLEANS = ['gambling', 'unrestrictedWebAccess'] as const;

/** Environment names a listing may use for values that belong to the owner (never literal). */
export const PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)\}/g;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function checkText(
  errors: string[],
  where: string,
  value: unknown,
  max: number,
  { min = 1, placeholders = false }: { min?: number; placeholders?: boolean } = {},
): void {
  const s = str(value);
  if (s === null) return void errors.push(`${where}: missing`);
  if (s.length < min) errors.push(`${where}: shorter than ${min}`);
  if (s.length > max) errors.push(`${where}: ${s.length} characters, limit ${max}`);
  if (s !== s.trim()) errors.push(`${where}: has leading or trailing whitespace`);
  if (!placeholders && /\$\{[^}]*\}/.test(s)) errors.push(`${where}: contains a placeholder`);
}

function sameKeys(errors: string[], where: string, got: string[], want: string[]): void {
  for (const k of want) if (!got.includes(k)) errors.push(`${where}: missing locale ${k}`);
  for (const k of got) if (!want.includes(k)) errors.push(`${where}: unexpected locale ${k}`);
}

/** Problems with the Apple half (`store.config.json`); an empty list means it is within limits. */
export function checkAppleListing(config: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(config) || !isObject(config.apple)) return ['store.config.json: no "apple" section'];
  const apple = config.apple;
  if (config.configVersion !== 0) errors.push('store.config.json: configVersion must be 0');
  const info = isObject(apple.info) ? apple.info : {};
  sameKeys(
    errors,
    'apple.info',
    Object.keys(info),
    Object.values(STORE_LOCALES).map((l) => l.apple),
  );
  const english = isObject(info['en-US']) ? info['en-US'] : {};
  for (const [locale, raw] of Object.entries(info)) {
    const w = `apple.info.${locale}`;
    if (!isObject(raw)) {
      errors.push(`${w}: not an object`);
      continue;
    }
    checkText(errors, `${w}.title`, raw.title, APPLE_LIMITS.title, { min: 2 });
    checkText(errors, `${w}.subtitle`, raw.subtitle, APPLE_LIMITS.subtitle);
    checkText(errors, `${w}.promoText`, raw.promoText, APPLE_LIMITS.promoText);
    checkText(errors, `${w}.description`, raw.description, APPLE_LIMITS.description, { min: 10 });
    checkText(errors, `${w}.releaseNotes`, raw.releaseNotes, APPLE_LIMITS.releaseNotes);
    const keywords = raw.keywords;
    if (!Array.isArray(keywords) || keywords.length === 0 || keywords.some((k) => typeof k !== 'string'))
      errors.push(`${w}.keywords: a list of words`);
    else {
      const joined = keywords.join(',');
      if (joined.length > APPLE_LIMITS.keywords)
        errors.push(
          `${w}.keywords: ${joined.length} characters joined with commas, limit ${APPLE_LIMITS.keywords}`,
        );
      for (const k of keywords as string[])
        if (k !== k.trim() || k.includes(',') || k === '')
          errors.push(`${w}.keywords: "${k}" is not a clean keyword`);
      if (new Set((keywords as string[]).map((k) => k.toLowerCase())).size !== keywords.length)
        errors.push(`${w}.keywords: duplicates`);
    }
    for (const url of ['marketingUrl', 'supportUrl', 'privacyPolicyUrl'] as const)
      if (!/^\$\{STORE_[A-Z_]+\}$/.test(str(raw[url]) ?? ''))
        errors.push(`${w}.${url}: must be a \${STORE_…} placeholder, not a literal address`);
    // A translated listing must not be the English text copied over.
    if (locale !== 'en-US' && raw.description === english.description)
      errors.push(`${w}.description: still the English text`);
  }
  const advisory = isObject(apple.advisory) ? apple.advisory : null;
  if (!advisory) errors.push('apple.advisory: missing');
  else
    for (const [k, v] of Object.entries(advisory)) {
      const isBool = (APPLE_ADVISORY_BOOLEANS as readonly string[]).includes(k);
      if (isBool ? typeof v !== 'boolean' : !(APPLE_ADVISORY_LEVELS as readonly string[]).includes(String(v)))
        errors.push(`apple.advisory.${k}: not an allowed value`);
    }
  if (!Array.isArray(apple.categories) || apple.categories.length === 0 || apple.categories.length > 2)
    errors.push('apple.categories: one or two categories');
  const release = isObject(apple.release) ? apple.release : {};
  if (release.phasedRelease !== true) errors.push('apple.release.phasedRelease: must be true (P7-9)');
  if (release.automaticRelease !== false)
    errors.push('apple.release.automaticRelease: must be false (the owner releases)');
  const review = isObject(apple.review) ? apple.review : {};
  checkText(errors, 'apple.review.notes', review.notes, APPLE_LIMITS.reviewNotes, { min: 100 });
  for (const k of ['firstName', 'lastName', 'email', 'phone', 'demoUsername', 'demoPassword'] as const)
    if (!str(review[k])) errors.push(`apple.review.${k}: missing`);
  return errors;
}

/** Problems with the Google Play half (`play.json`). */
export function checkPlayListing(config: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(config)) return ['play.json: not an object'];
  if (config.defaultLanguage !== 'en-US') errors.push('play.json: defaultLanguage must be en-US');
  if (typeof config.category !== 'string') errors.push('play.json: category missing');
  for (const k of ['contactEmail', 'contactWebsite', 'privacyPolicyUrl'] as const)
    if (!/^\$\{STORE_[A-Z_]+\}$/.test(str(config[k]) ?? ''))
      errors.push(`play.json.${k}: must be a \${STORE_…} placeholder, not a literal`);
  const listings = isObject(config.listings) ? config.listings : {};
  sameKeys(
    errors,
    'play.listings',
    Object.keys(listings),
    Object.values(STORE_LOCALES).map((l) => l.play),
  );
  const english = isObject(listings['en-US']) ? listings['en-US'] : {};
  for (const [locale, raw] of Object.entries(listings)) {
    const w = `play.listings.${locale}`;
    if (!isObject(raw)) {
      errors.push(`${w}: not an object`);
      continue;
    }
    checkText(errors, `${w}.title`, raw.title, PLAY_LIMITS.title, { min: 2 });
    checkText(errors, `${w}.shortDescription`, raw.shortDescription, PLAY_LIMITS.shortDescription);
    checkText(errors, `${w}.fullDescription`, raw.fullDescription, PLAY_LIMITS.fullDescription, { min: 10 });
    checkText(errors, `${w}.releaseNotes`, raw.releaseNotes, PLAY_LIMITS.releaseNotes);
    if (locale !== 'en-US' && raw.fullDescription === english.fullDescription)
      errors.push(`${w}.fullDescription: still the English text`);
  }
  return errors;
}

/** Every `${NAME}` the two files use, so `.env.example` can list them all. */
export function placeholdersIn(...docs: unknown[]): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') for (const m of v.matchAll(PLACEHOLDER)) found.add(m[1] as string);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) Object.values(v).forEach(walk);
  };
  docs.forEach(walk);
  return [...found].sort();
}

/**
 * Replaces every `${NAME}` with the environment's value. A missing or empty name is an error (never
 * a silent blank), and URL fields must come out as https addresses.
 */
export function renderPlaceholders<T>(doc: T, env: Readonly<Record<string, string | undefined>>): T {
  const missing = new Set<string>();
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === 'string')
      return v.replace(PLACEHOLDER, (_m, name: string) => {
        const value = env[name]?.trim();
        if (!value) {
          missing.add(name);
          return '';
        }
        if (/url$/i.test(key) && !/^https:\/\//.test(value))
          throw new Error(`${name} must be an https:// address`);
        return value;
      });
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  const out = walk(doc, '') as T;
  if (missing.size > 0)
    throw new Error(`Set these in the environment first: ${[...missing].sort().join(', ')}`);
  return out;
}
