// Test-only access to platform tables (check-modules: only tests may import ./testing).
export { auditEvents, domainEvents, idempotencyKeys, processedEvents, rateLimits } from './schema.ts';
