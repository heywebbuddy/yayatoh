import { screen } from '@testing-library/react-native';
import type { AppLocale } from '@yayatoh/mobile-core';
import { catalogs } from '../../src/i18n';
import type { ScanOutcome } from '../../src/scan/types';
import { VerdictPanel } from '../../src/scan/ui/verdict-panel';
import { ALL_VERDICTS, viewFor } from '../../src/scan/verdicts';
import { renderIn } from './ui-helpers';

const outcome = (verdict: ScanOutcome['verdict'], over: Partial<ScanOutcome> = {}): ScanOutcome => ({
  scanId: 's1',
  verdict,
  ticketId: 't1',
  holderName: 'Ada Lovelace',
  typeName: 'VIP',
  firstAdmission: null,
  elapsedMs: 3,
  ...over,
});

const GLYPH = { admit: '✓', warn: '!', stop: '✕' } as const;

describe.each(['en', 'ar'] as AppLocale[])('every verdict in %s', (locale) => {
  const scan = catalogs[locale as 'en' | 'ar'].scan;
  for (const id of ALL_VERDICTS) {
    it(`${id}: words, glyph and a spoken label`, () => {
      const v = viewFor(id);
      renderIn(<VerdictPanel outcome={outcome(id)} timezone="America/Chicago" />, locale);
      const title = (scan.verdict as Record<string, { title: string }>)[v.key]?.title as string;
      expect(screen.getByTestId('verdict-title')).toHaveTextContent(title);
      expect(screen.getByTestId(`verdict-glyph-${v.tone}`)).toHaveTextContent(GLYPH[v.tone]);
      const panel = screen.getByTestId('verdict-panel');
      expect(panel.props.accessibilityLabel).toContain(title);
      expect(panel.props.accessibilityLabel).toContain('Ada Lovelace');
      expect(panel.props.accessibilityRole).toBe('alert');
      expect(panel.props.accessibilityLiveRegion).toBe('assertive');
      expect(screen.getByTestId('verdict-title')).toHaveStyle({ textAlign: 'auto' });
    });
  }
});

describe('the verdict panel', () => {
  it('shows a hint for the verdicts that need one', () => {
    renderIn(<VerdictPanel outcome={outcome('wrong_checkpoint')} timezone={null} />);
    expect(screen.getByText(catalogs.en.scan.verdict.wrong_checkpoint.hint)).toBeOnTheScreen();
  });

  it('says a repeat was already scanned when it does not know where or when', () => {
    renderIn(<VerdictPanel outcome={outcome('duplicate')} timezone={null} />);
    expect(screen.getByText(catalogs.en.scan.verdict.duplicate.hint)).toBeOnTheScreen();
  });

  it('says when, without a place, for an admission with no checkpoint', () => {
    renderIn(
      <VerdictPanel
        outcome={outcome('duplicate', { firstAdmission: { at: '2027-12-01T20:00:00Z', checkpointName: null } })}
        timezone="America/Chicago"
      />,
    );
    expect(screen.getByText('First admitted at 2:00 PM.')).toBeOnTheScreen();
  });

  it('uses the event’s time zone, not the phone’s', () => {
    renderIn(
      <VerdictPanel
        outcome={outcome('duplicate', { firstAdmission: { at: '2027-12-01T20:00:00Z', checkpointName: 'Hall' } })}
        timezone="Asia/Tokyo"
      />,
    );
    expect(screen.getByText('First admitted at 5:00 AM at Hall.')).toBeOnTheScreen();
  });

  it('is readable without a holder (an unknown or provisional pass)', () => {
    renderIn(<VerdictPanel outcome={outcome('provisional', { holderName: null, typeName: null })} timezone={null} />);
    expect(screen.getByTestId('verdict-panel').props.accessibilityLabel).toContain(
      catalogs.en.scan.verdict.provisional.title,
    );
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  it('shows the ready state before the first scan', () => {
    renderIn(<VerdictPanel outcome={null} timezone={null} />);
    expect(screen.getByText(catalogs.en.scan.ready)).toBeOnTheScreen();
  });

  it('makes the headline at least 36 points, for reading at arm’s length', () => {
    renderIn(<VerdictPanel outcome={outcome('admit')} timezone={null} />);
    const style = screen.getByTestId('verdict-title').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.flat(2).filter(Boolean)) : style;
    expect(flat.fontSize).toBeGreaterThanOrEqual(36);
  });
});
