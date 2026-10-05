'use client';

import { Menu } from '@yayatoh/ui';
import type { ThemeChoice } from '@yayatoh/ui/tokens';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { setThemeAction } from '@/server/theme-actions.ts';

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/** Light / Dark / System for the staff console (ADR 0022): applied at once, then remembered. */
export function ThemeSwitch({ initial }: { initial: ThemeChoice }) {
  const t = useTranslations('theme');
  const [theme, setTheme] = useState<ThemeChoice>(initial);
  const [, start] = useTransition();
  const Current = ICON[theme];
  return (
    <Menu
      label={`${t('label')}: ${t(theme)}`}
      testId="theme-switch"
      radio
      align="start"
      trigger={<Current aria-hidden="true" strokeWidth={2} />}
      triggerClassName="flex size-9 items-center justify-center rounded-[12px] text-side-ink hover:bg-side-hover hover:text-side-strong [&_svg]:size-[18px]"
      items={(['light', 'dark', 'system'] as const).map((k) => {
        const I = ICON[k];
        return {
          key: k,
          label: t(k),
          icon: <I aria-hidden="true" strokeWidth={2} />,
          checked: theme === k,
          onSelect: () => {
            setTheme(k);
            document.documentElement.dataset.theme = k;
            start(async () => {
              await setThemeAction(k);
            });
          },
        };
      })}
    />
  );
}
