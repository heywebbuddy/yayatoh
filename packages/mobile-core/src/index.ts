/**
 * `@yayatoh/mobile-core` — what the two Expo apps share (ADR 0025).
 *
 * M7.1b ships the package empty on purpose. M7.1c fills it: the `/v1` client with token storage,
 * sign-in helpers, the query cache, the theme, translations, deep links, the version gate and
 * crash reporting. React Native only: the web never imports it, and it never imports a module,
 * the database, `next` or `react-dom` (`pnpm check:modules`).
 *
 * The one thing that exists now is `@yayatoh/mobile-core/app-config`, which runs in Node when
 * Expo reads an app's `app.config.ts`.
 */
export {};
