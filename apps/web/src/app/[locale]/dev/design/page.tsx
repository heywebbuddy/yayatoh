import {
  Alert,
  Avatar,
  AvatarStack,
  Badge,
  Breadcrumb,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  filterChipClass,
  HighlightCard,
  IconButton,
  Input,
  PageHeader,
  Pagination,
  PersonChip,
  Radio,
  ScheduleLane,
  SearchPill,
  SectionHeader,
  Select,
  SkeletonCard,
  SkeletonText,
  StatCard,
  StatusPill,
  Stepper,
  Switch,
  TabCount,
  Table,
  Tabs,
  Tag,
  Textarea,
  Timeline,
  tabClass,
} from '@yayatoh/ui';
import { X } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { devAuthEnabled } from '@/server/session.ts';
import { OverlayDemo } from './overlay-demo.tsx';
import { S } from './specimens.ts';

export const metadata: Metadata = { title: S.title, robots: { index: false } };

/** Literal classes so Tailwind generates every swatch. */
const SWATCHES: readonly [string, string][] = [
  ['canvas', 'bg-canvas'],
  ['surface', 'bg-surface'],
  ['surface-2', 'bg-surface-2'],
  ['surface-3', 'bg-surface-3'],
  ['line', 'bg-line'],
  ['line-strong', 'bg-line-strong'],
  ['ink', 'bg-ink'],
  ['ink-2', 'bg-ink-2'],
  ['primary', 'bg-primary'],
  ['primary-soft', 'bg-primary-soft'],
  ['brand', 'bg-brand'],
  ['brand-soft', 'bg-brand-soft'],
  ['success-dot', 'bg-success-dot'],
  ['warning-dot', 'bg-warning-dot'],
  ['danger-dot', 'bg-danger-dot'],
  ['tag', 'bg-tag'],
  ['side', 'bg-side'],
  ['lavender', 'bg-lavender'],
  ['blush', 'bg-blush'],
  ['sky', 'bg-sky'],
  ['sand', 'bg-sand'],
  ['mint', 'bg-mint'],
];

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-label tracking-[0.12em] text-ink-2 uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Every specimen once; rendered per theme and direction by the page. */
function Specimens({ id }: { id: string }) {
  const t = S.table;
  return (
    <div className="flex flex-col gap-8">
      <Block title={S.sections.colour}>
        <ul className="m-0 grid list-none grid-cols-3 gap-2.5 p-0 sm:grid-cols-4 xl:grid-cols-6">
          {SWATCHES.map(([name, cls]) => (
            <li key={name} className="flex flex-col gap-1.5">
              <span className={`h-12 rounded-tile border border-line ${cls}`} />
              <span className="text-caption font-bold text-ink">{name}</span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-3 gap-2.5">
          <span className="h-14 rounded-tile bg-highlight" />
          <span className="h-14 rounded-tile bg-hero" />
          <span className="h-14 rounded-tile bg-promo" />
        </div>
      </Block>

      <Block title={S.sections.type}>
        <p className="m-0 text-[40px] leading-none font-extrabold tracking-[-0.045em] text-ink sm:text-display">
          {S.display}
        </p>
        <p className="m-0 text-title text-ink">{S.pageTitle}</p>
        <p className="m-0 text-section text-ink">{S.section}</p>
        <p className="m-0 max-w-[46ch] text-prose text-ink-2">{S.body}</p>
        <p className="m-0 text-[28px] font-extrabold tracking-[-0.04em] text-ink tabular-nums sm:text-stat">
          {S.numbers}
        </p>
        <p className="m-0 text-label text-ink-2 uppercase">{S.label}</p>
      </Block>

      <Block title={S.sections.actions}>
        {S.variants.map((v) => (
          <div key={v} className="flex flex-wrap items-center gap-2.5">
            <Button variant={v}>{S.button}</Button>
            <Button variant={v} className="outline-2 outline-offset-2 outline-focus">
              {S.states.focus}
            </Button>
            <Button variant={v} disabled>
              {S.states.disabled}
            </Button>
            <Button variant={v} loading>
              {S.states.loading}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button size="sm">{S.button}</Button>
          <Button size="md">{S.button}</Button>
          <Button size="lg">{S.button}</Button>
          <IconButton label={S.icon} icon={<X aria-hidden="true" strokeWidth={2} />} />
          <div className="rounded-tile bg-hero p-3">
            <Button variant="inverse">{S.button}</Button>
          </div>
        </div>
      </Block>

      <Block title={S.sections.surfaces}>
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={S.kpi.label}
            value={S.kpi.value}
            delta={S.kpi.delta}
            deltaTone="primary"
            progress={{ value: 86, label: S.kpi.progress }}
            sub={S.kpi.sub}
          />
          <StatCard
            label={S.revenue.label}
            value={S.revenue.value}
            delta={S.revenue.delta}
            sub={S.revenue.sub}
          />
          <HighlightCard
            label={S.highlight.label}
            value={S.highlight.value}
            chip={S.highlight.chip}
            sub={S.highlight.sub}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardHeader title={S.sections.surfaces} as="h3" />
            <p className="m-0 mt-2 text-body text-ink-2">{S.card}</p>
          </Card>
          <Card tone="feature">
            <p className="m-0 text-body text-ink">{S.card}</p>
          </Card>
          <Card tone="muted" interactive>
            <p className="m-0 text-body text-ink">{S.card}</p>
          </Card>
        </div>
      </Block>

      <Block title={S.sections.labels}>
        <div className="flex flex-wrap items-center gap-2">
          {S.tags.map((x) => (
            <Tag key={x}>{x}</Tag>
          ))}
          <Badge>3</Badge>
          <Badge tone="primary">7/10</Badge>
          <Badge tone="brand">12</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {S.pills.map(([tone, label]) => (
            <StatusPill key={tone} tone={tone} label={label} live={tone === 'success'} />
          ))}
        </div>
      </Block>

      <Block title={S.sections.people}>
        <div className="flex flex-wrap items-center gap-3">
          {S.people.map((p) => (
            <Avatar key={p.name} initials={p.initials} label={p.name} size={42} />
          ))}
          <AvatarStack
            people={S.people.map((p) => ({ name: p.name, initials: p.initials }))}
            max={3}
            label={S.party}
          />
        </div>
        <div className="flex flex-wrap gap-2.5">
          <PersonChip
            name={S.people[0].name}
            initials={S.people[0].initials}
            detail={S.people[0].detail}
            checked
            checkLabel={S.checkedIn}
          />
          <PersonChip name={S.people[1].name} initials={S.people[1].initials} detail={S.people[1].detail} />
        </div>
      </Block>

      <Block title={S.sections.navigation}>
        <Tabs label={`${S.sections.navigation} ${id}`}>
          {S.tabs.map(([label, count], i) => (
            <a
              key={label}
              href="#tabs"
              aria-current={i === 1 ? 'page' : undefined}
              className={tabClass(i === 1)}
            >
              {label}
              {count ? <TabCount active={i === 1}>{count}</TabCount> : null}
            </a>
          ))}
        </Tabs>
        <div className="flex flex-wrap gap-1.5">
          {S.filters.map(([label, n], i) => (
            <button key={label} type="button" aria-pressed={i === 0} className={filterChipClass(i === 0)}>
              {label} <span className="tabular-nums">{n}</span>
            </button>
          ))}
        </div>
        <Breadcrumb
          label={`${S.breadcrumb} ${id}`}
          items={S.crumbs.map((label, i) => ({
            label,
            href: i < S.crumbs.length - 1 ? '#crumb' : undefined,
          }))}
        />
        <SearchPill label={S.search} placeholder={S.search} shortcut="⌘K" id={`search-${id}`} />
        <Pagination
          label={`${S.pagination.label} ${id}`}
          previous={{ href: '#prev', label: S.pagination.previous }}
          next={{ href: null, label: S.pagination.next }}
          status={S.pagination.status}
        />
      </Block>

      <Block title={S.sections.inputs}>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            id={`name-${id}`}
            label={S.field.label}
            defaultValue={S.field.value}
            hint={S.field.hint}
            required
          />
          <Input
            id={`email-${id}`}
            label={S.fieldError.label}
            defaultValue={S.fieldError.value}
            error={S.fieldError.error}
          />
          <Select id={`tz-${id}`} label={S.select.label}>
            {S.select.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
          <Input id={`date-${id}`} type="date" label={S.date} />
          <Input id={`dis-${id}`} label={S.states.disabled} defaultValue={S.field.value} disabled />
          <Textarea id={`notes-${id}`} label={S.textarea.label} defaultValue={S.textarea.value} rows={2} />
        </div>
        <div className="grid gap-1 md:grid-cols-3">
          <Checkbox id={`cb-${id}`} label={S.checkbox} defaultChecked />
          {S.radio.map((r, i) => (
            <Radio
              key={r}
              id={`r-${id}-${r}`}
              name={`r-${id}`}
              value={r}
              label={r}
              defaultChecked={i === 0}
            />
          ))}
          <Switch id={`sw-${id}`} label={S.switch} defaultChecked />
        </div>
      </Block>

      <Block title={S.sections.data}>
        <Table
          caption={`${t.caption} ${id}`}
          captionHidden={false}
          rows={t.rows}
          rowKey={(r) => r.id}
          select={{ name: `orders-${id}`, header: t.select, label: (r) => t.selectLabel(r.name) }}
          stackOnPhone
          columns={[
            { key: 'name', header: t.headers.name, cell: (r) => <span className="font-bold">{r.name}</span> },
            { key: 'what', header: t.headers.what, cell: (r) => r.what },
            { key: 'src', header: t.headers.source, cell: (r) => <Tag>{r.source}</Tag> },
            {
              key: 'amt',
              header: t.headers.amount,
              cell: (r) => <span className="font-extrabold">{r.amount}</span>,
              align: 'end',
            },
          ]}
        />
      </Block>

      <Block title={S.sections.overlays}>
        <OverlayDemo />
      </Block>

      <Block title={S.sections.states}>
        <div className="grid gap-3 md:grid-cols-2">
          <EmptyState
            title={S.empty.title}
            description={S.empty.description}
            icon={<X aria-hidden="true" />}
            action={<Button>{S.empty.action}</Button>}
          />
          <ErrorState
            title={S.error.title}
            description={S.error.description}
            retry={<Button variant="secondary">{S.error.retry}</Button>}
          />
          <SkeletonCard label={S.loading} />
          <Card>
            <SkeletonText lines={4} />
          </Card>
          <Alert tone="success" title={S.alert.title}>
            {S.alert.body}
          </Alert>
          <Alert tone="danger" title={S.fieldError.error} />
        </div>
      </Block>

      <Block title={S.sections.layout}>
        <PageHeader
          title={S.header.title}
          tag={<StatusPill tone="success" label={S.header.tag} live />}
          meta={<span>{S.header.meta}</span>}
          actions={<Button>{S.header.action}</Button>}
        />
        <SectionHeader
          title={S.sectionHeader.title}
          description={S.sectionHeader.description}
          count={S.sectionHeader.count}
          actions={<Button variant="secondary">{S.empty.action}</Button>}
        />
        <Stepper
          label={`${S.stepsLabel} ${id}`}
          steps={S.steps.map((label, i) => ({
            label,
            state: i === 0 ? 'done' : i === 1 ? 'current' : 'todo',
          }))}
        />
        <ScheduleLane label={`${S.lane.label} ${id}`} items={S.lane.items} />
        <Timeline label={`${S.timeline[0].title} ${id}`} items={S.timeline} />
      </Block>
    </div>
  );
}

/**
 * The living style guide (ADR 0022): development only (404 without YAYATOH_DEV_AUTH, so never in
 * production). Light and dark side by side, and the Arabic (RTL) layout below.
 */
export default async function DesignPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!devAuthEnabled()) notFound();
  return (
    <main id="main" className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader title={S.title} description={S.intro} />
      <div className="grid gap-4 2xl:grid-cols-2">
        <section data-theme="light" aria-label={S.light} className="min-w-0 rounded-panel bg-page p-4 md:p-8">
          <h2 className="m-0 mb-6 text-section text-ink">{S.light}</h2>
          <Specimens id="light" />
        </section>
        <section data-theme="dark" aria-label={S.dark} className="min-w-0 rounded-panel bg-page p-4 md:p-8">
          <h2 className="m-0 mb-6 text-section text-ink">{S.dark}</h2>
          <Specimens id="dark" />
        </section>
      </div>
      <section dir="rtl" lang="ar" aria-label={S.rtl} className="min-w-0 rounded-panel bg-page p-4 md:p-8">
        <h2 className="m-0 mb-6 text-section text-ink">{S.rtl}</h2>
        <Specimens id="rtl" />
      </section>
    </main>
  );
}
