import ar from '../../messages/ar.json';
import de from '../../messages/de.json';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import fr from '../../messages/fr.json';
import hi from '../../messages/hi.json';
import it from '../../messages/it.json';
import ja from '../../messages/ja.json';
import nl from '../../messages/nl.json';
import pt from '../../messages/pt.json';
import ru from '../../messages/ru.json';
import zhCN from '../../messages/zh-CN.json';
import zhTW from '../../messages/zh-TW.json';
import type { AppLocale } from './locales';

export type MessageTree = { [key: string]: string | MessageTree };

/** The strings both apps share, one catalog per locale. Under `core` in an app's messages. */
export const coreCatalogs: Record<AppLocale, MessageTree> = {
  en,
  ar,
  de,
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
};

/** An app's own catalog for `locale` with the shared strings under the `core` namespace. */
export function messagesFor(appCatalogs: Partial<Record<AppLocale, MessageTree>>, locale: AppLocale): MessageTree {
  return { ...(appCatalogs[locale] ?? appCatalogs.en ?? {}), core: coreCatalogs[locale] };
}
