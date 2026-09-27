/** Message key for an API key scope (`events:read` → `apiKeys.scope.events_read`). */
export const scopeKey = (s: string) => `apiKeys.scope.${s.replace(':', '_')}` as const;
