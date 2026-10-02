import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Alert,
  Avatar,
  AvatarStack,
  avatarTone,
  Badge,
  Breadcrumb,
  Button,
  buttonClass,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  HighlightCard,
  IconButton,
  Input,
  PageHeader,
  Pagination,
  PersonChip,
  ProgressBar,
  ScheduleLane,
  Select,
  StatCard,
  StatusDot,
  StatusPill,
  Stepper,
  Switch,
  Table,
  Tag,
  Textarea,
  tabClass,
  widthClass,
} from '../src/index.ts';
import { AVATAR_TONES, STATUS_TONES } from '../src/tokens.ts';

const minHeightPx = (html: string) => {
  const m = /min-h-(\d+|\[(\d+)px\])/.exec(html);
  return m?.[2] ? Number(m[2]) : Number(m?.[1]) * 4;
};

describe('Button', () => {
  it('primary is the violet action with a glow, and defaults to type=button', () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain('bg-primary');
    expect(html).toContain('text-on-primary');
    expect(html).toContain('elevation-primary');
    expect(html).toContain('type="button"');
  });
  it('has every variant with hover, pressed, focus and disabled states', () => {
    for (const v of ['primary', 'secondary', 'dark', 'ghost', 'danger', 'inverse'] as const) {
      const cls = buttonClass(v);
      expect(cls, v).toMatch(/hover:/);
      expect(cls, v).toMatch(/active:/);
      expect(cls, v).toContain('disabled:opacity-50');
    }
  });
  it('keeps every size at 36 / 44 / 54 px, above the 24 px minimum target', () => {
    const want = { sm: 36, md: 44, lg: 54 } as const;
    for (const size of ['sm', 'md', 'lg'] as const) {
      const html = renderToStaticMarkup(<Button size={size}>x</Button>);
      expect(minHeightPx(html), size).toBe(want[size]);
      expect(minHeightPx(html)).toBeGreaterThanOrEqual(24);
    }
  });
  it('shows a loading state that is announced and blocks clicks', () => {
    const html = renderToStaticMarkup(<Button loading>Saving</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('animate-spin');
  });
  it('IconButton always has an accessible name', () => {
    const html = renderToStaticMarkup(<IconButton label="Close" icon={<svg aria-hidden="true" />} />);
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('size-11');
  });
});

describe('Input and other fields', () => {
  it('associates the label and the error message, with an icon', () => {
    const html = renderToStaticMarkup(<Input name="email" label="Email" error="Required" />);
    expect(html).toContain('for="email"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="email-error"');
    expect(html).toContain('<svg');
    expect(html).toContain('field');
  });
  it('links help text when there is no error', () => {
    const html = renderToStaticMarkup(<Select name="tz" label="Time zone" hint="Where the event is" />);
    expect(html).toContain('aria-describedby="tz-hint"');
    expect(renderToStaticMarkup(<Textarea name="bio" label="Bio" />)).toContain('for="bio"');
  });
  it('checkbox rows are 44 px targets and switches are real checkboxes with role=switch', () => {
    expect(renderToStaticMarkup(<Checkbox name="a" value="1" label="Accept" />)).toContain('min-h-11');
    const sw = renderToStaticMarkup(<Switch name="on" label="Live" />);
    expect(sw).toContain('role="switch"');
    expect(sw).toContain('type="checkbox"');
    expect(sw).toContain('rtl:peer-checked:-translate-x-5');
  });
});

describe('Cards', () => {
  it('uses the card radius and the glass surface in dark mode', () => {
    const html = renderToStaticMarkup(<Card>x</Card>);
    expect(html).toContain('rounded-card');
    expect(html).toContain('glass');
  });
  it('StatCard shows a tabular value, a delta and an accessible progress bar', () => {
    const html = renderToStaticMarkup(
      <StatCard label="Tickets sold" value="1,284" delta="86%" progress={{ value: 86, label: 'Sold' }} />,
    );
    expect(html).toContain('tabular-nums');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="86"');
    expect(html).toContain('w-[85%]');
  });
  it('snaps progress widths to static 5% classes (no style attributes)', () => {
    expect(widthClass(0)).toBe('w-0');
    expect(widthClass(50)).toBe('w-[50%]');
    expect(widthClass(140)).toBe('w-full');
    expect(renderToStaticMarkup(<ProgressBar value={3} max={4} label="x" />)).not.toContain('style=');
  });
  it('HighlightCard uses the highlight gradient', () => {
    expect(renderToStaticMarkup(<HighlightCard label="Donations" value="$18,609" />)).toContain(
      'bg-highlight',
    );
  });
});

