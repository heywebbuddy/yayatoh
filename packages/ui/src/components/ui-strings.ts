/**
 * The few words the form controls say themselves (search box, empty list, calendar buttons). The
 * apps pass them from next-intl once, at the root layout (`UiLocaleProvider`), with the locale
 * that drives date formats, digits, week starts and currency names. The English defaults only
 * serve tests and pages outside the provider.
 */
export interface UiStrings {
  readonly search: string;
  readonly noResults: string;
  readonly loading: string;
  /** "Remove {label}" on a chip. */
  readonly remove: string;
  /** "Create “{query}”" in a combobox. */
  readonly create: string;
  readonly clear: string;
  readonly chooseDate: string;
  readonly chooseTime: string;
  readonly previousMonth: string;
  readonly nextMonth: string;
  readonly today: string;
  /** "Enter a date like {example}". */
  readonly invalidDate: string;
  /** "Enter a time like {example}". */
  readonly invalidTime: string;
  /** "Choose a date on or after {date}". */
  readonly tooEarly: string;
  /** "Choose a date on or before {date}". */
  readonly tooLate: string;
  /** "Times in {zone}". */
  readonly timeZoneNote: string;
  readonly selected: string;
}

export const DEFAULT_UI_STRINGS: UiStrings = {
  search: 'Search',
  noResults: 'No matches',
  loading: 'Loading…',
  remove: 'Remove {label}',
  create: 'Create “{query}”',
  clear: 'Clear',
  chooseDate: 'Choose a date',
  chooseTime: 'Choose a time',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  today: 'Today',
  invalidDate: 'Enter a date like {example}',
  invalidTime: 'Enter a time like {example}',
  tooEarly: 'Choose a date on or after {date}',
  tooLate: 'Choose a date on or before {date}',
  timeZoneNote: 'Times in {zone}',
  selected: 'Selected',
};

/** Every key the apps translate (`formControls.*` in each app's messages). */
export const UI_STRING_KEYS = Object.keys(DEFAULT_UI_STRINGS) as (keyof UiStrings)[];

/** Fills `{name}` slots. */
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
