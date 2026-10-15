import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPS, loadStore, REPO_ROOT } from '../src/app.ts';
import { placeholdersIn } from '../src/listing.ts';
import type { Doc } from './doc.ts';

/**
 * The runbook is reviewed step by step against `eas.json` and the scripts (M7.5a acceptance): every
 * command it prints must name a profile, channel, script, flag value or file that exists.
 */
const runbookPath = join(REPO_ROOT, 'docs/runbooks/mobile-release.md');
const runbook = readFileSync(runbookPath, 'utf8');
const json = (p: string): Doc => JSON.parse(readFileSync(join(REPO_ROOT, p), 'utf8'));

/** Every command line in the fenced blocks, with `$APP` expanded for each app. */
function commands(): { app: string; line: string }[] {
  const out: { app: string; line: string }[] = [];
  const fence = /```(?:bash|text)?\n([\s\S]*?)```/g;
  for (const m of runbook.matchAll(fence)) {
    const lines = (m[1] ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('cd '));
    for (const line of lines) for (const app of APPS) out.push({ app, line: line.replaceAll('$APP', app) });
  }
  return out;
}

describe('docs/runbooks/mobile-release.md', () => {
  const all = commands();

  it('has commands to check', () => {
    expect(all.length).toBeGreaterThan(30);
    expect(runbook).toMatch(/## 1\. First submission/);
    expect(runbook).toMatch(/## 3\. Over-the-air/);
    expect(runbook).toMatch(/## 4\. The 72-hour event freeze/);
    expect(runbook).toMatch(/## 5\. Minimum versions/);
    expect(runbook).toMatch(/## 6\. Rollback/);
  });

  it('names only eas profiles that exist, for the platform it asks for', () => {
    for (const { app, line } of all.filter((c) => /^eas (build|submit|metadata)/.test(c.line))) {
      const eas = json(`apps/${app}/eas.json`);
      const profile = /--profile (\S+)/.exec(line)?.[1];
      expect(profile, line).toBeDefined();
      if (/^eas build/.test(line)) expect(eas.build[profile as string], line).toBeDefined();
      else {
        const sub = eas.submit[profile as string];
        expect(sub, line).toBeDefined();
        const platform = /--platform (\w+)/.exec(line)?.[1];
        if (platform === 'ios' || /^eas metadata/.test(line)) expect(sub.ios, line).toBeDefined();
        if (platform === 'android') expect(sub.android, line).toBeDefined();
        if (/^eas metadata/.test(line)) expect(sub.ios.metadataPath, line).toBeDefined();
      }
    }
  });

  it('publishes updates only to channels and environments that exist', () => {
    for (const { app, line } of all.filter((c) => /^eas update/.test(c.line))) {
      const eas = json(`apps/${app}/eas.json`);
      const channel = /--channel (\S+)/.exec(line)?.[1];
      expect(
        Object.values(eas.build).map((b) => (b as Doc).channel),
        line,
      ).toContain(channel);
      const environment = /--environment (\S+)/.exec(line)?.[1];
      if (environment) expect(eas.build[environment]?.environment, line).toBe(environment);
    }
  });

  it('runs only package scripts that exist', () => {
    const rootScripts = json('package.json').scripts as Record<string, string>;
    for (const { app, line } of all.filter((c) => c.line.startsWith('pnpm '))) {
      const filtered = /^pnpm --filter @yayatoh\/(\w+) (\S+)/.exec(line);
      if (filtered) {
        const scripts = json(`apps/${filtered[1]}/package.json`).scripts as Record<string, string>;
        expect(scripts[filtered[2] as string], line).toBeDefined();
      } else {
        const script = /^pnpm (\S+)/.exec(line)?.[1] as string;
        expect(rootScripts[script], `${line} (${app})`).toBeDefined();
      }
    }
  });

  it('calls the store kit with commands it has, and the capture script with devices and themes in the plan', () => {
    for (const { app, line } of all) {
      const kit = /^node tools\/store-kit\/cli\.ts (\w+) --app (\w+)/.exec(line);
      if (kit) {
        expect(
          ['privacy', 'listing', 'compliance', 'screenshots', 'shots', 'check', 'render'],
          line,
        ).toContain(kit[1]);
        expect(kit[2]).toBe(app);
      }
      const capture = /^apps\/(\w+)\/store\/capture\.sh --device (\S+) --theme (\w+)/.exec(line);
      if (capture) {
        const plan = loadStore(capture[1] as 'mobile' | 'staff').screenshots;
        expect(
          plan.devices.map((d) => d.id),
          line,
        ).toContain(capture[2]);
        expect(plan.themes, line).toContain(capture[3]);
      }
    }
  });

  it('points only at files that exist (generated folders aside)', () => {
    const generated = /store\/(dist|screenshots)\b|<platform>/;
    const paths = new Set<string>();
    for (const m of runbook.matchAll(/`((?:apps|docs|tools|packages)\/[^`\s]+?)`/g))
      paths.add(m[1] as string);
    expect(paths.size).toBeGreaterThan(15);
    for (const p of paths) {
      if (generated.test(p) || /[<…*]/.test(p)) continue;
      for (const expanded of p.includes('$APP') ? APPS.map((a) => p.replaceAll('$APP', a)) : [p]) {
        const clean = expanded.replace(/[.,;:]+$/, '').replace(/\/$/, '');
        expect(existsSync(join(REPO_ROOT, clean)), clean).toBe(true);
      }
    }
  });

  it('links only to runbooks that exist', () => {
    for (const m of runbook.matchAll(/\]\(([^)#]+\.md)\)/g)) {
      expect(existsSync(join(dirname(runbookPath), m[1] as string)), m[1]).toBe(true);
    }
  });

  it('uses only environment names the apps document', () => {
    const named = new Set(
      runbook.match(/\b(?:STORE|REVIEW|REVIEWER|IOS|ANDROID|GOOGLE|EAS|SENTRY)_[A-Z_]{2,}\b/g) ?? [],
    );
    for (const name of named) {
      const documented = APPS.some((app) => {
        const example = readFileSync(join(REPO_ROOT, 'apps', app, '.env.example'), 'utf8');
        return new RegExp(`^#? ?${name}=`, 'm').test(example);
      });
      const inRoot = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8').includes(`${name}=`);
      const inStore = APPS.some((app) => {
        const s = loadStore(app);
        return placeholdersIn(s.apple, s.play, s.compliance).includes(name);
      });
      expect(documented || inRoot || inStore, name).toBe(true);
    }
  });

  it("covers the owner's first-submission checklist, the freeze, minimum versions and rollback in the plan's terms", () => {
    for (const phrase of [
      'phased release',
      'staged rollout',
      '72 hours',
      '426 Upgrade Required',
      'never raise the minimum for Staff',
      '3.1.3(e)',
      'ITSAppUsesNonExemptEncryption',
      'fingerprint',
      'Halt rollout',
      'Pause phased release',
    ])
      expect(runbook.toLowerCase(), phrase).toContain(phrase.toLowerCase());
  });
});