describe('Labels and status', () => {
  it('Tag is dark and uppercase', () => {
    const html = renderToStaticMarkup(<Tag>Website</Tag>);
    expect(html).toContain('bg-tag');
    expect(html).toContain('uppercase');
  });
  it('StatusPill always pairs the dot with a word, in every tone', () => {
    for (const tone of STATUS_TONES) {
      const html = renderToStaticMarkup(<StatusPill tone={tone} label="Attending" />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('Attending');
      expect(html).toContain(`data-status="${tone}"`);
    }
  });
  it('StatusDot is a dot plus text', () => {
    const dot = renderToStaticMarkup(<StatusDot status="success" label="On sale" />);
    expect(dot).toContain('bg-success-dot');
    expect(dot).toContain('aria-hidden="true"');
    expect(dot).toContain('On sale');
  });
  it('Badge is tabular', () => {
    expect(renderToStaticMarkup(<Badge>3</Badge>)).toContain('tabular-nums');
  });
});

describe('People', () => {
  it('gives the same person the same pastel', () => {
    expect(avatarTone('Alice James')).toBe(avatarTone('Alice James'));
    expect(AVATAR_TONES).toContain(avatarTone('Ola Bone'));
    const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => avatarTone(`Guest ${n}`)));
    expect(seen.size).toBeGreaterThan(1);
  });
  it('Avatar is a named image unless decorative', () => {
    expect(renderToStaticMarkup(<Avatar initials="AJ" label="Alice James" />)).toContain(
      'aria-label="Alice James"',
    );
    expect(renderToStaticMarkup(<Avatar initials="AJ" label="Alice James" decorative />)).toContain(
      'aria-hidden="true"',
    );
  });
  it('AvatarStack names the group and counts the rest', () => {
    const people = ['Ann', 'Bo', 'Cy', 'Di', 'Ed'].map((n) => ({ name: n, initials: n[0] ?? '' }));
    const html = renderToStaticMarkup(<AvatarStack people={people} max={2} label="Party of 5" />);
    expect(html).toContain('aria-label="Party of 5"');
    expect(html).toContain('+3');
  });
  it('PersonChip shows the mint check with its label', () => {
    const html = renderToStaticMarkup(
      <PersonChip name="Alice James" initials="AJ" detail="Door A lead" checked checkLabel="Checked in" />,
    );
    expect(html).toContain('aria-label="Checked in"');
    expect(html).toContain('bg-success-dot');
  });
});

