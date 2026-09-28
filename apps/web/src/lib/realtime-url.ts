/**
 * The SSE URL of a realtime channel (M3.1b): `/api/realtime/{channel}` serves every host (a
 * tenant host only its own org's channels). Channel names come from the server (`seatChannels`,
 * `realtimeChannelName`), never from user input.
 */
export const realtimeUrl = (channel: string) => `/api/realtime/${encodeURIComponent(channel)}`;
