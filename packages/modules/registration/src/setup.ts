import { ensureEventAddonTx, eventAddonTx } from '@yayatoh/billing';
import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import {
  archiveTicketTypeTx,
  CreateTicketTypeInput,
  createTicketTypeTx,
  listTicketTypesQuery,
  updateTicketTypeTx,
} from '@yayatoh/ticketing';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { lockTypeTx, offerFreedPlacesTx, typeDemandTx } from './capacity.ts';
import { capacityFloor } from './domain/capacity.ts';
import { normalizeAccessCode, normalizeDomain } from './domain/eligibility.ts';
import { DEFAULT_ITEMS, DEFAULT_NAMES, DEFAULT_TYPE_KEYS, keyFromName, uniqueKey } from './domain/matrix.ts';
import {
  AdmissionItemDto,
  RegistrationSetupDto,
  RegistrationTypeDto,
  registrationSetupSerializer,
} from './dto.ts';
import { RegistrationTypeRef } from './ref.ts';
import {
  ADMISSION_ITEM_KINDS,
  admissionItems,
  ELIGIBILITY_KINDS,
  registrationTypes,
  typeItems,
} from './schema.ts';

type Emit = (e: DomainEvent) => void;
type TypeRow = typeof registrationTypes.$inferSelect;
type ItemRow = typeof admissionItems.$inferSelect;

/** Each cell's ticket type admits its holder alone (one registrant per registration). */
const CELL_QUANTITY = 1_000_000;
/** P5-11 defaults when the catalog names no quota. */
const PACK = 'conference_pack';

const Name = z.string().trim().min(1).max(80);
const Description = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .default(null)
  .transform((d) => (d ? d : null));
const Key = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)
  .optional();

const AccessCode = z
  .string()
  .nullable()
  .default(null)
  .transform((c, ctx) => {
    if (c === null || c.trim() === '') return null;
    const n = normalizeAccessCode(c);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Use 4 to 32 letters, digits, - or _', path: [] });
      return z.NEVER;
    }
    return n;
  });

const Domains = z
  .array(z.string())
  .max(20)
  .default([])
  .transform((list, ctx) => {
    const out: string[] = [];
    for (const raw of list) {
      if (!raw.trim()) continue;
      const d = normalizeDomain(raw);
      if (!d) {
        ctx.addIssue({ code: 'custom', message: 'Not a domain name', path: [] });
        return z.NEVER;
      }
      if (!out.includes(d)) out.push(d);
    }
    return out;
  });

const TypeFields = z
  .object({
    name: Name,
    description: Description,
    sortOrder: z.int().min(0).max(10_000).default(0),
    /** Null: no per-type limit. */
    capacity: z.int().min(0).max(1_000_000).nullable().default(null),
    eligibility: z.enum(ELIGIBILITY_KINDS).default('open'),
    accessCode: AccessCode,
    emailDomains: Domains,
  })
  .superRefine((v, ctx) => {
    if (v.eligibility === 'access_code' && !v.accessCode)
      ctx.addIssue({ code: 'custom', message: 'Enter the access code', path: ['accessCode'] });
    if (v.eligibility === 'email_domain' && v.emailDomains.length === 0)
      ctx.addIssue({ code: 'custom', message: 'Enter at least one domain', path: ['emailDomains'] });
  });

// ---------------------------------------------------------------------------------------------
// Reads

async function eventForSetupTx(tx: TenantTx, eventId: string, write: boolean) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  if (write && ['cancelled', 'completed', 'archived'].includes(event.status))
    throw new DomainError('invalid_state', 'Registration cannot change on a finished event', {
      reason: 'event_finished',
    });
  return event;
}

async function liveTypesTx(tx: TenantTx, eventId: string) {
  return tx
    .select()
    .from(registrationTypes)
    .where(and(eq(registrationTypes.eventId, eventId), isNull(registrationTypes.archivedAt)))
    .orderBy(asc(registrationTypes.sortOrder), asc(registrationTypes.createdAt));
}

async function liveItemsTx(tx: TenantTx, eventId: string) {
  return tx
    .select()
    .from(admissionItems)
    .where(and(eq(admissionItems.eventId, eventId), isNull(admissionItems.archivedAt)))
    .orderBy(asc(admissionItems.sortOrder), asc(admissionItems.createdAt));
}

