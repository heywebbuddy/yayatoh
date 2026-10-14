import { act, render, screen } from '@testing-library/react-native';
import { dark, light } from '@yayatoh/ui/tokens';
import { Text } from 'react-native';
import { memoryKeyValueStore } from '../src/ports';
import { contrastRatio, isHexColor, mix, parseHex } from '../src/theme/contrast';
import { BrandScope, type ThemeApi, ThemeProvider, useTheme } from '../src/theme/provider';
import { resolveScheme, resolveTheme, THEME_STORAGE_KEY } from '../src/theme/theme';

const mockScheme = jest.fn<'light' | 'dark' | null, []>();
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme(),
}));
beforeEach(() => mockScheme.mockReturnValue('light'));

describe('contrast', () => {
  it('matches WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
  });
  it('accepts only opaque hex colours', () => {
    for (const ok of ['#fff', '#FFFFFF', ' #0a0a0a ']) expect(isHexColor(ok)).toBe(true);
    for (const bad of ['red', 'rgb(0,0,0)', '#ffff', '#12345', '#gggggg', '', 12, null, undefined])
      expect(isHexColor(bad)).toBe(false);
    expect(parseHex('#abc')).toEqual([170, 187, 204]);
    expect(Number.isNaN(contrastRatio('red', '#fff'))).toBe(true);
  });
  it('mixes toward a colour', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#102030', '#102030', 0.9)).toBe('#102030');
  });
});

describe('resolveScheme', () => {
  it('follows the system unless the person chose', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
  });
});

describe('resolveTheme', () => {
  it('is the token palette in light and dark with no brand', () => {
    expect(resolveTheme('light').colors).toEqual(light);
    expect(resolveTheme('dark').colors).toEqual(dark);
    expect(resolveTheme('light', null).brandApplied).toBe(false);
  });

  it('applies a readable brand colour to the primary roles in light mode', () => {
    const t = resolveTheme('light', '#1d4ed8');
    expect(t.brandApplied).toBe(true);
    expect(t.colors.primary).toBe('#1d4ed8');
    expect(t.colors.primaryInk).toBe('#1d4ed8');
    expect(t.colors.onPrimary).toBe(light.onPrimary);
    expect(contrastRatio(t.colors.onPrimary, t.colors.primary)).toBeGreaterThanOrEqual(4.5);
    // Everything else is untouched.
    expect(t.colors.canvas).toBe(light.canvas);
    expect(t.colors.success).toBe(light.success);
  });

  it.each(['#ffeb3b', '#f5e663', '#ffffff', '#b0b0b0', '#ff69b4', '#fff'])(
    'a brand colour with poor contrast (%s) falls back to the default colours in light mode',
    (brand) => {
      const t = resolveTheme('light', brand);
      expect(t.brandApplied).toBe(false);
      expect(t.colors).toEqual(light);
    },
  );

  it('at exactly the threshold side: just under 4.5 falls back, just over applies', () => {
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
    expect(resolveTheme('light', '#777777').brandApplied).toBe(false);
    expect(contrastRatio('#757575', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(resolveTheme('light', '#757575').brandApplied).toBe(true);
  });

  it('in dark mode a light brand applies with a dark label, a dark brand falls back', () => {
    const light1 = resolveTheme('dark', '#ffd166');
    expect(light1.brandApplied).toBe(true);
    expect(light1.colors.onPrimary).toBe('#000000');
    expect(contrastRatio(light1.colors.onPrimary, light1.colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(resolveTheme('dark', '#1d2a8a')).toMatchObject({ brandApplied: false, colors: dark });
  });

  it.each(['red', 'javascript:alert(1)', 'rgba(0,0,0,0.5)', '#12', '', ' ', 'url(x)'])(
    'ignores a value that is not an opaque hex colour (%j)',
    (value) => {
      expect(resolveTheme('light', value).brandApplied).toBe(false);
    },
  );

  it('trims the colour', () => {
    expect(resolveTheme('light', '  #1d4ed8 ').colors.primary).toBe('#1d4ed8');
  });
});

function Probe({ onTheme }: { onTheme: (t: ThemeApi) => void }) {
  const theme = useTheme();
  onTheme(theme);
  return <Text testID="probe">{`${theme.scheme}:${theme.choice}:${theme.colors.primary}`}</Text>;
}

describe('ThemeProvider', () => {
  it('follows the system mode and updates when it changes', () => {
    const view = render(
      <ThemeProvider>
        <Probe onTheme={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').props.children).toBe(`light:system:${light.primary}`);
    mockScheme.mockReturnValue('dark');
    view.rerender(
      <ThemeProvider>
        <Probe onTheme={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').props.children).toBe(`dark:system:${dark.primary}`);
  });

  it('an in-app override beats the system and is remembered', async () => {
    const store = memoryKeyValueStore();
    let api!: ThemeApi;
    render(
      <ThemeProvider store={store}>
        <Probe onTheme={(t) => (api = t)} />
      </ThemeProvider>,
    );
    act(() => api.setChoice('dark'));
    expect(screen.getByTestId('probe').props.children).toBe(`dark:dark:${dark.primary}`);
    expect(store.data.get(THEME_STORAGE_KEY)).toBe('dark');

    // A fresh launch restores it.
    screen.unmount();
    render(
      <ThemeProvider store={store}>
        <Probe onTheme={() => {}} />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe').props.children).toBe(`dark:dark:${dark.primary}`);
  });

  it('ignores a stored value it does not know', async () => {
    const store = memoryKeyValueStore({ [THEME_STORAGE_KEY]: 'sepia' });
    render(
      <ThemeProvider store={store}>
        <Probe onTheme={() => {}} />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('probe').props.children).toBe(`light:system:${light.primary}`);
  });

  it('BrandScope applies a readable tenant colour to its subtree only, and falls back otherwise', () => {
    render(
      <ThemeProvider>
        <Probe onTheme={() => {}} />
        <BrandScope color="#1d4ed8">
          <Text testID="inside">{null}</Text>
          <InsideProbe id="good" />
        </BrandScope>
        <BrandScope color="#ffeb3b">
          <InsideProbe id="faint" />
        </BrandScope>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').props.children).toBe(`light:system:${light.primary}`);
    expect(screen.getByTestId('good').props.children).toBe('#1d4ed8');
    expect(screen.getByTestId('faint').props.children).toBe(light.primary);
  });

  it('useTheme outside a provider says what is missing', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe onTheme={() => {}} />)).toThrow(/ThemeProvider/);
    spy.mockRestore();
  });
});

function InsideProbe({ id }: { id: string }) {
  return <Text testID={id}>{useTheme().colors.primary}</Text>;
}
