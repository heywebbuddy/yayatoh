/**
 * The app's own strings: one catalog per locale in `messages/<locale>.json`. Picking the language
 * (the phone's, or the person's choice), right-to-left and the strings both apps share are in
 * `@yayatoh/mobile-core` (M7.1c); `LocaleProvider` adds the shared strings under `core`.
 */
import ar from '../messages/ar.json';
import de from '../messages/de.json';
import en from '../messages/en.json';
import es from '../messages/es.json';
import fr from '../messages/fr.json';
import hi from '../messages/hi.json';
import it from '../messages/it.json';
import ja from '../messages/ja.json';
import nl from '../messages/nl.json';
import pt from '../messages/pt.json';
import ru from '../messages/ru.json';
import zhCN from '../messages/zh-CN.json';
import zhTW from '../messages/zh-TW.json';

export const catalogs = {
  ar,
  de,
  en,
  es,
  fr,
  hi,
  it,
  ja,
  nl,
  pt,
  ru,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
} as const;
