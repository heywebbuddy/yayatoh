import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '@yayatoh/mobile-core';
import { dark, light } from '@yayatoh/ui/tokens';
import { Body, Button, COLUMN_WIDTH, Heading, Notice, Screen, TextField } from '../src/ui/kit';

const mockScheme = jest.fn<'light' | 'dark', []>();
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme(),
}));

const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
const styleOf = (node: { props: { style?: unknown } }) =>
  flat(typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style);

function show(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => mockScheme.mockReturnValue('light'));

describe('the screen kit', () => {
  it('keeps content in a readable column on an iPad and uses the full width on a phone', () => {
    show(
      <Screen testID="s">
        <Body>text</Body>
      </Screen>,
    );
    expect(COLUMN_WIDTH).toBe(560);
    expect(screen.getByTestId('s-column')).toHaveStyle({ width: '100%', maxWidth: 560 });
  });

  it('takes its colours from the tokens in light and dark', () => {
    const { unmount } = show(<Button label="Go" onPress={() => {}} />);
    expect(styleOf(screen.getByRole('button')).backgroundColor).toBe(light.primary);
    unmount();
    mockScheme.mockReturnValue('dark');
    show(<Button label="Go" onPress={() => {}} />);
    expect(styleOf(screen.getByRole('button')).backgroundColor).toBe(dark.primary);
  });

  it('buttons are 44 points or taller, labelled, and disabled or busy ones do not fire', () => {
    const onPress = jest.fn();
    show(
      <>
        <Button label="Go" onPress={onPress} testID="a" />
        <Button busy label="Busy" onPress={onPress} testID="b" />
        <Button disabled label="Off" onPress={onPress} testID="c" />
      </>,
    );
    for (const id of ['a', 'b', 'c'])
      expect(styleOf(screen.getByTestId(id)).minHeight).toBeGreaterThanOrEqual(44);
    fireEvent.press(screen.getByTestId('a'));
    fireEvent.press(screen.getByTestId('b'));
    fireEvent.press(screen.getByTestId('c'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it('text fields are labelled, 44 points or taller, and show their error in words', () => {
    show(<TextField error="Required" label="Name" onChangeText={() => {}} testID="f" value="" />);
    const field = screen.getByLabelText('Name');
    expect(styleOf(field).minHeight).toBeGreaterThanOrEqual(44);
    expect(styleOf(field).borderColor).toBe(light.danger);
    expect(screen.getByTestId('f-error')).toHaveTextContent('Required');
  });

  it('uses start-aligned text and never positions with left or right', () => {
    show(
      <>
        <Heading testID="h">Title</Heading>
        <Notice testID="n">Message</Notice>
      </>,
    );
    expect(screen.getByTestId('h')).toHaveStyle({ textAlign: 'auto' });
    const all = JSON.stringify(screen.toJSON());
    expect(all).not.toMatch(/"(?:left|right|marginLeft|marginRight|paddingLeft|paddingRight)"/);
  });

  it('a notice is an alert with its text, so colour is never the only signal', () => {
    show(<Notice tone="danger">Something is wrong</Notice>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something is wrong');
  });
});
