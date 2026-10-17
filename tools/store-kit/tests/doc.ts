// biome-ignore lint/suspicious/noExplicitAny: the tests poke at JSON files of many shapes.
export type Doc = Record<string, any>;
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