async function liveCellsTx(tx: TenantTx, eventId: string) {
  return tx
    .select()
    .from(typeItems)
    .where(and(eq(typeItems.eventId, eventId), isNull(typeItems.archivedAt)));
}

async function typeDtoTx(tx: TenantTx, t: TypeRow): Promise<RegistrationTypeDto> {
  const d = await typeDemandTx(tx, t.id);
  return {
    ...t,
    eligibility: t.eligibility as RegistrationTypeDto['eligibility'],
    waiting: d.waiting,
    offered: d.offered,
  };
}

/** The Registration page (M5.1a): types, items, the matrix with prices, counters and the pack. */
export const registrationSetupQuery = tenantQuery({
  name: 'registration.setup',
  input: z.object({ eventId: z.uuid() }),
  output: RegistrationSetupDto,
  entitlement: 'registration',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await eventForSetupTx(tx, input.eventId, false);
    const types = await liveTypesTx(tx, event.id);
    const items = await liveItemsTx(tx, event.id);
    const cells = await liveCellsTx(tx, event.id);
    const tickets = new Map(
      (await listTicketTypesQuery.handler({ input: { eventId: event.id }, ctx, tx })).map((t) => [t.id, t]),
    );
    const pack = await eventAddonTx(tx, event.id, PACK);
    return registrationSetupSerializer.serialize({
      eventId: event.id,
      currency: event.currency,
      types: await Promise.all(types.map((t) => typeDtoTx(tx, t))),
      items: items.map((i) => ({ ...i, kind: i.kind as AdmissionItemDto['kind'] })),
      cells: cells.flatMap((c) => {
        const t = tickets.get(c.ticketTypeId);
        return t
          ? [{ ...c, priceMinor: t.priceMinor, allInMinor: t.allInMinor, quantitySold: t.quantitySold }]
          : [];
      }),
      pack: { active: pack !== null, source: pack?.source ?? null, quotas: pack?.quotas ?? {} },
    });
  },
});

/** Stable references to an event's live types (M5.1b form paths, M5.5a badges). */
export const registrationTypeRefsQuery = tenantQuery({
  name: 'registration.typeRefs',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(RegistrationTypeRef),
  entitlement: 'registration',
  permission: 'events:read',
  handler: async ({ input, tx }) =>
    (await liveTypesTx(tx, input.eventId)).map((t) => ({ id: t.id, key: t.key, name: t.name })),
});

// ---------------------------------------------------------------------------------------------
// Writes

/** The conference pack for the event (free in beta; P5-11) and a quota check on it. */
async function packQuotaTx(tx: TenantTx, ctx: Ctx, eventId: string, quota: string, used: number) {
  const pack = await ensureEventAddonTx(tx, ctx, eventId, PACK);
  const limit = pack.quotas[quota];
  if (limit !== undefined && used >= limit)
    throw new DomainError('invalid_state', 'The conference pack quota for this event is reached', {
      reason: 'quota_reached',
      quota,
      limit,
    });
}

const typeEvent = (kind: string, t: TypeRow): DomainEvent => ({
  type: `registration.type.${kind}`,
  version: 1,
  aggregateType: 'registration_type',
  aggregateId: t.id,
  payload: { orgId: t.orgId, eventId: t.eventId, registrationTypeId: t.id, key: t.key },
});

const itemEvent = (kind: string, i: ItemRow): DomainEvent => ({
  type: `registration.item.${kind}`,
  version: 1,
  aggregateType: 'admission_item',
  aggregateId: i.id,
  payload: { orgId: i.orgId, eventId: i.eventId, admissionItemId: i.id, key: i.key },
});

const keyTaken = (err: unknown, constraint: string) =>
  isUniqueViolation(err, constraint)
    ? new DomainError('conflict', 'This key is in use at this event', { field: 'key' })
    : err;

async function takenKeysTx(
  tx: TenantTx,
  table: typeof registrationTypes | typeof admissionItems,
  eventId: string,
) {
  const rows = await tx.select({ key: table.key }).from(table).where(eq(table.eventId, eventId));
  return new Set(rows.map((r) => r.key));
}

