// Canary: platform_reader (BYPASSRLS) outside apps/admin and apps/worker must fail.
import { withPlatformReader } from '@yayatoh/db/platform';
export const read = withPlatformReader;
