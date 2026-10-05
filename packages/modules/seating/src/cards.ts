import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { z } from 'zod';
import {
  EXPORT_FORMATS,
  EXPORT_KINDS,
  type MealCounts,
  mealCounts,
  type SeatingSheet,
  seatingSheet,
} from './domain/cards.ts';
import { OCCUPANT_STATUSES } from './domain/guest-seating.ts';
import { guestSeatingViewTx, PLACE_KINDS } from './guest-seating.ts';

/**
 * Cards and exports (M4.3b): the chart's guest seating as printed cards (any reader of the guest
 * list may print them) and as the seating chart and caterer meal count files (an export: audited,
 * for roles that may export the guest list). The pure rules are in `domain/cards.ts`.
 */

const SheetGuestDto = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  guestOf: z.string().nullable(),
  partyId: z.uuid(),
  party: z.string(),
  ageClass: z.enum(['adult', 'child', 'infant']),
  meal: z.string().nullable(),
  status: z.enum(OCCUPANT_STATUSES),
});

export const SeatingSheetDto = z.object({
  places: z.array(
    z.object({
      itemId: z.uuid(),
      kind: z.enum(PLACE_KINDS),
      label: z.string(),
      capacity: z.int(),
      vip: z.boolean(),
      sponsor: z.string().nullable(),
      guests: z.array(SheetGuestDto),
    }),
  ),
  unseated: z.array(SheetGuestDto),
});
export type SeatingSheetDto = z.infer<typeof SeatingSheetDto>;

const MealCountRowDto = z.object({
  place: z.string().nullable(),
  meals: z.array(z.int()),
  notChosen: z.int(),
  children: z.int(),
  infants: z.int(),
  total: z.int(),
});

export const MealCountsDto = z.object({
  meals: z.array(z.string()),
  rows: z.array(MealCountRowDto),
  totals: MealCountRowDto,
});

export const SeatingCardsDto = z.object({
  subEventId: z.uuid().nullable(),
  subEvents: z.array(z.object({ id: z.uuid(), name: z.string() })),
  /** No chart to print from: the event (or sub-event) has no plan yet. */
  hasPlan: z.boolean(),
  sheet: SeatingSheetDto,
  /** How many cards of each kind the sheet prints. */
  counts: z.object({ place: z.int(), escort: z.int(), table: z.int() }),
});
export type SeatingCardsDto = z.infer<typeof SeatingCardsDto>;

const ContextInput = z.object({ eventId: z.uuid(), subEventId: z.uuid().nullable().default(null) });

/** The chart by table, for printing place, escort and table cards (and the page's counts). */
export const seatingCardsQuery = tenantQuery({
  name: 'seating.cards',
  input: ContextInput,
  output: SeatingCardsDto,
  entitlement: 'seating',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const view = await guestSeatingViewTx(tx, input.eventId, input.subEventId);
    const sheet: SeatingSheet = seatingSheet(view);
    const coming = sheet.places.flatMap((p) =>
      p.guests.filter((g) => g.status !== 'declined').map((g) => `${p.itemId}:${g.partyId}`),
    );
    return SeatingCardsDto.parse({
      subEventId: input.subEventId,
      subEvents: view.subEvents,
      hasPlan: view.doc !== null,
      sheet,
      counts: { place: coming.length, escort: new Set(coming).size, table: sheet.places.length },
    });
  },
});

export const ExportGuestSeatingInput = ContextInput.extend({
  kind: z.enum(EXPORT_KINDS),
  format: z.enum(EXPORT_FORMATS),
});

export const GuestSeatingExportDto = z.object({ sheet: SeatingSheetDto, meals: MealCountsDto });
export type GuestSeatingExportDto = z.infer<typeof GuestSeatingExportDto>;

/**
 * The seating chart by table and the caterer's meal counts, for a CSV or XLSX download. A command
 * (not a query) so every export is audited with what was taken; it changes nothing else. Needs the
 * guest list export permission (planners don't have it).
 */
export const exportGuestSeatingCommand = tenantCommand({
  name: 'seating.exportGuestSeating',
  input: ExportGuestSeatingInput,
  output: GuestSeatingExportDto,
  entitlement: 'seating',
  permission: 'attendees:export',
  handler: async ({ input, tx }) => {
    const sheet = seatingSheet(await guestSeatingViewTx(tx, input.eventId, input.subEventId));
    const meals: MealCounts = mealCounts(sheet);
    return { sheet, meals };
  },
  audit: (input, out) => ({
    action: 'seating.guests.export',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      subEventId: input.subEventId,
      kind: input.kind,
      format: input.format,
      rows:
        input.kind === 'chart'
          ? out.sheet.places.reduce((n, p) => n + p.guests.length, 0) + out.sheet.unseated.length
          : out.meals.rows.length,
    },
  }),
});
