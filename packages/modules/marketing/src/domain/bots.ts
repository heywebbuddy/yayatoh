/**
 * Bot filtering for the redirector (M3.8a). Link-preview fetchers, crawlers, headless browsers
 * and HTTP libraries still get the redirect (previews keep working) but never a click row or a
 * click id. A missing or implausibly short user agent counts as a bot.
 */
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|whatsapp|telegram|skype|slack|discord|linkedin|pinterest|vkshare|quora link|outbrain|mediapartners|adsbot|lighthouse|pagespeed|headlesschrome|phantomjs|puppeteer|playwright|python-|python\/|curl\/|wget\/|httpie|go-http-client|java\/|okhttp|axios\/|node-fetch|undici|libwww|scrapy|feedfetcher|monitor|uptime|pingdom|statuscake/i;

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim();
  if (ua.length < 12) return true;
  return BOT_UA.test(ua);
}
