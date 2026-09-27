import { getRequestConfig } from 'next-intl/server';

// The staff console is English-only for now (owner inbox: confirm); strings still go through
// next-intl so adding locales is mechanical.
export default getRequestConfig(async () => ({
  locale: 'en',
  messages: (await import('../../messages/en.json')).default,
}));