async function insertTypeTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  eventId: string,
  v: z.output<typeof TypeFields> & { key?: string | undefined },
): Promise<TypeRow> {
  const key = v.key ?? uniqueKey(keyFromName(v.name), await takenKeysTx(tx, registrationTypes, eventId));
  let row: TypeRow | undefined;
  try {
    [row] = await tx.transaction((sp) =>
      sp
        .insert(registrationTypes)
        .values({
          orgId: requireOrg(ctx),
          eventId,
          key,
          name: v.name,
          description: v.description,
          sortOrder: v.sortOrder,
          capacity: v.capacity,
          eligibility: v.eligibility,
          accessCode: v.eligibility === 'access_code' ? v.accessCode : null,
          emailDomains: v.eligibility === 'email_domain' ? v.emailDomains : [],
        })
        .returning(),
    );
  } catch (err) {
    throw keyTaken(err, 'registration_types_org_event_key');
  }
  if (!row) throw new DomainError('internal');
  emit(typeEvent('created', row));
  return row;
}

export const CreateRegistrationTypeInput = TypeFields.and(z.object({ eventId: z.uuid(), key: Key }));

export const createRegistrationTypeCommand = tenantCommand({
  name: 'registration.createType',
  input: CreateRegistrationTypeInput,
  output: RegistrationTypeDto,
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventForSetupTx(tx, input.eventId, true);
    await packQuotaTx(
      tx,
      ctx,
      input.eventId,
      'registrationTypes',
      (await liveTypesTx(tx, input.eventId)).length,
    );
    return typeDtoTx(tx, await insertTypeTx(tx, ctx, emit, input.eventId, input));
  },
  audit: (input, r) => ({
    action: 'registration.type.create',
    targetType: 'registration_type',
    targetId: r.id,
    data: { eventId: input.eventId, capacity: input.capacity, eligibility: input.eligibility },
  }),
});

async function liveTypeTx(tx: TenantTx, eventId: string, typeId: string, lock = false) {
  const row = lock
    ? await lockTypeTx(tx, typeId)
    : (await tx.select().from(registrationTypes).where(eq(registrationTypes.id, typeId)))[0];
  if (!row || row.eventId !== eventId || row.archivedAt)
    throw new DomainError('not_found', 'Registration type not found');
  return row;
}

async function liveItemTx(tx: TenantTx, eventId: string, itemId: string) {
  const [row] = await tx.select().from(admissionItems).where(eq(admissionItems.id, itemId));
  if (!row || row.eventId !== eventId || row.archivedAt) throw new DomainError('not_found', 'Item not found');
  return row;
}

const cellName = (t: { name: string }, i: { name: string }) => `${t.name} · ${i.name}`.slice(0, 120);

/** Keep the cells' ticket type names ("Member · Full pass") in step with renames. */
async function renameCellsTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  where: { typeId?: string; itemId?: string },
) {
  const cells = await tx
    .select({
      ticketTypeId: typeItems.ticketTypeId,
      typeName: registrationTypes.name,
      itemName: admissionItems.name,
      typeOrder: registrationTypes.sortOrder,
      itemOrder: admissionItems.sortOrder,
    })
    .from(typeItems)
    .innerJoin(registrationTypes, eq(registrationTypes.id, typeItems.registrationTypeId))
    .innerJoin(admissionItems, eq(admissionItems.id, typeItems.admissionItemId))
    .where(
      and(
        isNull(typeItems.archivedAt),
        where.typeId ? eq(typeItems.registrationTypeId, where.typeId) : undefined,
        where.itemId ? eq(typeItems.admissionItemId, where.itemId) : undefined,
      ),
    );
  for (const c of cells)
    await updateTicketTypeTx(
      tx,
      ctx,
      emit,
      {
        ticketTypeId: c.ticketTypeId,
        name: cellName({ name: c.typeName }, { name: c.itemName }),
        sortOrder: c.typeOrder * 100 + c.itemOrder,
      },
      'registration',
    );
}

export const UpdateRegistrationTypeInput = TypeFields.and(
  z.object({ eventId: z.uuid(), registrationTypeId: z.uuid() }),
);

/**
 * Change a type. Its capacity may not go below what is held, sold or offered; raising it offers
 * the freed places to the type's lines at once.
 */
