import { dark, light } from '@yayatoh/ui/tokens';
import { createFeedback } from '../../src/scan/feedback';
import { contrast, toneColors } from '../../src/scan/ui/tone-colors';
import { ALL_VERDICTS, type SoundId, viewFor } from '../../src/scan/verdicts';

describe('how each verdict looks, sounds and feels', () => {
  it('gives every verdict a tone, a sound and a haptic', () => {
    expect(ALL_VERDICTS.length).toBeGreaterThanOrEqual(21);
    for (const id of ALL_VERDICTS) {
      const v = viewFor(id);
      expect(['admit', 'warn', 'stop']).toContain(v.tone);
      expect(v.sound).toBeTruthy();
      expect(v.haptic).toBeTruthy();
    }
  });

  it('admits are green, repeats and flagged passes are amber, refusals are red', () => {
    for (const id of ['admit', 'granted', 'entered', 'scanned_out'] as const)
      expect(viewFor(id).tone).toBe('admit');
    for (const id of ['duplicate', 'provisional', 'duplicate_offline'] as const)
      expect(viewFor(id).tone).toBe('warn');
    for (const id of [
      'invalid',
      'void',
      'superseded',
      'wrong_checkpoint',
      'wrong_event',
      'outside_window',
    ] as const)
      expect(viewFor(id).tone).toBe('stop');
  });

  it('gives admit, a flagged pass, a repeat and a refusal four different sounds', () => {
    const sounds = (['admit', 'provisional', 'duplicate', 'invalid'] as const).map((id) => viewFor(id).sound);
    expect(new Set(sounds).size).toBe(4);
    const haptics = (['admit', 'provisional', 'duplicate', 'invalid'] as const).map(
      (id) => viewFor(id).haptic,
    );
    expect(new Set(haptics).size).toBe(4);
  });

  it('shows an unknown future result as a refusal rather than nothing', () => {
    const v = viewFor('something_new' as never);
    expect(v.tone).toBe('stop');
    expect(v.key).toBe('invalid');
  });
});

describe('tone colours', () => {
  for (const [mode, palette] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const tone of ['admit', 'warn', 'stop'] as const) {
      it(`keeps the text on the ${tone} panel readable in ${mode} mode`, () => {
        const { fill, text } = toneColors(tone, palette);
        expect(contrast(fill, text)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('feedback', () => {
  it('plays the verdict’s sound and haptic', () => {
    const sound = jest.fn();
    const haptic = jest.fn();
    createFeedback({ sound, haptic }).play(viewFor('duplicate'));
    expect(sound).toHaveBeenCalledWith('duplicate' satisfies SoundId);
    expect(haptic).toHaveBeenCalledWith('duplicate');
  });

  it('never throws when the phone cannot play or vibrate', async () => {
    const feedback = createFeedback({
      sound: () => {
        throw new Error('no audio');
      },
      haptic: async () => {
        throw new Error('no motor');
      },
    });
    expect(() => feedback.play(viewFor('admit'))).not.toThrow();
    await Promise.resolve();
  });
});
