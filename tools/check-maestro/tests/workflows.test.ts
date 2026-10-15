/* biome-ignore-all lint/suspicious/noExplicitAny: parsed workflow YAML is untyped */
/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: GitHub expressions are written as text */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { APPS, ciFlows } from '../src/check.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = (rel: string) => readFileSync(join(repo, rel), 'utf8');
const yaml = (rel: string) => parse(text(rel)) as Record<string, any>;

const MAESTRO = '.github/workflows/maestro.yml';
const maestro = yaml(MAESTRO);
const steps = (job: string): Record<string, any>[] => maestro.jobs[job].steps;

/** The Maestro workflow can hold the secret in `env:` only; anywhere else is a leak waiting to happen. */
const secretsReferences = (raw: string) => raw.split('\n').filter((l) => /secrets\./.test(l));

describe('.github/workflows/maestro.yml', () => {
  it('parses, runs on pull requests into main and by hand, and asks for read-only access', () => {
    expect(maestro.name).toBe('Maestro');
    expect(maestro.on.pull_request.branches).toEqual(['main']);
    expect(maestro.on).toHaveProperty('workflow_dispatch');
    expect(maestro.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values<any>(maestro.jobs)) expect(job.permissions).toBeUndefined();
  });

  it('has a gate job that turns the secret into has_token without printing it', () => {
    const gate = maestro.jobs.gate;
    expect(gate).toBeDefined();
    expect(gate.outputs.has_token).toBe('${{ steps.token.outputs.has_token }}');
    const step = steps('gate').find((s) => s.id === 'token');
    expect(step?.env).toEqual({ EXPO_TOKEN: '${{ secrets.EXPO_TOKEN }}' });
    expect(step?.run).toContain('has_token=true');
    expect(step?.run).toContain('has_token=false');
    expect(step?.run).toContain('[ -n "$EXPO_TOKEN" ]');
    // A clear notice and a run summary on the skip path.
    expect(step?.run).toContain(
      '::notice title=Maestro on EAS skipped::Maestro on EAS skipped: EXPO_TOKEN is not set (owner: add it as a GitHub secret; see docs/specs/M7.X/maestro.md)',
    );
    expect(step?.run).toContain('GITHUB_STEP_SUMMARY');
  });

  it('runs the EAS workflows only after the gate says there is a token', () => {
    const job = maestro.jobs.maestro;
    const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
    expect(needs).toContain('gate');
    expect(job.if).toBe("needs.gate.outputs.has_token == 'true'");
    expect(job.strategy.matrix.app).toEqual(['mobile', 'staff']);
    const run = steps('maestro').find((s) => String(s.run ?? '').includes('workflow:run'));
    expect(run?.run).toContain(
      'eas-cli@16 workflow:run ../../.eas/workflows/maestro-${{ matrix.app }}.yml',
    );
    expect(run?.run).toContain('--non-interactive');
    expect(run?.['working-directory']).toBe('apps/${{ matrix.app }}');
    expect(run?.env).toEqual({ EXPO_TOKEN: '${{ secrets.EXPO_TOKEN }}' });
  });

  it('never echoes, prints or logs EXPO_TOKEN', () => {
    const raw = text(MAESTRO);
    // The secret appears only as the value of an env entry.
    for (const line of secretsReferences(raw))
      expect(line.trim()).toBe('EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}');
    expect(secretsReferences(raw)).toHaveLength(2);
    for (const job of Object.values<any>(maestro.jobs))
      for (const step of job.steps ?? []) {
        const run = String(step.run ?? '');
        // The only expansion of the variable is the emptiness test; the words "EXPO_TOKEN is not set" are text.
        expect(run.replace('[ -n "$EXPO_TOKEN" ]', '')).not.toMatch(/\$\{?EXPO_TOKEN/);
        expect(run).not.toMatch(/\bset -x\b|\bxtrace\b|\benv\b\s*\||\bprintenv\b|--verbose|--debug/);
        expect(JSON.stringify(step.name ?? '')).not.toContain('secrets.');
      }
    // The token is not an input, an output or a job-level env either.
    expect(maestro.env).toBeUndefined();
    for (const job of Object.values<any>(maestro.jobs))
      expect(JSON.stringify(job.env ?? {})).not.toContain('EXPO_TOKEN');
    expect(JSON.stringify(maestro.jobs.gate.outputs)).not.toContain('EXPO_TOKEN');
  });

  it('pins actions the way ci.yml does', () => {
    const versions = (raw: string) => {
      const out = new Map<string, Set<string>>();
      for (const [, name, version] of raw.matchAll(/uses:\s*([\w./-]+)@([\w.]+)/g)) {
        if (!name || !version) continue;
        out.set(name, (out.get(name) ?? new Set()).add(version));
      }
      return out;
    };
    const ci = versions(text('.github/workflows/ci.yml'));
    const mine = versions(text(MAESTRO));
    expect(mine.size).toBeGreaterThan(0);
    for (const [name, found] of mine) {
      expect(found.size).toBe(1);
      const [version] = [...found];
      expect(version).toMatch(/^(v\d+|[0-9a-f]{40})$/);
      expect([...(ci.get(name) ?? [])]).toContain(version);
    }
  });

  it('runs the cheap inventory before the paid run', () => {
    const names = steps('maestro').map((s) => String(s.run ?? ''));
    const inventory = names.findIndex((r) => r.includes('tools/check-maestro/cli.ts'));
    const eas = names.findIndex((r) => r.includes('workflow:run'));
    expect(inventory).toBeGreaterThan(-1);
    expect(inventory).toBeLessThan(eas);
  });
});

describe('ci.yml', () => {
  it('runs the inventory in the mobile job with one additive step', () => {
    const ci = yaml('.github/workflows/ci.yml');
    const run = (ci.jobs.mobile.steps as Record<string, any>[]).map((s) => String(s.run ?? ''));
    expect(run.filter((r) => r.includes('check-maestro'))).toEqual(['node tools/check-maestro/cli.ts']);
  });
});

describe('.eas/workflows', () => {
  const dir = join(repo, '.eas', 'workflows');
  const files = existsSync(dir) ? readdirSync(dir).sort() : [];

  it('has one workflow per app', () => {
    expect(files).toEqual(['maestro-mobile.yml', 'maestro-staff.yml']);
  });

  for (const app of APPS) {
    const rel = `.eas/workflows/maestro-${app}.yml`;
    const wf = existsSync(join(repo, rel)) ? yaml(rel) : {};

    it(`${app}: parses, builds both simulators and runs Maestro on both`, () => {
      expect(wf.jobs).toBeDefined();
      expect(wf.on.pull_request.branches).toEqual(['main']);
      expect(wf.jobs.build_ios.params).toEqual({ platform: 'ios', profile: 'e2e-ios' });
      expect(wf.jobs.build_android.params).toEqual({ platform: 'android', profile: 'e2e-android' });
      expect(wf.jobs.maestro_ios.type).toBe('maestro');
      expect(wf.jobs.maestro_android.type).toBe('maestro');
      for (const job of Object.values<any>(wf.jobs))
        for (const need of job.needs ?? []) expect(Object.keys(wf.jobs)).toContain(need);
    });

    it(`${app}: runs exactly the flows the manifest marks for CI, and every one exists`, () => {
      for (const platform of ['ios', 'android'] as const) {
        const listed = wf.jobs[`maestro_${platform}`].params.flow_path as string[];
        expect(listed).toEqual(ciFlows(repo, app, platform));
        for (const flow of listed) expect(existsSync(join(repo, flow))).toBe(true);
      }
    });

    it(`${app}: contains no credential`, () => {
      const raw = text(rel);
      expect(raw).not.toMatch(
        /AKIA[0-9A-Z]{16}|\b[rs]k_(live|test)_|-----BEGIN|eyJ[\w-]{10,}\.|\bexpo_[A-Za-z0-9]{24,}|\byy[drp]_[\w-]{16,}/,
      );
      expect(raw).not.toMatch(/EXPO_TOKEN|secrets\./);
      expect(raw).not.toMatch(/\.p8|\.p12|\.keystore|serviceAccount|credentials\.json|appleId/i);
    });

    it(`${app}: eas.json adds the e2e profiles without credentials and leaves the others alone`, () => {
      const eas = JSON.parse(text(`apps/${app}/eas.json`)) as Record<string, any>;
      expect(eas.build.development).toEqual({
        developmentClient: true,
        distribution: 'internal',
        channel: 'development',
        env: { APP_ENV: 'development' },
        ios: { simulator: true },
      });
      expect(eas.build.preview).toEqual({
        distribution: 'internal',
        channel: 'preview',
        env: { APP_ENV: 'preview' },
      });
      expect(eas.build.production).toEqual({
        channel: 'production',
        autoIncrement: true,
        env: { APP_ENV: 'production' },
      });
      expect(eas.submit).toEqual({ production: {} });
      for (const [name, os] of [
        ['e2e-ios', 'ios'],
        ['e2e-android', 'android'],
      ] as const) {
        const profile = eas.build[name];
        expect(profile.env.APP_ENV).toBe('preview');
        expect(profile.developmentClient).toBeUndefined();
        expect(profile.distribution).toBe('internal');
        // Never the production API: a placeholder until the owner points it at an e2e server (https).
        expect(profile.env.API_BASE_URL).toMatch(/^https:\/\/.+\/api\/v1$/);
        expect(profile.env.API_BASE_URL).not.toMatch(/yayatoh\.com/);
        expect(
          Object.keys(profile).filter((k) => /credential|keystore|certificate|provisioning/i.test(k)),
        ).toEqual([]);
        expect(JSON.stringify(profile)).not.toMatch(
          /credentialsSource|keystorePath|certificate|serviceAccount/i,
        );
        if (os === 'ios') expect(profile.ios).toEqual({ simulator: true });
        else expect(profile.android).toEqual({ buildType: 'apk' });
      }
    });
  }

  it('reads the same list from the command line the workflows were written from', () => {
    const out = execFileSync(
      'node',
      [join(repo, 'tools', 'check-maestro', 'cli.ts'), '--root', repo, '--print-flows', 'mobile:ios'],
      {
        encoding: 'utf8',
      },
    );
    const wf = yaml('.eas/workflows/maestro-mobile.yml');
    expect(wf.jobs.maestro_ios.params.flow_path).toEqual(out.trim().split('\n'));
  });
});

describe('the GitHub workflow and the flows agree on the secret', () => {
  it('no flow, script or workflow file holds an Expo token', () => {
    for (const app of APPS) {
      const dir = join(repo, 'apps', app, '.maestro');
      const walk = (d: string): string[] =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
        );
      for (const file of walk(dir))
        expect(readFileSync(file, 'utf8')).not.toMatch(/EXPO_TOKEN|expo_[A-Za-z0-9]{24,}/);
    }
  });
});
