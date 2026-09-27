// Canary: a raw database client outside packages/db must fail.
import postgres from 'postgres';
export const sql = postgres('postgres://localhost/x');