export const updateRegistrationTypeCommand = tenantCommand({
  name: 'registration.updateType',
  input: UpdateRegistrationTypeInput,
  output: RegistrationTypeDto,
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventForSetupTx(tx, input.eventId, true);
    const current = await liveTypeTx(tx, input.eventId, input.registrationTypeId, true);
    const demand = await typeDemandTx(tx, current.id);
    const floor = capacityFloor({ held: current.quantityHeld, sold: current.quantitySold }, demand);
    if (input.capacity !== null && input.capacity < floor)
      throw new DomainError('invalid_state', 'Capacity cannot go below places already taken', {
        field: 'capacity',
        reason: 'capacity_below_taken',
        minimum: floor,
      });
    const [row] = await tx
      .update(registrationTypes)
      .set({
        name: input.name,
        description: input.description,
        sortOrder: input.sortOrder,
        capacity: input.capacity,
        eligibility: input.eligibility,
        accessCode: input.eligibility === 'access_code' ? input.accessCode : null,
        emailDomains: input.eligibility === 'email_domain' ? input.emailDomains : [],
        updatedAt: ctx.now,
      })
      .where(eq(registrationTypes.id, current.id))
      .returning();
    if (!row) throw new DomainError('not_found');
    if (row.name !== current.name || row.sortOrder !== current.sortOrder)
      await renameCellsTx(tx, ctx, emit, { typeId: row.id });
    emit(typeEvent('updated', row));
    await offerFreedPlacesTx(tx, ctx, emit, row.id);
    return typeDtoTx(tx, row);
  },
  audit: (input) => ({
    action: 'registration.type.update',
    targetType: 'registration_type',
    targetId: input.registrationTypeId,
    data: { capacity: input.capacity, eligibility: input.eligibility },
  }),
});

async function archiveCellsTx(tx: TenantTx, ctx: Ctx, emit: Emit, cells: (typeof typeItems.$inferSelect)[]) {
  for (const c of cells) {
    await archiveTicketTypeTx(tx, ctx, emit, c.ticketTypeId, 'registration');
    await tx.update(typeItems).set({ archivedAt: ctx.now, updatedAt: ctx.now }).where(eq(typeItems.id, c.id));
  }
}

/**
 * Archive a type: it leaves checkout and the page (its cells' passes are archived). Tickets sold
 * stay valid and keep counting in orders, check-in and reports.
 */
export const archiveRegistrationTypeCommand = tenantCommand({
  name: 'registration.archiveType',
  input: z.object({ eventId: z.uuid(), registrationTypeId: z.uuid() }),
  output: z.object({ archived: z.boolean() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const t = await liveTypeTx(tx, input.eventId, input.registrationTypeId, true);
    const cells = await tx
      .select()
      .from(typeItems)
      .where(and(eq(typeItems.registrationTypeId, t.id), isNull(typeItems.archivedAt)));
    await archiveCellsTx(tx, ctx, emit, cells);
    const [row] = await tx
      .update(registrationTypes)
      .set({ archivedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(registrationTypes.id, t.id))
      .returning();
    if (!row) throw new DomainError('not_found');
    emit(typeEvent('archived', row));
    return { archived: true };
  },
  audit: (input) => ({
    action: 'registration.type.archive',
    targetType: 'registration_type',
    targetId: input.registrationTypeId,
  }),
});

const ItemFields = z.object({
  name: Name,
  description: Description,
  kind: z.enum(ADMISSION_ITEM_KINDS).default('admission'),
  sortOrder: z.int().min(0).max(10_000).default(0),
});

async function insertItemTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  eventId: string,
  v: z.output<typeof ItemFields> & { key?: string | undefined },
): Promise<ItemRow> {
  const key = v.key ?? uniqueKey(keyFromName(v.name), await takenKeysTx(tx, admissionItems, eventId));
  let row: ItemRow | undefined;
  try {
    [row] = await tx.transaction((sp) =>
      sp
        .insert(admissionItems)
        .values({ orgId: requireOrg(ctx), eventId, key, ...v })
        .returning(),
    );
  } catch (err) {
    throw keyTaken(err, 'admission_items_org_event_key');
  }
  if (!row) throw new DomainError('internal');
  emit(itemEvent('created', row));
  return row;
}

export const createAdmissionItemCommand = tenantCommand({
  name: 'registration.createItem',
  input: ItemFields.extend({ eventId: z.uuid(), key: Key }),
  output: AdmissionItemDto,
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventForSetupTx(tx, input.eventId, true);
    await packQuotaTx(
      tx,
      ctx,
      input.eventId,
      'admissionItems',
      (await liveItemsTx(tx, input.eventId)).length,
    );
    const row = await insertItemTx(tx, ctx, emit, input.eventId, input);
    return { ...row, kind: row.kind as AdmissionItemDto['kind'] };
  },
  audit: (input, r) => ({
    action: 'registration.item.create',
    targetType: 'admission_item',
    targetId: r.id,
    data: { eventId: input.eventId, kind: input.kind },
  }),
});

