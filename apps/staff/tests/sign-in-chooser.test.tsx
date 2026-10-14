import { fireEvent, screen } from '@testing-library/react-native';
import SignInChooser from '../src/app/sign-in/index';
import { catalogs } from '../src/i18n';
import { buildApp, missingMessages, renderApp, shownTexts } from './helpers/render';
import { resetRouter, router } from './helpers/router-mock';

jest.mock('expo-router', () => require('./helpers/router-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const en = catalogs.en;
beforeEach(resetRouter);

describe('the staff sign-in chooser', () => {
  it('offers the organizer and the exhibitor sign-in, and a way back to enrolment', async () => {
    await renderApp(<SignInChooser />);
    expect(screen.getByRole('header', { name: en.enrol.signInTitle })).toBeOnTheScreen();
    expect(screen.getByText(en.organizer.about)).toBeOnTheScreen();
    expect(screen.getByText(en.exhibitor.about)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: en.organizer.open }));
    expect(router.push).toHaveBeenCalledWith('/sign-in/organizer');
    fireEvent.press(screen.getByRole('button', { name: en.exhibitor.open }));
    expect(router.push).toHaveBeenCalledWith('/sign-in/exhibitor');
    fireEvent.press(screen.getByRole('button', { name: en.enrol.backToEnrol }));
    expect(router.replace).toHaveBeenCalledWith('/enrol');
    expect(missingMessages(shownTexts())).toEqual([]);
  });

  it('renders in Arabic, right to left', async () => {
    await renderApp(<SignInChooser />, buildApp({ locale: 'ar' }));
    expect(screen.getByTestId('locale-root')).toHaveStyle({ direction: 'rtl' });
    expect(screen.getByRole('button', { name: catalogs.ar.organizer.open })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: catalogs.ar.exhibitor.open })).toBeOnTheScreen();
    expect(missingMessages(shownTexts())).toEqual([]);
  });
});
