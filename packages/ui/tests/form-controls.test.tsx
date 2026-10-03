import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Combobox,
  CurrencyPicker,
  currencyOptions,
  DatePicker,
  DateTimePicker,
  optionsFromChildren,
  parseDateText,
  Select,
  selectTriggerClass,
  TimePicker,
  TimeZonePicker,
  timeZoneOptions,
  UiLocaleProvider,
} from '../src/index.ts';

const css = (await import('node:fs')).readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('Select trigger (the chevron fix)', () => {
  const html = renderToStaticMarkup(
    <Select name="status" label="Status" defaultValue="b">
      <option value="a">Draft</option>
      <option value="b">Published</option>
    </Select>,
  );
  it('is a button with role=combobox, never a native select', () => {
    expect(html).not.toContain('<select');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('for="status"');
  });
  it('draws our own 16 px chevron inside the field, centred, 12 px from the inline end', () => {
    const chevron = /<svg[^>]*data-chevron[^>]*>/.exec(html)?.[0] ?? '';
    expect(chevron).toContain('absolute');
    expect(chevron).toContain('inset-y-0');
    expect(chevron).toContain('my-auto');
    expect(chevron).toContain('end-3'); // logical: mirrors in RTL
    expect(chevron).toContain('size-4');
    expect(chevron).toContain('text-ink-2');
    expect(chevron).toContain('group-aria-expanded:rotate-180');
    expect(chevron).not.toMatch(/\bright-|\bleft-/);
  });
  it('pads the text so it never runs under the chevron, at every size', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const cls = selectTriggerClass(size);
      expect(cls, size).toContain('field-chevron');
      expect(cls, size).toContain('appearance-none');
      expect(cls, size).toContain('relative');
    }
    // Padding carried over from a native select can't undo the chevron's room; a width replaces ours.
    expect(selectTriggerClass('md', 'field px-3 w-28')).not.toMatch(/\bpx-3\b|\bw-full\b/);
    expect(selectTriggerClass('md', 'field px-3 w-28')).toContain('w-28');
    expect(selectTriggerClass('md')).toContain('w-full');
    expect(css).toMatch(/@utility field-chevron \{\s*--field-pe: 40px;/);
    expect(css).toContain('padding-inline-end: var(--field-pe, var(--field-px, 14px));');
  });
  it('submits through a hidden input with the chosen value', () => {
    expect(html).toContain('type="hidden" name="status" value="b"');
    expect(html).toContain('Published');
    expect(html).toContain('data-value="b"');
  });
  it('defaults to the first enabled option, as a native select does', () => {
    const h = renderToStaticMarkup(
      <Select name="x">
        <option value="a" disabled>
          A
        </option>
        <option value="b">B</option>
      </Select>,
    );
    expect(h).toContain('name="x" value="b"');
  });
  it('honours <option selected> and hidden placeholders', () => {
    const h = renderToStaticMarkup(
      <Select name="y" placeholder="Pick one">
        <option value="" hidden>
          Choose…
        </option>
        <option value="1">One</option>
        <option value="2" selected>
          Two
        </option>
      </Select>,
    );
    expect(h).toContain('name="y" value="2"');
  });
  it('required uses a constraint-validated input; disabled does not submit', () => {
    const r = renderToStaticMarkup(
      <Select name="r" required defaultValue="">
        <option value="">—</option>
        <option value="a">A</option>
      </Select>,
    );
    expect(r).toContain('required=""');
    expect(r).toContain('aria-required="true"');
    const d = renderToStaticMarkup(
      <Select name="d" disabled>
        <option value="a">A</option>
      </Select>,
    );
    expect(d).toMatch(/<button[^>]*disabled=""/);
    expect(d).toMatch(/<input type="hidden" disabled="" name="d" value="a"\/>/);
  });
  it('shows errors and hints like Input', () => {
    const e = renderToStaticMarkup(<Select name="e" label="E" error="Pick one" options={[]} />);
    expect(e).toContain('aria-invalid="true"');
    expect(e).toContain('aria-describedby="e-error"');
    const h = renderToStaticMarkup(<Select name="tz" label="Time zone" hint="Where" options={[]} />);
    expect(h).toContain('aria-describedby="tz-hint"');
  });
  it('reads optgroups as groups', () => {
    const p = optionsFromChildren(
      <>
        <option value="">Any</option>
        <optgroup label="Events">
          <option value="e1">Gala</option>
        </optgroup>
      </>,
    );
    expect(p.list.map((o) => [o.value, o.group])).toEqual([
      ['', undefined],
      ['e1', 'Events'],
    ]);
  });
});