/** Rename or reorder an item. Its kind is fixed once cells sell it (it decides who counts). */
export const updateAdmissionItemCommand = tenantCommand({
  name: 'registration.updateItem',
  input: ItemFields.extend({ eventId: z.uuid(), admissionItemId: z.uuid() }),
  output: AdmissionItemDto,
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventForSetupTx(tx, input.eventId, true);
    const current = await liveItemTx(tx, input.eventId, input.admissionItemId);
    if (input.kind !== current.kind) {
      const [used] = await tx
        .select({ id: typeItems.id })
        .from(typeItems)
        .where(eq(typeItems.admissionItemId, current.id))
        .limit(1);
      if (used)
        throw new DomainError('invalid_state', 'An item in the matrix keeps its kind', {
          field: 'kind',
          reason: 'kind_locked',
        });
    }
    const [row] = await tx
      .update(admissionItems)
      .set({
        name: input.name,
        description: input.description,
        kind: input.kind,
        sortOrder: input.sortOrder,
        updatedAt: ctx.now,
      })
      .where(eq(admissionItems.id, current.id))
      .returning();
    if (!row) throw new DomainError('not_found');
    if (row.name !== current.name || row.sortOrder !== current.sortOrder)
      await renameCellsTx(tx, ctx, emit, { itemId: row.id });
    emit(itemEvent('updated', row));
    return { ...row, kind: row.kind as AdmissionItemDto['kind'] };
  },
  audit: (input) => ({
    action: 'registration.item.update',
    targetType: 'admission_item',
    targetId: input.admissionItemId,
  }),
});

