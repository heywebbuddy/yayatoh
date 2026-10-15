/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: Maestro variables are written as text */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APPS,
  type App,
  checkAll,
  checkApp,
  ciFlows,
  journeyTable,
  type Manifest,
  type Problem,
  REQUIRED_JOURNEYS,
} from '../src/check.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cli = join(repo, 'tools', 'check-maestro', 'cli.ts');

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-maestro-'));
  for (const app of APPS)
    cpSync(join(repo, 'apps', app, '.maestro'), join(root, 'apps', app, '.maestro'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const path = (app: App, file: string) => join(root, 'apps', app, '.maestro', file);
const edit = (app: App, file: string, fn: (text: string) => string) =>
  writeFileSync(path(app, file), fn(readFileSync(path(app, file), 'utf8')));
const manifest = (app: App, fn: (m: Manifest) => void) => {
  const m = JSON.parse(readFileSync(path(app, 'journeys.json'), 'utf8')) as Manifest;
  fn(m);
  writeFileSync(path(app, 'journeys.json'), JSON.stringify(m, null, 2));
};
const rules = (problems: Problem[]) => problems.map((p) => p.rule);
const has = (problems: Problem[], rule: string, text?: string) =>
  problems.some(
    (p) => p.rule === rule && (text === undefined || p.message.includes(text) || p.file.includes(text)),
  );

describe('the repository', () => {
  it('passes its own inventory', () => {
    // The real flows, scripts and manifests of both apps.
    const problems = checkAll(repo);
    expect(problems.map((p) => `${p.file}: ${p.message}`)).toEqual([]);
  });

  it('lists every journey of the plan, with a flow or a stated reason', () => {
    for (const app of APPS) {
      const m = JSON.parse(
        readFileSync(join(repo, 'apps', app, '.maestro', 'journeys.json'), 'utf8'),
      ) as Manifest;
      const ids = m.journeys.map((j) => j.id);
      for (const required of REQUIRED_JOURNEYS[app]) expect(ids).toContain(required);
      for (const j of m.journeys) expect(j.flows.length > 0 || Boolean(j.manual)).toBe(true);
    }
  });

  it('has every flow named in the plan for the attendee and staff apps', () => {
    expect(REQUIRED_JOURNEYS.mobile).toContain('sign-in-apple');
    expect(REQUIRED_JOURNEYS.mobile).toContain('update-required');
    expect(REQUIRED_JOURNEYS.staff).toContain('organizer-sign-in-totp');
    expect(REQUIRED_JOURNEYS.staff).toContain('update-required-inside-event-window');
  });
});

describe('journeys', () => {
  it('fails when a journey of the plan is dropped from the manifest', () => {
    manifest('mobile', (m) => {
      m.journeys = m.journeys.filter((j) => j.id !== 'delete-account');
    });
    expect(has(checkApp(root, 'mobile'), 'required', 'delete-account')).toBe(true);
  });

  it('fails when a journey has no flow and no manual reason', () => {
    manifest('mobile', (m) => {
      const j = m.journeys.find((x) => x.id === 'sign-out');
      if (j) j.flows = [];
    });
    expect(has(checkApp(root, 'mobile'), 'no-flow', 'journey sign-out')).toBe(true);
  });

  it('accepts a manual journey only with a real reason', () => {
    manifest('mobile', (m) => {
      const j = m.journeys.find((x) => x.id === 'sign-out');
      if (j) {
        j.flows = [];
        j.manual = 'too short';
      }
    });
    expect(has(checkApp(root, 'mobile'), 'journey', 'reason')).toBe(true);
    manifest('mobile', (m) => {
      const j = m.journeys.find((x) => x.id === 'sign-out');
      if (j) j.manual = 'A person must do this on a real phone with a real account.';
    });
    // A manual journey needs no flow; the flow it no longer names is then reported as an orphan, nothing else.
    expect(rules(checkApp(root, 'mobile'))).toEqual(['orphan']);
  });

  it('fails when a platform of the journey has no flow and no reason', () => {
    manifest('mobile', (m) => {
      const j = m.journeys.find((x) => x.id === 'offline-banner');
      if (j) delete j.manualPlatforms;
    });
    expect(has(checkApp(root, 'mobile'), 'no-flow', 'no flow covers ios')).toBe(true);
  });

  it('fails when a journey names a flow that is not in the manifest', () => {
    manifest('staff', (m) => {
      const j = m.journeys.find((x) => x.id === 'revoke');
      if (j) j.flows = ['nope.yaml'];
    });
    expect(has(checkApp(root, 'staff'), 'journey', 'nope.yaml')).toBe(true);
  });

  it('fails when a flow belongs to no journey', () => {
    manifest('staff', (m) => {
      m.journeys = m.journeys.map((j) => ({ ...j, flows: j.flows.filter((f) => f !== 'lookup.yaml') }));
    });
    const problems = checkApp(root, 'staff');
    expect(has(problems, 'orphan', 'lookup.yaml')).toBe(true);
  });
});

describe('flows and the directory', () => {
  it('fails when a listed flow does not exist', () => {
    unlinkSync(path('mobile', 'launch.yaml'));
    expect(has(checkApp(root, 'mobile'), 'missing', 'launch.yaml')).toBe(true);
  });

  it('fails when a flow in the directory is not in the manifest', () => {
    writeFileSync(
      path('mobile', 'stray.yaml'),
      '# Journey: x\n# Preconditions: x\n# Personas: x\nappId: com.yayatoh.yayatohapp.preview\n---\n- launchApp\n',
    );
    expect(has(checkApp(root, 'mobile'), 'unlisted', 'stray.yaml')).toBe(true);
  });

  it('fails when a flow has no appId', () => {
    edit('mobile', 'launch.yaml', (t) => t.replace('appId: com.yayatoh.yayatohapp.preview\n', ''));
    expect(has(checkApp(root, 'mobile'), 'appId', 'no appId')).toBe(true);
  });

  it('fails when the appId is a variable or another app', () => {
    edit('mobile', 'launch.yaml', (t) => t.replace('com.yayatoh.yayatohapp.preview', '${APP_ID}'));
    expect(has(checkApp(root, 'mobile'), 'appId', 'written out')).toBe(true);
    edit('mobile', 'launch.yaml', (t) => t.replace('${APP_ID}', 'com.yayatoh.staff.preview'));
    expect(has(checkApp(root, 'mobile'), 'appId', 'e2e build')).toBe(true);
  });

  it('fails when the top comment does not say journey, preconditions and personas', () => {
    edit('staff', 'launch.yaml', (t) => t.replace('# Personas: none.\n', ''));
    expect(has(checkApp(root, 'staff'), 'header', 'Personas')).toBe(true);
  });

  it('fails when a clean flow starts without clearing the state', () => {
    edit('mobile', 'launch.yaml', (t) => t.replace('    clearState: true\n', ''));
    expect(rules(checkApp(root, 'mobile'))).toContain('clean');
  });

  it('follows a sub-flow when it checks that a flow starts clean', () => {
    edit('mobile', 'subflows/prelude-ticket.yaml', (t) => t.replace('    clearState: true\n', ''));
    const problems = checkApp(root, 'mobile');
    expect(has(problems, 'clean', 'tickets-open-offline.yaml')).toBe(true);
  });

  it('allows a later restart that keeps its state', () => {
    // tickets-open-offline restarts the app with a bare launchApp after the clean start.
    expect(readFileSync(path('mobile', 'tickets-open-offline.yaml'), 'utf8')).toContain('\n- launchApp\n');
    expect(has(checkApp(root, 'mobile'), 'clean')).toBe(false);
  });

  it('fails when a runFlow or runScript names a file that is not there', () => {
    edit('mobile', 'sign-out.yaml', (t) => t.replace('subflows/sign-in.yaml', 'subflows/nope.yaml'));
    expect(has(checkApp(root, 'mobile'), 'reference', 'nope.yaml')).toBe(true);
    edit('mobile', 'sign-in-email-code.yaml', (t) => t.replace('scripts/last-code.js', 'scripts/nope.js'));
    expect(has(checkApp(root, 'mobile'), 'reference', 'nope.js')).toBe(true);
  });

  it('fails on a sub-flow nothing runs', () => {
    writeFileSync(
      path('mobile', 'subflows/lonely.yaml'),
      '# Journey: x\n# Preconditions: x\n# Personas: x\nappId: com.yayatoh.yayatohapp.preview\n---\n- assertVisible: x\n',
    );
    manifest('mobile', (m) => {
      m.flows['subflows/lonely.yaml'] = {
        kind: 'subflow',
        platforms: 'both',
        clean: false,
        ci: false,
        needs: [],
      };
    });
    expect(has(checkApp(root, 'mobile'), 'orphan', 'lonely.yaml')).toBe(true);
  });

  it('fails on a YAML syntax error', () => {
    edit('mobile', 'launch.yaml', (t) => `${t}- tapOn: [unclosed\n`);
    expect(rules(checkApp(root, 'mobile'))).toContain('yaml');
  });
});

describe('banned things', () => {
  it('fails on hard-coded sleeps over 3 s', () => {
    edit('mobile', 'launch.yaml', (t) => `${t}- waitForAnimationToEnd:\n    timeout: 5000\n`);
    expect(has(checkApp(root, 'mobile'), 'sleep', 'waitForAnimationToEnd')).toBe(true);
  });

  it('allows a short settle and a normal wait for something to appear', () => {
    edit(
      'mobile',
      'launch.yaml',
      (t) =>
        `${t}- waitForAnimationToEnd:\n    timeout: 2000\n- extendedWaitUntil:\n    visible: 'Welcome to Yayatoh'\n    timeout: 60000\n`,
    );
    expect(has(checkApp(root, 'mobile'), 'sleep')).toBe(false);
  });

  it('fails on an optional wait used as a sleep outside the two-phone drill, and allows it inside', () => {
    edit(
      'mobile',
      'launch.yaml',
      (t) => `${t}- extendedWaitUntil:\n    visible: 'Never'\n    timeout: 10000\n    optional: true\n`,
    );
    expect(has(checkApp(root, 'mobile'), 'sleep', 'optional extendedWaitUntil')).toBe(true);
    // The drill flows do this on purpose and are marked twoDevices.
    expect(has(checkApp(root, 'staff'), 'sleep')).toBe(false);
  });

  it('caps the drill pause at 60 s', () => {
    edit('staff', 'offline-drill-phone-a.yaml', (t) =>
      t.replace('timeout: 30000\n    optional: true', 'timeout: 90000\n    optional: true'),
    );
    expect(has(checkApp(root, 'staff'), 'sleep', '60 s')).toBe(true);
  });

  it('fails on a sleep command and on a script that sleeps', () => {
    edit('mobile', 'launch.yaml', (t) => `${t}- sleep: 5000\n`);
    expect(has(checkApp(root, 'mobile'), 'sleep', 'sleep')).toBe(true);
    edit('mobile', 'launch.yaml', (t) => t.replace('- sleep: 5000\n', ''));
    writeFileSync(path('mobile', 'scripts/slow.js'), 'setTimeout(function () {}, 5000);\n');
    expect(has(checkApp(root, 'mobile'), 'sleep', 'scripts/slow.js')).toBe(true);
  });

  it('fails on real-looking credentials in a flow, a script or a payload', () => {
    const stripe = ['sk', 'live', 'abcdefghijklmnop1234'].join('_');
    edit('mobile', 'launch.yaml', (t) => `${t}- inputText: ${stripe}\n`);
    expect(has(checkApp(root, 'mobile'), 'credential', 'Stripe')).toBe(true);
    edit('mobile', 'launch.yaml', (t) => t.replace(`- inputText: ${stripe}\n`, ''));
    writeFileSync(path('staff', 'scripts/leak.js'), `var key = "${'yyd_'}${'a'.repeat(24)}";\n`);
    expect(has(checkApp(root, 'staff'), 'credential', 'device token')).toBe(true);
    unlinkSync(path('staff', 'scripts/leak.js'));
    writeFileSync(path('mobile', 'payloads/leak.json'), `{"token":"Bearer ${'x'.repeat(40)}"}`);
    expect(has(checkApp(root, 'mobile'), 'credential', 'Bearer')).toBe(true);
  });

  it('fails on a literal password in an env block, and allows a passed-in value', () => {
    edit('mobile', 'sign-out.yaml', (t) => t.replace('---\n', 'env:\n  PASSWORD: aaaaaaaaaaaa\n---\n'));
    expect(has(checkApp(root, 'mobile'), 'credential', 'PASSWORD')).toBe(true);
    edit('mobile', 'sign-out.yaml', (t) => t.replace('aaaaaaaaaaaa', '${MAESTRO_DEV_PERSONA_PASSWORD}'));
    expect(has(checkApp(root, 'mobile'), 'credential')).toBe(false);
  });

  it('fails on a real service host and allows test hosts and our own domains', () => {
    edit('mobile', 'launch.yaml', (t) => `${t}- openLink: https://accounts.google.com/o/oauth2/auth\n`);
    expect(has(checkApp(root, 'mobile'), 'host', 'accounts.google.com')).toBe(true);
    edit('mobile', 'launch.yaml', (t) =>
      t.replace('https://accounts.google.com/o/oauth2/auth', 'https://app.yayatoh.com/events/x'),
    );
    expect(has(checkApp(root, 'mobile'), 'host')).toBe(false);
  });
});

describe('manifest rules', () => {
  it('fails when a CI flow needs something the EAS runner cannot provide', () => {
    manifest('staff', (m) => {
      const f = m.flows['launch.yaml'];
      if (f) f.needs = ['door-device'];
    });
    expect(has(checkApp(root, 'staff'), 'ci', 'door-device')).toBe(true);
  });

  it('fails when a flow stays out of CI without a reason', () => {
    manifest('staff', (m) => {
      const f = m.flows['revoke.yaml'];
      if (f) delete f.ciReason;
    });
    expect(has(checkApp(root, 'staff'), 'ci', 'ciReason')).toBe(true);
  });

  it('fails when a two-device flow is put in CI', () => {
    manifest('staff', (m) => {
      const f = m.flows['offline-drill-phone-a.yaml'];
      if (f) {
        f.ci = true;
        f.needs = [];
      }
    });
    expect(has(checkApp(root, 'staff'), 'ci', 'two-device')).toBe(true);
  });

  it('fails on a flow that toggles airplane mode but is tagged for iOS', () => {
    manifest('mobile', (m) => {
      const f = m.flows['offline-banner.yaml'];
      if (f) f.platforms = 'both';
    });
    expect(has(checkApp(root, 'mobile'), 'platform', 'setAirplaneMode')).toBe(true);
  });

  it('fails on an unknown need and on a missing manifest', () => {
    manifest('mobile', (m) => {
      const f = m.flows['launch.yaml'];
      if (f) f.needs = ['a-unicorn' as never];
    });
    expect(has(checkApp(root, 'mobile'), 'manifest', 'a-unicorn')).toBe(true);
    unlinkSync(path('staff', 'journeys.json'));
    expect(has(checkApp(root, 'staff'), 'manifest', 'journeys.json is missing')).toBe(true);
  });
});

describe('what the EAS workflow runs', () => {
  it('lists CI flows per platform, in order, as repository paths', () => {
    const android = ciFlows(repo, 'mobile', 'android');
    expect(android).toEqual([...android].sort());
    expect(android).toContain('apps/mobile/.maestro/tickets-open-offline.yaml');
    expect(ciFlows(repo, 'mobile', 'ios')).not.toContain('apps/mobile/.maestro/tickets-open-offline.yaml');
    expect(ciFlows(repo, 'staff', 'ios')).toContain('apps/staff/.maestro/organizer-sign-in.yaml');
  });

  it('never lists a flow that needs a door device, a push sender or a second phone', () => {
    for (const app of APPS)
      for (const platform of ['ios', 'android'] as const)
        for (const flow of ciFlows(repo, app, platform)) {
          expect(flow).not.toMatch(/scan-|offline-drill|remote-wipe|revoke|push-tap|update-required/);
        }
  });

  it('has the journey tables of the spec in step with the manifests', () => {
    // Regenerate with: node tools/check-maestro/cli.ts --table mobile (and staff), and paste into the spec.
    const spec = readFileSync(join(repo, 'docs', 'specs', 'M7.X', 'maestro.md'), 'utf8');
    for (const app of APPS) expect(spec).toContain(journeyTable(repo, app));
  });

  it('prints them from the command line, and prints a journey table', () => {
    const out = execFileSync('node', [cli, '--root', repo, '--print-flows', 'staff:android'], {
      encoding: 'utf8',
    });
    expect(out.trim().split('\n')).toEqual(ciFlows(repo, 'staff', 'android'));
    const table = journeyTable(repo, 'mobile');
    expect(table.split('\n')[0]).toContain('| Journey |');
    expect(table).toContain('sign-in-email-code.yaml');
    expect(table.split('\n').length).toBeGreaterThan(30);
  });

  it('exits 1 with a message when the inventory fails, 0 when it passes', () => {
    expect(execFileSync('node', [cli, '--root', repo], { encoding: 'utf8' })).toContain('check-maestro: ok');
    unlinkSync(path('mobile', 'launch.yaml'));
    let status = 0;
    let stderr = '';
    try {
      execFileSync('node', [cli, '--root', root, '--app', 'mobile'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      const e = error as { status: number; stderr: string };
      status = e.status;
      stderr = e.stderr;
    }
    expect(status).toBe(1);
    expect(stderr).toContain('launch.yaml');
  });
});
