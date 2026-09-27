import { pgRole } from 'drizzle-orm/pg-core';

/** Database roles (roadmap §4.3). Created by `pnpm db:bootstrap`, never by migrations. */
export const ROLE = {
  /** Runtime role: NOBYPASSRLS, owns nothing. Every query runs through withTenant(). */
  appUser: 'app_user',
  /** Schema owner. Runs migrations on a direct (unpooled) connection. */
  migrator: 'migrator',
  /** BYPASSRLS, read-only. apps/admin and apps/worker only; every use is audited. */
  platformReader: 'platform_reader',
} as const;

export const appUserRole = pgRole(ROLE.appUser).existing();
