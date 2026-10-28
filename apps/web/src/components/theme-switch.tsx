'use client';

import { cx, iconButtonClass, Menu } from '@yayatoh/ui';
import type { ThemeChoice } from '@yayatoh/ui/tokens';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { setThemeAction } from '@/server/theme-actions.ts';

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Light / Dark / System (ADR 0022). The page switches at once (data-theme on <html>); the choice
 * is then saved in a cookie (read on the server, so the next first paint is right) and, when
 * signed in, in the person's profile.
 */
export function ThemeSwitch({ initial, className }: { initial: ThemeChoice; className?: string }) {
  const t = useTranslations('theme');
  const [theme, setTheme] = useState<ThemeChoice>(initial);
  const [, start] = useTransition();
  const choose = (next: ThemeChoice) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    start(async () => {
      await setThemeAction(next);
    });
  };
  const Current = ICON[theme];
  return (
    <Menu
      label={`${t('label')}: ${t(theme)}`}
      testId="theme-switch"
      radio
      trigger={<Current aria-hidden="true" strokeWidth={2} />}
      triggerClassName={cx(iconButtonClass('secondary', 'md'), className)}
      items={(['light', 'dark', 'system'] as const).map((k) => {
        const I = ICON[k];
        return {
          key: k,
          label: t(k),
          icon: <I aria-hidden="true" strokeWidth={2} />,
          checked: theme === k,
          onSelect: () => choose(k),
        };
      })}
    />
  );
}

/**
 * The same choice as three buttons in a row (for the small-screen menu, where a popover inside a
 * popover is awkward): Light, Dark, System. The current one is pressed.
 */
export function ThemeRadios({ initial }: { initial: ThemeChoice }) {
  const t = useTranslations('theme');
  const [theme, setTheme] = useState<ThemeChoice>(initial);
  const [, start] = useTransition();
  const choose = (next: ThemeChoice) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    start(async () => {
      await setThemeAction(next);
    });
  };
  return (
    <fieldset className="m-0 flex min-w-0 gap-1 border-0 p-1">
      <legend className="sr-only">{t('label')}</legend>
      {(['light', 'dark', 'system'] as const).map((k) => {
        const I = ICON[k];
        return (
          <button
            key={k}
            type="button"
            aria-pressed={theme === k}
            onClick={() => choose(k)}
            className={cx(
              'inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-pill border px-3 text-caption font-bold',
              theme === k
                ? 'border-primary bg-primary-soft text-primary-ink'
                : 'border-line bg-surface text-ink-2',
            )}
          >
            <I aria-hidden="true" className="size-4" strokeWidth={2} />
            {t(k)}
          </button>
        );
      })}
    </fieldset>
  );
}