describe('Navigation', () => {
  it('the active tab is the dark segment; others hover', () => {
    expect(tabClass(true)).toContain('bg-tab-on');
    expect(tabClass(false)).toContain('hover:');
  });
  it('Breadcrumb marks the current page and mirrors its separators in RTL', () => {
    const html = renderToStaticMarkup(
      <Breadcrumb label="Breadcrumb" items={[{ label: 'Events', href: '/e' }, { label: 'Gala' }]} />,
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/e"');
    expect(html).toContain('rtl:-scale-x-100');
  });
  it('Pagination disables the missing end', () => {
    const html = renderToStaticMarkup(
      <Pagination
        label="Pages"
        previous={{ href: null, label: 'Previous' }}
        next={{ href: '/p2', label: 'Next' }}
      />,
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('rel="next"');
  });
  it('Stepper announces the current step', () => {
    const html = renderToStaticMarkup(
      <Stepper
        label="Steps"
        steps={[
          { label: 'Basics', state: 'done' },
          { label: 'Tickets', state: 'current' },
          { label: 'Publish', state: 'todo' },
        ]}
      />,
    );
    expect(html).toContain('aria-current="step"');
  });
});

describe('Layout and states', () => {
  it('PageHeader has one h1 and keeps actions together', () => {
    const html = renderToStaticMarkup(<PageHeader title="Guests" actions={<Button>Add party</Button>} />);
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toContain('md:text-title');
  });
  it('EmptyState says what to do next; ErrorState is an alert with a retry', () => {
    expect(
      renderToStaticMarkup(<EmptyState title="No guests yet" action={<Button>Add</Button>} />),
    ).toContain('No guests yet');
    const err = renderToStaticMarkup(
      <ErrorState title="Could not load" retry={<Button>Try again</Button>} />,
    );
    expect(err).toContain('role="alert"');
    expect(err).toContain('Try again');
  });
  it('Alert tones map to roles', () => {
    expect(renderToStaticMarkup(<Alert title="Failed" />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Alert tone="success" title="Saved" />)).toContain('role="status"');
  });
  it('ScheduleLane outlines the current item and marks it for assistive tech', () => {
    const html = renderToStaticMarkup(
      <ScheduleLane
        label="Run of show"
        items={[
          { id: '1', title: 'Doors', time: '6:30', state: 'done', chip: 'Done' },
          { id: '2', title: 'Paddle raise', time: '9:00', state: 'now', chip: 'Now' },
        ]}
      />,
    );
    expect(html).toContain('aria-current="time"');
    expect(html).toContain('border-success');
  });
});

describe('Table', () => {
  const columns = [
    { key: 'name', header: 'Name', cell: (r: { id: string; name: string; n: number }) => r.name },
    { key: 'n', header: 'Sold', cell: (r: { n: number }) => r.n, align: 'end' as const, mono: true },
  ];
  it('renders a captioned table with logical alignment and a sticky header', () => {
    const html = renderToStaticMarkup(
      <Table
        caption="Tickets"
        columns={columns}
        rows={[{ id: '1', name: 'GA', n: 3 }]}
        rowKey={(r) => r.id}
      />,
    );
    expect(html).toContain('<caption class="sr-only">Tickets</caption>');
    expect(html).toContain('scope="col"');
    expect(html).toContain('text-end');
    expect(html).toContain('sticky top-0');
    expect(html).not.toMatch(/text-(left|right)/);
  });
  it('shows the empty state', () => {
    const html = renderToStaticMarkup(
      <Table caption="T" columns={columns} rows={[]} rowKey={(r) => r.id} empty="Nothing yet" />,
    );
    expect(html).toContain('Nothing yet');
  });
  it('selectable rows have a named checkbox each; phones can stack rows as cards', () => {
    const html = renderToStaticMarkup(
      <Table
        caption="T"
        columns={columns}
        rows={[{ id: 'r1', name: 'GA', n: 3 }]}
        rowKey={(r) => r.id}
        select={{ name: 'ids', header: 'Select', label: (r) => `Select ${r.name}` }}
        stackOnPhone
      />,
    );
    expect(html).toContain('aria-label="Select GA"');
    expect(html).toContain('value="r1"');
    expect(html).toContain('data-label="Name"');
  });
});

describe('chart swatches', () => {
  it('use literal token classes Tailwind can see', async () => {
    const { swatchClass } = await import('../src/index.ts');
    const src = readFileSync(new URL('../src/components/charts.tsx', import.meta.url), 'utf8');
    for (const tone of ['primary', 'brand', 'success', 'warning', 'sky', 'muted', 'faint'] as const) {
      expect(src).toContain(`'${swatchClass(tone)}'`);
    }
  });
});

describe('no raw palette', () => {
  it('components use role tokens only (no Tailwind default palette or retired ADR 0018 names)', () => {
    const files = [
      'button',
      'card',
      'charts',
      'input',
      'labels',
      'navigation',
      'overlays',
      'people',
      'primitives',
      'table',
    ];
    for (const f of files) {
      const src = readFileSync(new URL(`../src/components/${f}.tsx`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(
        /\b(?:bg|text|border|fill|stroke)-(?:zinc|gray|slate|green|pink|yellow|accent)-\d/,
      );
      expect(src, f).not.toMatch(/style=\{/);
    }
  });
});
