// The coexistence front door (M2.4a, ADR 0020): pure, runtime-agnostic pieces for proxy.ts and the
// staff console. The flag store and counters are in the package root (`frontDoorFlags`, …).
export * from './http.ts';
export * from './routes.ts';
