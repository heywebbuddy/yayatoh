import { screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SignedInOnly } from '../src/tickets/signed-in';
import { setup } from './helpers/app';
import { redirects, resetRouter } from './helpers/router-mock';

jest.mock('expo-router', () => require('./helpers/router-mock').routerMock);

const apps: ReturnType<typeof setup>[] = [];
beforeEach(() => resetRouter());
afterEach(() => {
  for (const app of apps.splice(0)) app.core.queryClient.clear();
});

describe('SignedInOnly', () => {
  it('shows the screen to a signed-in person', async () => {
    const app = setup();
    apps.push(app);
    await app.ready;
    app.view(
      <SignedInOnly>
        <Text>ticket</Text>
      </SignedInOnly>,
    );
    expect(await screen.findByText('ticket')).toBeOnTheScreen();
    expect(redirects).toEqual([]);
  });

  it('sends a signed-out person to the welcome flow instead of showing a load error', async () => {
    const app = setup({ signedIn: false });
    apps.push(app);
    await app.ready;
    app.view(
      <SignedInOnly>
        <Text>ticket</Text>
      </SignedInOnly>,
    );
    expect(screen.queryByText('ticket')).toBeNull();
    expect(redirects).toEqual(['/welcome']);
  });

  it('waits, with a loading state, until the session is read', async () => {
    const app = setup();
    apps.push(app);
    app.view(
      <SignedInOnly>
        <Text>ticket</Text>
      </SignedInOnly>,
    );
    expect(screen.getByTestId('session-loading')).toBeOnTheScreen();
    expect(screen.queryByText('ticket')).toBeNull();
    await app.ready;
    expect(await screen.findByText('ticket')).toBeOnTheScreen();
  });
});