describe('Combobox', () => {
  it('is an editable combobox with chips for multiple values, each submitted', () => {
    const html = renderToStaticMarkup(
      <Combobox
        name="tags"
        label="Tags"
        multiple
        defaultValue={['a', 'b']}
        options={[
          { value: 'a', label: 'Alpha', text: 'Alpha' },
          { value: 'b', label: 'Beta', text: 'Beta' },
        ]}
      />,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-label="Remove Alpha"');
    expect(html).toContain('type="hidden" name="tags" value="a"');
    expect(html).toContain('type="hidden" name="tags" value="b"');
  });
});

describe('Date and time pickers', () => {
  it('render a text field (typed entry) with our calendar button, no native date input', () => {
    const html = renderToStaticMarkup(<DatePicker name="starts" label="Starts" defaultValue="2026-11-05" />);
    expect(html).not.toMatch(/type="date"/);
    expect(html).toContain('type="text"');
    expect(html).toContain('aria-label="Choose a date"');
    expect(html).toContain('type="hidden" name="starts" value="2026-11-05"');
    expect(html).toContain('value="11/05/2026"');
  });
  it('format in the reader’s locale, with Arabic digits in Arabic', () => {
    const html = renderToStaticMarkup(
      <UiLocaleProvider locale="ar" strings={{ chooseDate: 'اختر تاريخًا' }}>
        <DateTimePicker name="at" defaultValue="2026-11-05T19:30" />
      </UiLocaleProvider>,
    );
    expect(html).toMatch(/value="[٠-٩/ ]+[٠-٩:]+ م"/);
    expect(html).toContain('name="at" value="2026-11-05T19:30"');
    expect(html).toContain('اختر تاريخًا');
  });
  it('show the event time zone next to the field and can submit the UTC instant', () => {
    const html = renderToStaticMarkup(
      <DateTimePicker
        name="at"
        defaultValue="2026-07-01T19:00"
        timeZone="America/New_York"
        valueFormat="utc"
      />,
    );
    expect(html).toContain('Times in America/New_York');
    expect(html).toContain('New York · UTC−04:00');
    expect(html).toContain('name="at" value="2026-07-01T23:00:00.000Z"');
  });
  it('time picker keeps HH:MM', () => {
    const html = renderToStaticMarkup(
      <UiLocaleProvider locale="de">
        <TimePicker name="t" defaultValue="07:05" />
      </UiLocaleProvider>,
    );
    expect(html).toContain('value="07:05"');
    expect(html).toContain('aria-label="Choose a time"');
  });
  it('parses typed text: ISO always, and the locale’s own format', () => {
    expect(parseDateText('datetime', '2026-11-05T19:00', 'de')).toEqual({
      ymd: { y: 2026, m: 11, d: 5 },
      time: { h: 19, mi: 0 },
    });
    expect(parseDateText('datetime', '05.11.2026 19:00', 'de')?.time).toEqual({ h: 19, mi: 0 });
    expect(parseDateText('datetime', '11/05/2026 7:00 PM', 'en')?.ymd).toEqual({ y: 2026, m: 11, d: 5 });
    expect(parseDateText('datetime', '2026/11/05 下午7:00', 'zh-TW')?.time).toEqual({ h: 19, mi: 0 });
    expect(parseDateText('date', 'nope', 'en')).toBeNull();
  });
});

describe('Time zone and currency pickers', () => {
  it('lists IANA zones grouped by region with the current offset', () => {
    const opts = timeZoneOptions('en', new Date('2026-07-01T12:00:00Z'));
    const kolkata = opts.find((o) => o.value === 'Asia/Kolkata');
    expect(kolkata?.label).toBe('Kolkata · UTC+05:30');
    expect(kolkata?.group).toBe('Asia');
    expect(opts.some((o) => o.value === 'UTC')).toBe(true);
    const html = renderToStaticMarkup(<TimeZonePicker name="tz" defaultValue="Europe/Paris" />);
    expect(html).toContain('name="tz" value="Europe/Paris"');
  });
  it('keeps an unknown current zone selectable', () => {
    expect(timeZoneOptions('en', new Date(), ['US/Eastern']).some((o) => o.value === 'US/Eastern')).toBe(
      true,
    );
  });
  it('lists ISO 4217 codes with symbol and a localized name', () => {
    const eur = currencyOptions('en').find((o) => o.value === 'EUR');
    expect(eur?.label).toBe('EUR · Euro (€)');
    expect(currencyOptions('fr').find((o) => o.value === 'USD')?.text).toMatch(/dollar des États-Unis/i);
    const html = renderToStaticMarkup(<CurrencyPicker name="currency" defaultValue="usd" />);
    expect(html).toContain('name="currency" value="USD"');
  });
});
