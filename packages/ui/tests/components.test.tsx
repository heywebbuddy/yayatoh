import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, Card, Input, StatusDot, Table } from '../src/index.ts';

describe('Button', () => {
  it('is a pill, primary is ink, and defaults to type=button', () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain('rounded-pill');
    expect(html).toContain('bg-ink');
    expect(html).toContain('type="button"');
  });
  it('keeps every size at or above the 24px minimum target', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const html = renderToStaticMarkup(<Button size={size}>x</Button>);
      const h = Number(/min-h-(\d+)/.exec(html)?.[1]) * 4;
      expect(h).toBeGreaterThanOrEqual(24);
    }
  });
});

describe('Input', () => {
  it('associates the label and the error message', () => {
    const html = renderToStaticMarkup(<Input name="email" label="Email" error="Required" />);
    expect(html).toContain('for="email"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="email-error"');
  });
});

describe('Card and StatusDot', () => {
  it('uses the card radius and a dot-plus-text status', () => {
    expect(renderToStaticMarkup(<Card>x</Card>)).toContain('rounded-card');
    const dot = renderToStaticMarkup(<StatusDot status="success" label="On sale" />);
    expect(dot).toContain('bg-green-500');
    expect(dot).toContain('aria-hidden="true"');
    expect(dot).toContain('On sale');
  });
});

describe('Table', () => {
  const columns = [
    { key: 'name', header: 'Name', cell: (r: { id: string; name: string; n: number }) => r.name },
    { key: 'n', header: 'Sold', cell: (r: { n: number }) => r.n, align: 'end' as const, mono: true },
  ];
  it('renders a captioned table with logical alignment', () => {
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
    expect(html).not.toMatch(/text-(left|right)/);
  });
  it('shows the empty state', () => {
    const html = renderToStaticMarkup(
      <Table caption="T" columns={columns} rows={[]} rowKey={(r) => r.id} empty="Nothing yet" />,
    );
    expect(html).toContain('Nothing yet');
  });
});
