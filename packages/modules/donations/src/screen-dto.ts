import { defineRealtimeChannel } from '@yayatoh/platform';
import { z } from 'zod';
import { SCREEN_THANKS_MAX } from './domain/screen.ts';

/**
 * Allowlisted shapes of the live giving screen (M4.8d). The screen is shown to a whole room, so it
 * carries totals, the level being called and the names of donors who asked to be thanked on screen
 * (P4-13). Never an email, a per-gift amount, a paddle holder or a pledge's donor.
 */
export const ScreenStateDto = z.object({
  /** The campaign the thermometer follows (null until the host sets the screen up). */
  campaign: z.object({ name: z.string(), goalMinor: z.int(), currency: z.string() }).nullable(),
  /** Paid gifts of the campaign (without the fee cover) plus the paddles counted at its levels. */
  totalMinor: z.int().min(0),
  /** Paid gifts plus counted paddles. */
  gifts: z.int().min(0),
  /** The level the auctioneer is calling now, and how many paddles went up at it. */
  calling: z
    .object({ levelName: z.string(), amountMinor: z.int(), currency: z.string(), paddles: z.int().min(0) })
    .nullable(),
  /** Donors who asked to be thanked by name, newest first, as they chose to appear. */
  thanks: z.array(z.string()).max(SCREEN_THANKS_MAX),
});
export type ScreenStateDto = z.infer<typeof ScreenStateDto>;

export const EMPTY_SCREEN: ScreenStateDto = { campaign: null, totalMinor: 0, gifts: 0, calling: null, thanks: [] };

export const SaveScreenInput = z.object({
  eventId: z.uuid(),
  campaignId: z.uuid(),
  /** Thank donors by name (only those who asked for it); off shows totals only. */
  showNames: z.boolean(),
});

/** The host's screen settings (the console signs the link from `version`). */
export const ScreenSettingsDto = z.object({
  screen: z
    .object({
      campaignId: z.uuid(),
      showNames: z.boolean(),
      version: z.int().min(1),
      updatedAt: z.date(),
    })
    .nullable(),
  campaigns: z.array(z.object({ id: z.uuid(), name: z.string(), status: z.string() })),
  eventSlug: z.string(),
  state: ScreenStateDto,
});
export type ScreenSettingsDto = z.infer<typeof ScreenSettingsDto>;

/**
 * The screen's channel. Members with `orders:read` may follow it (the console's preview); the
 * projector follows it through its own stream URL, which checks the signed screen link instead.
 * `link` tells open screens the link was replaced, so a screen on an old link stops.
 */
export const GIVING_SCREEN_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'giving-screen',
  source: 'log',
  description: 'The live giving screen of an event: thermometer, level being called, thanks',
  entitlement: 'donations',
  access: { permission: 'orders:read' },
  snapshot: ScreenStateDto,
  events: { state: ScreenStateDto, link: z.object({ version: z.int().min(1) }) },
});
