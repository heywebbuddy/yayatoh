/**
 * Catalog checks (M7.1c), shared by mobile-core and both apps' tests (the web's `messages.test.ts`
 * for phones): every locale has exactly the English keys, no empty string, valid ICU syntax, the
 * same placeholders as English, and the plural forms the language needs (Arabic zero, one, two,
 * few, many, other; Russian one, few, many, other; Japanese and Chinese other only).
 *
 * Pure TypeScript with no React Native import, so a Vitest or Jest test can load it directly.
 */
import { IntlMessageFormat } from 'intl-messageformat';

export type Tree = { [key: string]: string | Tree };

/** CLDR plural categories a message must give, by locale. Others need one and other. */
const REQUIRED: Record<string, readonly string[]> = {
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
  ru: ['one', 'few', 'many', 'other'],
  ja: ['other'],
  'zh-CN': ['other'],
  'zh-TW': ['other'],
};
const DEFAULT_REQUIRED = ['one', 'other'] as const;
/** French, Spanish, Italian and Portuguese also have `many` (for millions): allowed, not required. */
const OPTIONAL: Record<string, readonly string[]> = {
  es: ['many'],
  fr: ['many'],
  it: ['many'],
  pt: ['many'],
};

export const requiredPluralForms = (locale: string): readonly string[] => REQUIRED[locale] ?? DEFAULT_REQUIRED;

export function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out[`${prefix}${k}`] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

interface Node {
  type: number;
  value?: string;
  options?: Record<string, { value: Node[] }>;
  children?: Node[];
  pluralType?: string;
  offset?: number;
}

// The parser's element types (@formatjs/icu-messageformat-parser TYPE enum).
const T_ARGUMENT = 1;
const T_NUMBER = 2;
const T_DATE = 3;
const T_TIME = 4;
const T_SELECT = 5;
const T_PLURAL = 6;
const T_TAG = 8;

interface Walk {
  args: Set<string>;
  plurals: { arg: string; forms: string[] }[];
}

function walk(nodes: readonly Node[], into: Walk): void {
  for (const n of nodes) {
    if ([T_ARGUMENT, T_NUMBER, T_DATE, T_TIME, T_SELECT, T_PLURAL].includes(n.type) && n.value)
      into.args.add(n.value);
    if (n.type === T_PLURAL && n.value && n.pluralType !== 'ordinal')
      into.plurals.push({ arg: n.value, forms: Object.keys(n.options ?? {}) });
    if (n.type === T_TAG && n.children) walk(n.children, into);
    for (const option of Object.values(n.options ?? {})) walk(option.value, into);
  }
}

function inspect(message: string, locale: string): Walk {
  const out: Walk = { args: new Set(), plurals: [] };
  walk(new IntlMessageFormat(message, locale).getAst() as unknown as Node[], out);
  return out;
}

/** Everything wrong with the catalogs, as readable lines; empty means they are fine. */
export function validateCatalogs(catalogs: Record<string, Tree>, reference = 'en'): string[] {
  const problems: string[] = [];
  const base = flatten(catalogs[reference] ?? {});
  for (const [locale, tree] of Object.entries(catalogs)) {
    const flat = flatten(tree);
    for (const key of Object.keys(base)) if (!(key in flat)) problems.push(`${locale}: missing ${key}`);
    for (const key of Object.keys(flat)) if (!(key in base)) problems.push(`${locale}: extra ${key}`);
    for (const [key, message] of Object.entries(flat)) {
      if (!message.trim()) {
        problems.push(`${locale}: ${key} is empty`);
        continue;
      }
      let found: Walk;
      try {
        found = inspect(message, locale);
      } catch (err) {
        problems.push(`${locale}: ${key} is not valid ICU (${(err as Error).message.split('\n')[0]})`);
        continue;
      }
      const english = base[key];
      if (english && locale !== reference) {
        let wanted: Set<string> | null = null;
        try {
          wanted = inspect(english, reference).args;
        } catch {
          // The English one reports its own error.
        }
        if (wanted) {
          const same = wanted.size === found.args.size && [...wanted].every((a) => found.args.has(a));
          if (!same)
            problems.push(
              `${locale}: ${key} uses {${[...found.args].sort().join(', ')}} but English uses {${[...wanted].sort().join(', ')}}`,
            );
        }
      }
      const required = requiredPluralForms(locale);
      const allowed = new Set([...required, ...(OPTIONAL[locale] ?? [])]);
      for (const { arg, forms } of found.plurals) {
        for (const form of required)
          if (!forms.includes(form)) problems.push(`${locale}: ${key} {${arg}} lacks the "${form}" plural form`);
        for (const form of forms)
          if (!allowed.has(form) && !form.startsWith('='))
            problems.push(`${locale}: ${key} {${arg}} has a "${form}" form ${locale} never uses`);
      }
    }
  }
  return problems;
}
