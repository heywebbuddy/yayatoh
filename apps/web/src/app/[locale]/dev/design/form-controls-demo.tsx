'use client';

import {
  Button,
  Combobox,
  CurrencyPicker,
  DatePicker,
  DateTimePicker,
  type ListOption,
  Select,
  TimePicker,
  TimeZonePicker,
} from '@yayatoh/ui';
import { S } from './specimens.ts';

const C = S.controls;
const opt = (text: string): ListOption => ({
  value: text.toLowerCase().replace(/\s+/g, '-'),
  label: text,
  text,
});

/** Every U1 control in every state (rest, placeholder, error, hint, disabled, sizes, search, groups). */
export function FormControlsDemo({ id }: { id: string }) {
  const loadCities = async (q: string) =>
    C.cities.filter((c) => c.toLowerCase().includes(q.toLowerCase())).map(opt);
  return (
    <div className="flex flex-col gap-4" data-testid={`controls-${id}`}>
      <div className="grid gap-4 md:grid-cols-3">
        {(['sm', 'md', 'lg'] as const).map((size) => (
          <Select
            key={size}
            id={`size-${size}-${id}`}
            name={`size-${size}`}
            label={C.sizes[size]}
            fieldSize={size}
            defaultValue="published"
            data-testid={`select-${size}-${id}`}
          >
            {C.statuses.map((s) => (
              <option key={s} value={s.toLowerCase()}>
                {s}
              </option>
            ))}
          </Select>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          id={`ph-${id}`}
          name="status"
          label={C.status}
          placeholder={C.placeholder}
          defaultValue=""
          hint={C.hint}
        >
          <option value="" hidden>
            {C.placeholder}
          </option>
          {C.statuses.map((s) => (
            <option key={s} value={s.toLowerCase()}>
              {s}
            </option>
          ))}
        </Select>
        <Select id={`country-${id}`} name="country" label={C.country} defaultValue="ghana">
          {C.countries.map((c) => (
            <option key={c} value={c.toLowerCase().replace(/\s+/g, '-')}>
              {c}
            </option>
          ))}
        </Select>
        <Select id={`long-${id}`} name="seating" label={C.long}>
          {C.longOptions.map((c, i) => (
            <option key={c} value={String(i)}>
              {c}
            </option>
          ))}
        </Select>
        <Select id={`groups-${id}`} name="scope" label={C.groups}>
          <optgroup label={C.groupEvents}>
            {C.events.map((e) => (
              <option key={e} value={`event:${e}`}>
                {e}
              </option>
            ))}
          </optgroup>
          <optgroup label={C.groupSeries}>
            {C.series.map((e) => (
              <option key={e} value={`series:${e}`}>
                {e}
              </option>
            ))}
          </optgroup>
        </Select>
        <Select id={`err-${id}`} name="ticket" label={C.errorLabel} error={C.error} defaultValue="">
          <option value="">—</option>
          <option value="ga">{C.ga}</option>
        </Select>
        <Select id={`dis-sel-${id}`} name="locked" label={C.disabled} disabled defaultValue="published">
          {C.statuses.map((s) => (
            <option key={s} value={s.toLowerCase()}>
              {s}
            </option>
          ))}
        </Select>
        <Combobox
          id={`tags-${id}`}
          name="tags"
          label={C.tags}
          multiple
          defaultValue={['vip']}
          options={C.tagOptions.map(opt)}
          placeholder={C.tagsPlaceholder}
          onCreate={(q) => opt(q)}
        />
        <Combobox id={`city-${id}`} name="city" label={C.city} loadOptions={loadCities} />
        <DatePicker id={`date-${id}`} name="date" label={C.date} defaultValue="2026-11-05" min="2026-01-01" />
        <DateTimePicker
          id={`dt-${id}`}
          name="doors"
          label={C.dateTime}
          defaultValue="2026-11-05T19:30"
          timeZone="Europe/Paris"
        />
        <TimePicker id={`time-${id}`} name="start" label={C.time} defaultValue="19:30" />
        <TimeZonePicker id={`tz-${id}`} name="timezone" label={C.zone} defaultValue="Europe/Paris" />
        <CurrencyPicker id={`cur-${id}`} name="currency" label={C.currency} defaultValue="EUR" />
      </div>
      <form aria-label={C.resetForm} className="grid items-end gap-4 md:grid-cols-3">
        <Select id={`rs-${id}`} name="rs-status" label={C.status} defaultValue="draft">
          {C.statuses.map((s) => (
            <option key={s} value={s.toLowerCase()}>
              {s}
            </option>
          ))}
        </Select>
        <DatePicker id={`rs-date-${id}`} name="rs-date" label={C.date} defaultValue="2026-11-05" />
        <Button type="reset" variant="secondary">
          {C.reset}
        </Button>
      </form>
    </div>
  );
}