export const archiveAdmissionItemCommand = tenantCommand({
  name: 'registration.archiveItem',
  input: z.object({ eventId: z.uuid(), admissionItemId: z.uuid() }),
  output: z.object({ archived: z.boolean() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const item = await liveItemTx(tx, input.eventId, input.admissionItemId);
    const cells = await tx
      .select()
      .from(typeItems)
      .where(and(eq(typeItems.admissionItemId, item.id), isNull(typeItems.archivedAt)));
    await archiveCellsTx(tx, ctx, emit, cells);
    const [row] = await tx
      .update(admissionItems)
      .set({ archivedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(admissionItems.id, item.id))
      .returning();
    if (!row) throw new DomainError('not_found');
    emit(itemEvent('archived', row));
    return { archived: true };
  },
  audit: (input) => ({
    action: 'registration.item.archive',
    targetType: 'admission_item',
    targetId: input.admissionItemId,
  }),
});

/**
 * Offer an item to a type at a price (a matrix cell): the first time, a ticket type managed by
 * registration is created (hidden; sold only through registration checkout); later, its price
 * changes (orders keep their snapshot).
 */
export const setCellCommand = tenantCommand({
  name: 'registration.setCell',
  input: z.object({
    eventId: z.uuid(),
    registrationTypeId: z.uuid(),
    admissionItemId: z.uuid(),
    priceMinor: z.int().min(0).max(100_000_000),
  }),
  output: z.object({ cellId: z.uuid(), ticketTypeId: z.uuid(), priceMinor: z.int() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventForSetupTx(tx, input.eventId, true);
    await ensureEventAddonTx(tx, ctx, input.eventId, PACK);
    const type = await liveTypeTx(tx, input.eventId, input.registrationTypeId, true);
    const item = await liveItemTx(tx, input.eventId, input.admissionItemId);
    const [cell] = await tx
      .select()
      .from(typeItems)
      .where(
        and(
          eq(typeItems.registrationTypeId, type.id),
          eq(typeItems.admissionItemId, item.id),
          isNull(typeItems.archivedAt),
        ),
      );
    if (cell) {
      await updateTicketTypeTx(
        tx,
        ctx,
        emit,
        { ticketTypeId: cell.ticketTypeId, priceMinor: input.priceMinor },
        'registration',
      );
      return { cellId: cell.id, ticketTypeId: cell.ticketTypeId, priceMinor: input.priceMinor };
    }
    const ticket = await createTicketTypeTx(
      tx,
      ctx,
      emit,
      CreateTicketTypeInput.parse({
        eventId: input.eventId,
        name: cellName(type, item),
        priceMinor: input.priceMinor,
        quantityTotal: CELL_QUANTITY,
        minPerOrder: 1,
        maxPerOrder: 1,
        visibility: 'hidden',
        sortOrder: type.sortOrder * 100 + item.sortOrder,
      }),
      { managedBy: 'registration' },
    );
    const [row] = await tx
      .insert(typeItems)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        registrationTypeId: type.id,
        admissionItemId: item.id,
        ticketTypeId: ticket.id,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    emit({
      type: 'registration.cell.enabled',
      version: 1,
      aggregateType: 'registration_type',
      aggregateId: type.id,
      payload: {
        orgId: row.orgId,
        eventId: row.eventId,
        registrationTypeId: type.id,
        admissionItemId: item.id,
      },
    });
    return { cellId: row.id, ticketTypeId: ticket.id, priceMinor: input.priceMinor };
  },
  audit: (input) => ({
    action: 'registration.cell.set',
    targetType: 'registration_type',
    targetId: input.registrationTypeId,
    data: { admissionItemId: input.admissionItemId, priceMinor: input.priceMinor },
  }),
});

/** Stop offering an item to a type (its pass is archived; sold tickets stay valid). */
export const disableCellCommand = tenantCommand({
  name: 'registration.disableCell',
  input: z.object({ eventId: z.uuid(), registrationTypeId: z.uuid(), admissionItemId: z.uuid() }),
  output: z.object({ disabled: z.boolean() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const type = await liveTypeTx(tx, input.eventId, input.registrationTypeId, true);
    const cells = await tx
      .select()
      .from(typeItems)
      .where(
        and(
          eq(typeItems.registrationTypeId, type.id),
          eq(typeItems.admissionItemId, input.admissionItemId),
          isNull(typeItems.archivedAt),
        ),
      );
    if (cells.length === 0) throw new DomainError('not_found', 'This item is not offered to this type');
    await archiveCellsTx(tx, ctx, emit, cells);
    emit({
      type: 'registration.cell.disabled',
      version: 1,
      aggregateType: 'registration_type',
      aggregateId: type.id,
      payload: {
        orgId: type.orgId,
        eventId: type.eventId,
        registrationTypeId: type.id,
        admissionItemId: input.admissionItemId,
      },
    });
    return { disabled: true };
  },
  audit: (input) => ({
    action: 'registration.cell.disable',
    targetType: 'registration_type',
    targetId: input.registrationTypeId,
    data: { admissionItemId: input.admissionItemId },
  }),
});

const Names = z.record(z.string().max(40), Name).default({});

/**
 * Add the standard types (Member, Non-member, Student, Exhibitor, Speaker, VIP) and items (full
 * pass, day pass, workshop add-on, dinner) that the event does not have yet (by key). Names come
 * in the organizer's language from the page; everything stays editable.
 */
export const seedRegistrationDefaultsCommand = tenantCommand({
  name: 'registration.seedDefaults',
  input: z.object({ eventId: z.uuid(), names: Names }),
  output: z.object({ types: z.int(), items: z.int() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventForSetupTx(tx, input.eventId, true);
    await ensureEventAddonTx(tx, ctx, input.eventId, PACK);
    const name = (key: string) => input.names[key] ?? DEFAULT_NAMES[key] ?? key;
    const typeKeys = await takenKeysTx(tx, registrationTypes, input.eventId);
    const itemKeys = await takenKeysTx(tx, admissionItems, input.eventId);
    let types = 0;
    let items = 0;
    for (const [i, key] of DEFAULT_TYPE_KEYS.entries()) {
      if (typeKeys.has(key)) continue;
      await insertTypeTx(tx, ctx, emit, input.eventId, {
        key,
        name: name(key),
        description: null,
        sortOrder: (i + 1) * 10,
        capacity: null,
        eligibility: 'open',
        accessCode: null,
        emailDomains: [],
      });
      types += 1;
    }
    for (const [i, it] of DEFAULT_ITEMS.entries()) {
      if (itemKeys.has(it.key)) continue;
      await insertItemTx(tx, ctx, emit, input.eventId, {
        key: it.key,
        name: name(it.key),
        description: null,
        kind: it.kind,
        sortOrder: (i + 1) * 10,
      });
      items += 1;
    }
    return { types, items };
  },
  audit: (input, r) => ({
    action: 'registration.seed_defaults',
    targetType: 'event',
    targetId: input.eventId,
    data: r,
  }),
});
