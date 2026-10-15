import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPS, loadStore, REPO_ROOT, runChecks } from '../src/app.ts';
import {
  APPLE_SIZES,
  checkScreenshotPlan,
  checkShots,
  expectedShots,
  playSizeOk,
  pngSize,
  type ScreenshotPlan,
} from '../src/screenshots.ts';
import { clone, type Doc } from './doc.ts';

/** A PNG header with the given size: enough for `pngSize`, which reads only the first 24 bytes. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

describe.each(APPS)('%s screenshot plan', (app) => {
  const plan = loadStore(app).screenshots;

  it("passes every check: flows exist, each takes its numbered screenshot, sizes are the stores'", () => {
    expect(runChecks(app).screenshots).toEqual([]);
  });

  it('covers light and dark on a phone and an iPad', () => {
    expect(plan.themes).toEqual(['light', 'dark']);
    const required = plan.devices.filter((d) => d.required).map((d) => d.id);
    expect(required).toEqual(expect.arrayContaining(['iphone-6.9', 'ipad-13', 'android-phone']));
  });

  it('lists 3 to 8 screens per required device, each with a Maestro flow in .maestro/store', () => {
    expect(plan.screens.length).toBeGreaterThanOrEqual(3);
    for (const s of plan.screens) {
      expect(s.flow).toMatch(/^\.maestro\/store\/\d{2}-[a-z0-9-]+\.yaml$/);
      expect(existsSync(join(REPO_ROOT, 'apps', app, s.flow))).toBe(true);
    }
  });

  it('documents one output folder layout and expects exactly the PNGs it names', () => {
    expect(plan.outputLayout).toBe(
      `apps/${app}/store/screenshots/<platform>/<locale>/<device>/<theme>/<order>-<screen>.png`,
    );
    const files = expectedShots(plan);
    const required = plan.devices.filter((d) => d.required);
    const perDevice = required.map((d) => plan.screens.filter((s) => s.devices.includes(d.id)).length);
    expect(files).toHaveLength(
      perDevice.reduce((a, b) => a + b, 0) * plan.themes.length * plan.locales.length,
    );
    expect(files[0]).toMatch(/^(ios|android)\/en\/[a-z0-9.-]+\/(light|dark)\/01-[a-z0-9-]+\.png$/);
  });

  it('the capture script and wrapper exist and run under bash -n', () => {
    expect(existsSync(join(REPO_ROOT, 'tools/store-kit/capture.sh'))).toBe(true);
    expect(readFileSync(join(REPO_ROOT, 'apps', app, 'store/capture.sh'), 'utf8')).toContain(
      `capture.sh" ${app}`,
    );
    for (const file of ['tools/store-kit/capture.sh', `apps/${app}/store/capture.sh`])
      expect(spawnSync('bash', ['-n', join(REPO_ROOT, file)]).status, file).toBe(0);
  });
});

describe('what the plan check refuses', () => {
  const plan = () => clone(loadStore('staff').screenshots) as Doc;
  const ok = {
    exists: () => true,
    read: (p: string) => `- takeScreenshot: \${SHOT_DIR}/${p.split('/').pop()?.replace('.yaml', '')}`,
    supportsTablet: true,
  };

  it('a flow that does not exist', () => {
    const errors = checkScreenshotPlan({ plan: plan() as ScreenshotPlan, ...ok, exists: () => false });
    expect(errors.some((e) => e.includes('does not exist'))).toBe(true);
  });

  it('a flow that never takes its numbered screenshot', () => {
    const errors = checkScreenshotPlan({ plan: plan() as ScreenshotPlan, ...ok, read: () => '- launchApp' });
    expect(errors.some((e) => e.includes('never takes a screenshot'))).toBe(true);
  });

  it("a wrong App Store size, or Play's 2:1 rule broken", () => {
    const p = plan();
    p.devices[0].width = 1000;
    const phone = p.devices.find((d: { id: string }) => d.id === 'android-phone');
    if (phone) phone.height = 4000;
    const errors = checkScreenshotPlan({ plan: p as ScreenshotPlan, ...ok }).join('\n');
    expect(errors).toMatch(/iphone-6.9: App Store wants 1320x2868/);
    expect(errors).toMatch(/android-phone: 1080x4000 breaks Play's size rule/);
  });

  it('no iPad set for an app that runs on iPad', () => {
    const p = plan();
    p.devices = p.devices.filter((d: { id: string }) => d.id !== 'ipad-13');
    p.screens.forEach((s: { devices: string[] }) => {
      s.devices = s.devices.filter((d: string) => d !== 'ipad-13');
    });
    expect(checkScreenshotPlan({ plan: p as ScreenshotPlan, ...ok }).join()).toMatch(/requires an iPad set/);
  });

  it('too few screens for a required device', () => {
    const p = plan();
    p.screens = p.screens.slice(0, 2);
    expect(checkScreenshotPlan({ plan: p as ScreenshotPlan, ...ok }).join()).toMatch(/only 2 screens/);
  });

  it('Play size rule', () => {
    expect(playSizeOk(1080, 1920)).toBe(true);
    expect(playSizeOk(1080, 2160)).toBe(true);
    expect(playSizeOk(1080, 2400)).toBe(false);
    expect(playSizeOk(300, 600)).toBe(false);
  });
});

describe('a finished capture folder', () => {
  const plan = loadStore('mobile').screenshots;
  const size = (rel: string) => {
    const device = plan.devices.find((d) => rel.split('/')[2] === d.id);
    return png(device?.width ?? 0, device?.height ?? 0);
  };

  it("reads a PNG's size from its header, and refuses other files", () => {
    expect(pngSize(png(1320, 2868))).toEqual({ width: 1320, height: 2868 });
    expect(pngSize(new Uint8Array(40))).toBeNull();
  });

  it('is complete when every planned PNG exists at its device size', () => {
    expect(checkShots(plan, size)).toEqual([]);
  });

  it('reports a missing file, a wrong size and a file that is not a PNG', () => {
    const files = expectedShots(plan);
    const [missing, wrong, junk] = files;
    const errors = checkShots(plan, (rel) => {
      if (rel === missing) return null;
      if (rel === wrong) return png(100, 100);
      if (rel === junk) return new Uint8Array(30);
      return size(rel);
    });
    expect(errors).toEqual([
      `${missing}: missing`,
      expect.stringContaining(`${wrong}: 100x100`),
      `${junk}: not a PNG`,
    ]);
  });

  it('uses the sizes App Store Connect accepts', () => {
    for (const d of plan.devices.filter((x) => x.platform === 'ios'))
      expect(APPLE_SIZES[d.id]).toEqual([d.width, d.height]);
  });
});
