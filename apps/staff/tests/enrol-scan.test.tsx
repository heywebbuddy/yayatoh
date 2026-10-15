import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import ScanScreen from '../src/app/enrol/scan';
import { catalogs } from '../src/i18n';
import { camera, resetCamera } from './helpers/camera-mock';
import { EVENT_ID, enrolLink, OTHER_TOKEN, TOKEN } from './helpers/fake-door';
import { buildApp, missingMessages, renderApp, settle, shownTexts } from './helpers/render';
import { resetRouter, router } from './helpers/router-mock';

jest.mock('expo-router', () => require('./helpers/router-mock'));
jest.mock('expo-camera', () => require('./helpers/camera-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const en = catalogs.en;
const scanner = en.enrol.scanner;

beforeEach(() => {
  resetRouter();
  resetCamera();
});

const scan = async (data: string) => {
  await act(async () => {
    camera.onBarcodeScanned?.({ data });
  });
  await settle();
  await settle();
};

describe('scanning the enrolment QR code', () => {
  it('shows the camera for QR codes only, with a label and a way to type the link instead', async () => {
    await renderApp(<ScanScreen />);
    expect(screen.getByRole('header', { name: scanner.title })).toBeOnTheScreen();
    expect(screen.getByTestId('camera-view')).toBeOnTheScreen();
    expect(camera.props?.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
    expect(screen.getByLabelText(scanner.preview)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('scan-use-link'));
    expect(router.back).toHaveBeenCalled();
    expect(missingMessages(shownTexts())).toEqual([]);
  });

  it('enrols from the scanned link and leaves for the gate, never putting the key in a URL', async () => {
    const { app } = await renderApp(<ScanScreen />);
    await scan(enrolLink());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(app.device.state).toMatchObject({ status: 'enrolled', eventId: EVENT_ID, token: TOKEN });
    for (const call of app.door.calls) expect(call.url).not.toContain(TOKEN);
  });

  it('ignores a QR code that is not an enrolment code, and says so', async () => {
    const { app } = await renderApp(<ScanScreen />);
    await scan('https://example.org/menu');
    expect(screen.getByTestId('scan-not-enrolment')).toHaveTextContent(scanner.invalid);
    expect(app.door.calls).toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('treats the same code seen again and again as one scan', async () => {
    const { app } = await renderApp(<ScanScreen />);
    await scan('hello');
    await scan('hello');
    await scan('hello');
    expect(app.door.calls).toHaveLength(0);
    expect(screen.getAllByTestId('scan-not-enrolment')).toHaveLength(1);
  });

  it('enrols once when the camera reports two good codes together', async () => {
    const { app } = await renderApp(<ScanScreen />);
    app.door.valid.add(OTHER_TOKEN);
    await act(async () => {
      camera.onBarcodeScanned?.({ data: enrolLink() });
      camera.onBarcodeScanned?.({ data: enrolLink(OTHER_TOKEN) });
    });
    await settle();
    await settle();
    expect(app.device.state.token).toBe(TOKEN);
    expect(app.door.calls.filter((c) => c.url.endsWith('/overview'))).toHaveLength(1);
  });

  it('shows why a refused code failed, and lets the next scan try again', async () => {
    const { app } = await renderApp(<ScanScreen />);
    await scan(enrolLink(OTHER_TOKEN));
    expect(screen.getByTestId('scan-error')).toHaveTextContent(en.enrol.errors.rejected);
    expect(router.replace).not.toHaveBeenCalled();
    await scan(enrolLink());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(app.device.state.status).toBe('enrolled');
  });

  it('says so when there is no connection', async () => {
    const app = buildApp();
    app.door.failNetwork = true;
    await renderApp(<ScanScreen />, app);
    await scan(enrolLink());
    expect(screen.getByTestId('scan-error')).toHaveTextContent(en.enrol.errors.unavailable);
  });
});

describe('the camera permission', () => {
  it('waits while it is checked', async () => {
    camera.permission = null;
    await renderApp(<ScanScreen />);
    expect(screen.getByText(scanner.checking)).toBeOnTheScreen();
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('asks again when the system still allows it', async () => {
    camera.permission = { granted: false, canAskAgain: true };
    await renderApp(<ScanScreen />);
    expect(screen.getByRole('header', { name: scanner.permission.title })).toBeOnTheScreen();
    expect(screen.queryByTestId('camera-view')).toBeNull();
    fireEvent.press(screen.getByTestId('scan-allow-camera'));
    expect(camera.request).toHaveBeenCalled();
  });

  it('explains how to allow it when it was denied for good, and opens the settings', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    camera.permission = { granted: false, canAskAgain: false };
    await renderApp(<ScanScreen />);
    expect(screen.getByText(scanner.permission.settingsHint)).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('scan-open-settings'));
    expect(open).toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('scan-use-link'));
    expect(router.back).toHaveBeenCalled();
    open.mockRestore();
  });

  it('every denied-permission control has a role and a label', async () => {
    camera.permission = { granted: false, canAskAgain: false };
    await renderApp(<ScanScreen />);
    for (const b of screen.getAllByRole('button')) expect(b.props.accessibilityLabel).toBeTruthy();
  });
});

describe('right to left', () => {
  it('renders the camera screen in Arabic', async () => {
    await renderApp(<ScanScreen />, buildApp({ locale: 'ar' }));
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expect(screen.getByRole('header', { name: catalogs.ar.enrol.scanner.title })).toBeOnTheScreen();
    expect(screen.getByLabelText(catalogs.ar.enrol.scanner.preview)).toBeOnTheScreen();
  });

  it('renders the denied-permission screen in Arabic', async () => {
    camera.permission = { granted: false, canAskAgain: false };
    await renderApp(<ScanScreen />, buildApp({ locale: 'ar' }));
    expect(screen.getByText(catalogs.ar.enrol.scanner.permission.settingsHint)).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: catalogs.ar.enrol.scanner.permission.settings }),
    ).toBeOnTheScreen();
  });
});
