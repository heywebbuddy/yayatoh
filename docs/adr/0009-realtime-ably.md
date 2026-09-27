# ADR 0009 — Realtime via Ably behind `RealtimePublisher`, SSE fallback

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §6.4)

## Context
- Live features need push updates: seat availability, scans, Command Center tiles, the user inbox and device commands.
- Serverless hosts cannot hold many long-lived sockets.
- Realtime is derived data; Postgres stays the system of record.

## Decision
- Path: outbox relay → worker realtime publisher → **Ably**, behind a `RealtimePublisher` port.
- **Channels:**
  - `org:{o}:event:{e}:ops|scans|seats`
  - `org:{o}:user:{u}:inbox`
  - `device:{d}`
  - `public:event:{e}:seats` (subscribe-only)
- **Tokens** are minted from `Ctx`, scoped, and last 1 hour.
- Counters are aggregated every 2–3 s. Checked-in counts use two inline sharded counters (16 slots).
- **SSE fallback** when Ably is unavailable.

## Alternatives
- **Self-hosted Socket.IO on Fly.** Runner-up.

## Consequences
- Cost: Ably Standard $29 plus usage.
- Ably capability tests are part of the isolation suite; a token never grants another org's channels.
- Live Command Center tiles target ≤3 s p95.
- Online scanners receive realtime scan pushes for cross-device duplicates.

## Revisit when
- Ably cost or limits exceed budget at scale.
