import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/** Machine-checkable heuristics from the U11 review, measured in the page (no page text is kept). */
export interface PageMetrics {
  readonly overflowX: number;
  readonly nativeControls: number;
  readonly smallTargets: number;
  readonly smallTargetSamples: string[];
  readonly h1: number;
  readonly imgNoAlt: number;
  readonly rawKeys: string[];
  readonly emptyMain: boolean;
  readonly longParagraphs: number;
  readonly fields: number;
  readonly title: string;
  readonly errorShown: boolean;
  readonly hasMainLandmark: boolean;
}

export async function measure(page: Page): Promise<PageMetrics> {
  return page.evaluate(() => {
    const vis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const doc = document.documentElement;
    const overflowX = Math.max(0, doc.scrollWidth - window.innerWidth);
    const nativeControls = Array.from(
      document.querySelectorAll(
        'select, input[type=date], input[type=time], input[type=datetime-local], input[type=month], input[type=week]',
      ),
    ).filter((e) => vis(e) && !(e as HTMLElement).closest('[data-native-ok]')).length;
    const small: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll(
        'button, [role=button], [role=tab], [role=menuitem], input:not([type=hidden]), select, textarea, a[href]',
      ),
    )) {
      if (!vis(el)) continue;
      // Inline links in running text are exempt (WCAG 2.5.8 inline exception).
      if (el.tagName === 'A' && el.closest('p, li, td, dd, figcaption')) continue;
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width < 24 || r.height < 24) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 30);
        small.push(`${el.tagName.toLowerCase()}:${name}:${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    const main = document.querySelector('main') ?? document.body;
    const text = (main as HTMLElement).innerText ?? '';
    const rawKeys = Array.from(
      new Set(text.match(/\b[a-z][a-zA-Z]{2,}(?:\.[a-z][a-zA-Z0-9_]{2,}){2,}\b/g) ?? []),
    )
      .filter((k) => !/\.(?:com|test|org|net|io|events|localhost)\b/.test(k))
      .slice(0, 5);
    const longParagraphs = Array.from(main.querySelectorAll('p')).filter(
      (p) => vis(p) && (p.textContent ?? '').trim().split(/\s+/).length > 45,
    ).length;
    const errorShown =
      /\b(?:something went wrong|application error|MISSING_MESSAGE|internal server error)\b/i.test(
        document.body.innerText,
      );
    return {
      overflowX,
      nativeControls,
      smallTargets: small.length,
      smallTargetSamples: small.slice(0, 6),
      h1: document.querySelectorAll('h1').length,
      imgNoAlt: Array.from(document.images).filter((i) => !i.hasAttribute('alt') && vis(i)).length,
      rawKeys,
      emptyMain: text.trim().length < 20,
      longParagraphs,
      fields: Array.from(
        main.querySelectorAll(
          'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea',
        ),
      ).filter(vis).length,
      title: document.title,
      errorShown,
      hasMainLandmark: Boolean(document.querySelector('main')),
    };
  });
}

export interface AxeSummary {
  readonly id: string;
  readonly impact: string | null | undefined;
  readonly nodes: number;
  readonly sample: string;
}

export async function axeSerious(page: Page): Promise<AxeSummary[]> {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('iframe[sandbox=""]')
    .analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      sample: v.nodes[0]?.target.join(' ') ?? '',
    }));
}
