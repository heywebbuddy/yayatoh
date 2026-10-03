import { columnPrivacy, internal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `command_center` schema (roadmap §9 canary leak test; see `columnPrivacy`
 * in @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('command_center', {
  // Widget keys from the registry (validated on write) and the event mode: closed sets.
  layouts: { widget_order: 'vocab', hidden_widgets: 'vocab' },
  mode_overrides: { mode: 'vocab' },
  // M3.3a TV mode: the staff-chosen screen name, and the hash of the link's token.
  display_links: {
    label: internal(),
    token_hash: secret('none', {
      why: 'CHECK requires a 64-char hex SHA-256; only resolveDisplayLink compares it (live-mode.int.test)',
    }),
  },
});
