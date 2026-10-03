import { privateColumns as ai } from '@yayatoh/ai';
import { privateColumns as alerts } from '@yayatoh/alerts';
import { privateColumns as assistance } from '@yayatoh/assistance';
import { privateColumns as attendees } from '@yayatoh/attendees';
import { privateColumns as audiences } from '@yayatoh/audiences';
import { privateColumns as automations } from '@yayatoh/automations';
import { privateColumns as badges } from '@yayatoh/badges';
import { privateColumns as billing } from '@yayatoh/billing';
import { privateColumns as campaigns } from '@yayatoh/campaigns';
import { privateColumns as checkin } from '@yayatoh/checkin';
import { privateColumns as cms } from '@yayatoh/cms';
import { privateColumns as commandCenter } from '@yayatoh/command-center';
import { privateColumns as crm } from '@yayatoh/crm';
import type { CanarySeed, ColumnRule, PrivateClass, PrivateColumn, SchemaPrivacy } from '@yayatoh/db';
import { privateColumns as donations } from '@yayatoh/donations';
import { privateColumns as engagement } from '@yayatoh/engagement';
import { privateColumns as events } from '@yayatoh/events';
import { privateColumns as forms } from '@yayatoh/forms';
import { privateColumns as guests } from '@yayatoh/guests';
import { privateColumns as marketing } from '@yayatoh/marketing';
import { privateColumns as marketplace } from '@yayatoh/marketplace';
import { privateColumns as media } from '@yayatoh/media';
import { privateColumns as messaging } from '@yayatoh/messaging';
import { privateColumns as notifications } from '@yayatoh/notifications';
import { privateColumns as orders } from '@yayatoh/orders';
import { privateColumns as payments } from '@yayatoh/payments';
import { privateColumns as platform } from '@yayatoh/platform';
import { privateColumns as privacy } from '@yayatoh/privacy';
import { privateColumns as program } from '@yayatoh/program';
import { privateColumns as registration } from '@yayatoh/registration';
import { privateColumns as reports } from '@yayatoh/reports';
import { privateColumns as reviews } from '@yayatoh/reviews';
import { privateColumns as seating } from '@yayatoh/seating';
import { privateColumns as surveys } from '@yayatoh/surveys';
import { privateColumns as templates } from '@yayatoh/templates';
import { privateColumns as tenancy } from '@yayatoh/tenancy';
import { privateColumns as ticketing } from '@yayatoh/ticketing';
import { privateColumns as venues } from '@yayatoh/venues';

/**
 * Every module's column-privacy declaration (roadmap §9). A module that adds tenant tables exports
 * `privateColumns` (see `columnPrivacy` in @yayatoh/db) and is listed here; the coverage test
 * (`tests/column-privacy.test.ts`) names the exact line to add when a column is missing.
 */
export const COLUMN_PRIVACY: readonly SchemaPrivacy[] = [
  ai,
  alerts,
  assistance,
  attendees,
  audiences,
  automations,
  badges,
  billing,
  campaigns,
  checkin,
  cms,
  commandCenter,
  crm,
  engagement,
  donations,
  events,
  forms,
  guests,
  marketing,
  marketplace,
  media,
  messaging,
  notifications,
  orders,
  payments,
  platform,
  privacy,
  program,
  registration,
  reports,
  reviews,
  seating,
  surveys,
  templates,
  tenancy,
  ticketing,
  venues,
];

/** `schema.table.column` */
export type ColumnId = string;

export interface RegisteredColumn {
  readonly id: ColumnId;
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly rule: ColumnRule;
}

export interface RegisteredPrivateColumn extends RegisteredColumn {
  readonly rule: PrivateColumn;
}

export const isPrivate = (r: ColumnRule): r is PrivateColumn => typeof r === 'object';

export function registeredColumns(list: readonly SchemaPrivacy[] = COLUMN_PRIVACY): RegisteredColumn[] {
  return list.flatMap((s) =>
    Object.entries(s.tables).flatMap(([table, cols]) =>
      Object.entries(cols).map(([column, rule]) => ({
        id: `${s.schema}.${table}.${column}`,
        schema: s.schema,
        table,
        column,
        rule,
      })),
    ),
  );
}

export function privateColumnList(
  list: readonly SchemaPrivacy[] = COLUMN_PRIVACY,
): RegisteredPrivateColumn[] {
  return registeredColumns(list).filter((c): c is RegisteredPrivateColumn => isPrivate(c.rule));
}

/** The canary a private column is filled with: `__CANARY_<schema>.<table>.<column>__`. */
export const canaryToken = (id: ColumnId) => `__CANARY_${id}__`;

/** The phone canaries: `+1 999 555 <column index><row, 3 digits>` (E.164, never assigned). */
export const PHONE_PREFIX = '+1999555';

export function phoneColumns(list: readonly SchemaPrivacy[] = COLUMN_PRIVACY): ColumnId[] {
  return privateColumnList(list)
    .filter((c) => c.rule.seed === 'phone')
    .map((c) => c.id);
}

/** Code canaries (upper-case code columns): `CANARY_<two-digit column index>_<row>`. */
export function codeColumns(list: readonly SchemaPrivacy[] = COLUMN_PRIVACY): ColumnId[] {
  return privateColumnList(list)
    .filter((c) => c.rule.seed === 'code')
    .map((c) => c.id);
}

/** The seed a private column gets: its explicit one, else from the SQL type. */
export function seedOf(rule: PrivateColumn, sqlType: string): CanarySeed {
  if (rule.seed) return rule.seed;
  if (sqlType === 'jsonb' || sqlType === 'json') return 'json';
  if (sqlType.endsWith('[]') || sqlType === 'ARRAY') return 'array';
  return 'text';
}

export type { CanarySeed, PrivateClass };
