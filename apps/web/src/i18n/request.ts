import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing.ts';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages = (await import(`../../messages/${locale}.json`)).default;
  const attendeeDashboard =
    messages.attendeeDashboard ?? (await import('../../messages/en.json')).default.attendeeDashboard;
  return {
    locale,
    messages: { ...messages, attendeeDashboard },
  };
});
