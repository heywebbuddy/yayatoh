import { render, screen } from '@testing-library/react-native';
import { dark, light } from '@yayatoh/ui/tokens';
import { IntlProvider } from 'use-intl';
import Home from '../src/app/index';
import { type AppLocale, catalogs } from '../src/i18n';

const mockScheme = jest.fn<'light' | 'dark', []>();
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme(),
}));

function renderHome(locale: AppLocale = 'en') {
  return render(
    <IntlProvider locale={locale} messages={catalogs[locale]}>
      <Home />
    </IntlProvider>,
  );
}

beforeEach(() => mockScheme.mockReturnValue('light'));

describe('Yayatoh home screen (placeholder)', () => {
  it('shows the translated title and tagline', () => {
    renderHome();
    expect(screen.getByRole('header', { name: 'Yayatoh Staff' })).toBeOnTheScreen();
    expect(screen.getByText(catalogs.en.home.tagline)).toBeOnTheScreen();
  });

  it('renders every locale from its own catalog, Arabic included', () => {
    renderHome('ar');
    expect(screen.getByText(catalogs.ar.home.tagline)).toBeOnTheScreen();
    // The tagline is not the English one, and text alignment follows the language (right to left).
    expect(catalogs.ar.home.tagline).not.toBe(catalogs.en.home.tagline);
    expect(screen.getByText(catalogs.ar.home.tagline)).toHaveStyle({ textAlign: 'auto' });
    expect(screen.getByRole('header', { name: 'Yayatoh Staff' })).toHaveStyle({ textAlign: 'auto' });
  });

  it('takes its colours from the design tokens in light mode', () => {
    renderHome();
    expect(screen.getByTestId('home-card')).toHaveStyle({ backgroundColor: light.surfaceSolid });
    expect(screen.getByText(catalogs.en.home.tagline)).toHaveStyle({ color: light.ink2 });
  });

  it('takes its colours from the design tokens in dark mode', () => {
    mockScheme.mockReturnValue('dark');
    renderHome();
    expect(screen.getByTestId('home-card')).toHaveStyle({ backgroundColor: dark.surfaceSolid });
    expect(screen.getByText(catalogs.en.home.tagline)).toHaveStyle({ color: dark.ink2 });
  });
});
