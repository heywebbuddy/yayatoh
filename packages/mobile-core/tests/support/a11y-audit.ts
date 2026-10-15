/**
 * The rendered accessibility audit both apps run over every screen (M7.X). It walks the whole
 * rendered tree (host elements only, as a screen reader sees them) and returns a list of problems;
 * an empty list means the screen passes. The tests of the apps own the rendering and the data; this
 * file owns the rules, so a rule change is one change.
 *
 * It takes the React Native pieces it needs as arguments (`flatten`) so it never imports a second
 * copy of `react-native` from this package.
 */
/** The part of a rendered tree node (React Test Renderer's `ReactTestInstance`) the audit reads. */
export interface ReactTestInstance {
  readonly type: unknown;
  readonly props: unknown;
  readonly children: readonly (ReactTestInstance | string)[];
}

export const MIN_TOUCH = 44;

type Props = Record<string, unknown>;
type Style = Record<string, unknown>;

export interface AuditEnv {
  /** `StyleSheet.flatten` of the app under test. */
  readonly flatten: (style: unknown) => Style | undefined;
}

export interface AuditOptions {
  /** Controls whose touch target another element provides, by testID, with the reason. */
  readonly sizedByParent?: Readonly<Record<string, string>>;
  /** Screens that must scroll (default) or fit by design (a camera, a splash), with the reason. */
  readonly fixedLayout?: string;
}

const CONTROL_ROLES = new Set([
  'button',
  'link',
  'switch',
  'checkbox',
  'tab',
  'radio',
  'search',
  'imagebutton',
]);
const STATE_KEY: Record<string, string> = { radio: 'checked', checkbox: 'checked', tab: 'selected' };

const isHost = (node: ReactTestInstance) => typeof node.type === 'string';
const hostName = (node: ReactTestInstance) => String(node.type);
const props = (node: ReactTestInstance): Props => (node.props ?? {}) as Props;

export const roleOf = (node: ReactTestInstance): string | undefined => {
  const p = props(node);
  const role = p.accessibilityRole ?? p.role;
  return typeof role === 'string' ? role : undefined;
};

const stringProp = (node: ReactTestInstance, ...keys: string[]): string => {
  for (const key of keys) {
    const value = props(node)[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return '';
};

/** All the text under a node, as a screen reader would join it. */
export function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map((child) => textOf(child as ReactTestInstance | string)).join('');
}

/** A text node counts as decorative when it is taken out of the accessibility tree. */
function isHiddenFromReaders(node: ReactTestInstance): boolean {
  const p = props(node);
  return (
    p.accessible === false ||
    p.accessibilityElementsHidden === true ||
    p['aria-hidden'] === true ||
    p.importantForAccessibility === 'no' ||
    p.importantForAccessibility === 'no-hide-descendants'
  );
}

function visibleText(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  if (isHost(node) && isHiddenFromReaders(node)) return '';
  return node.children.map((child) => visibleText(child as ReactTestInstance | string)).join('');
}

/** The spoken name of a control: its label, or the text inside it. */
export function nameOf(node: ReactTestInstance): string {
  const labelled = stringProp(node, 'accessibilityLabel', 'aria-label');
  if (labelled) return labelled;
  if (props(node).accessibilityLabelledBy || props(node)['aria-labelledby']) return '(labelled by)';
  if (hostName(node) === 'TextInput') return '';
  return textOf(node).trim();
}

const walkHosts = (node: ReactTestInstance, visit: (host: ReactTestInstance) => void) => {
  if (isHost(node)) visit(node);
  for (const child of node.children) if (typeof child !== 'string') walkHosts(child, visit);
};

const hasText = (node: ReactTestInstance): boolean => visibleText(node).trim() !== '';

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

function slopOf(node: ReactTestInstance) {
  const slop = props(node).hitSlop;
  if (typeof slop === 'number') return { top: slop, bottom: slop, start: slop, end: slop };
  const s = (slop ?? {}) as Record<string, number | undefined>;
  return {
    top: s.top ?? 0,
    bottom: s.bottom ?? 0,
    start: s.left ?? 0,
    end: s.right ?? 0,
  };
}

/** True for a host that people can press, type into or toggle. */
export function isControl(node: ReactTestInstance): boolean {
  const role = roleOf(node);
  const type = hostName(node);
  if (type === 'TextInput' || type === 'RCTSwitch') return true;
  if (role && CONTROL_ROLES.has(role)) return true;
  const p = props(node);
  return typeof p.onPress === 'function' || typeof p.onClick === 'function';
}

export interface AuditResult {
  readonly problems: string[];
  /** How many controls were checked (a screen with none is suspicious). */
  readonly controls: number;
  readonly headers: number;
  readonly names: string[];
}

export function auditTree(root: ReactTestInstance, env: AuditEnv, options: AuditOptions = {}): AuditResult {
  const problems: string[] = [];
  const names: string[] = [];
  let controls = 0;
  let headers = 0;
  let scrolls = false;
  const sizedByParent = options.sizedByParent ?? {};

  const labelFor = (node: ReactTestInstance) => {
    const id = props(node).testID;
    return `${hostName(node)}${typeof id === 'string' ? `#${id}` : ''}`;
  };

  const check = (node: ReactTestInstance, ancestors: readonly ReactTestInstance[]) => {
    const p = props(node);
    const type = hostName(node);
    const role = roleOf(node);
    const where = labelFor(node);
    if (role === 'header') headers += 1;
    if (type === 'RCTScrollView' || type === 'ScrollView') scrolls = true;

    // --- text scaling
    if (p.allowFontScaling === false) problems.push(`${where}: allowFontScaling is off`);
    const cap = num(p.maxFontSizeMultiplier);
    if (cap !== undefined && cap > 0 && cap < 1.5)
      problems.push(`${where}: maxFontSizeMultiplier ${cap} is below 1.5`);

    // --- fixed heights that would clip scaled text
    const style = env.flatten(p.style) ?? {};
    if (
      num(style.height) !== undefined &&
      type !== 'Image' &&
      !type.startsWith('RNSVG') &&
      hasText(node) &&
      !isControl(node)
    )
      problems.push(`${where}: a fixed height of ${String(style.height)} would clip scaled text`);

    // --- images
    if (type === 'Image' || role === 'image') {
      const described =
        stringProp(node, 'alt', 'accessibilityLabel', 'aria-label') !== '' || isHiddenFromReaders(node);
      if (!described) problems.push(`${where}: image has no description and is not marked decorative`);
    }

    // --- hidden containers must not hide something people can use
    if (
      isControl(node) &&
      ancestors.some((a) => props(a).importantForAccessibility === 'no-hide-descendants')
    )
      problems.push(`${where}: a control is hidden from screen readers by an ancestor`);

    // --- a modal says it is one, so focus stays inside it
    if (type === 'Modal') {
      let modal = false;
      walkHosts(node, (h) => {
        if (props(h).accessibilityViewIsModal === true || props(h)['aria-modal'] === true) modal = true;
      });
      if (!modal) problems.push(`${where}: modal does not set accessibilityViewIsModal`);
    }

    // --- the error under a field is read with the field
    if (type === 'TextInput') {
      const parent = ancestors[ancestors.length - 1];
      if (parent) {
        const hint = `${stringProp(node, 'accessibilityHint')} ${stringProp(node, 'aria-errormessage')}`;
        walkHosts(parent, (h) => {
          const live = props(h).accessibilityLiveRegion ?? props(h)['aria-live'];
          const isAlert = roleOf(h) === 'alert' || live === 'polite' || live === 'assertive';
          const said = visibleText(h).trim();
          if (h !== node && isAlert && said && !hint.includes(said))
            problems.push(`${where}: the error "${said}" is not linked to its field`);
        });
      }
    }

    if (!isControl(node)) return;
    if (role === 'header') return;
    if (isHiddenFromReaders(node) && role !== 'switch') return;
    controls += 1;
    const name = nameOf(node);
    names.push(name);

    if (!name) problems.push(`${where}: control has no accessible name`);
    if (type !== 'RCTSwitch' && type !== 'TextInput' && !role)
      problems.push(`${where}: control has no accessibilityRole`);
    if (type === 'RCTSwitch' && role !== 'switch') problems.push(`${where}: switch has no role`);

    // --- state for toggles
    if (role && STATE_KEY[role]) {
      const state = (p.accessibilityState ?? {}) as Record<string, unknown>;
      const aria = p[`aria-${STATE_KEY[role]}`];
      if (typeof state[STATE_KEY[role]] !== 'boolean' && typeof aria !== 'boolean')
        problems.push(`${where}: ${role} does not say whether it is ${STATE_KEY[role]}`);
    }

    // --- touch target
    const id = typeof p.testID === 'string' ? p.testID : '';
    if (id in sizedByParent) return;
    const slop = slopOf(node);
    const explicitH = num(style.minHeight) ?? num(style.height);
    if (type === 'RCTSwitch') {
      const rowH = ancestors
        .slice(-3)
        .map((a) => num(env.flatten(props(a).style)?.minHeight))
        .find((h) => h !== undefined && h >= MIN_TOUCH);
      if (rowH === undefined && slop.top + slop.bottom < 8)
        problems.push(`${where}: switch row is not 44 points high`);
      return;
    }
    if (explicitH === undefined) problems.push(`${where}: no explicit minHeight (needs ${MIN_TOUCH})`);
    else if (explicitH + slop.top + slop.bottom < MIN_TOUCH)
      problems.push(`${where}: ${explicitH} points high is smaller than ${MIN_TOUCH}`);
    const iconOnly = !hasText(node) && type !== 'TextInput';
    if (iconOnly) {
      const explicitW = num(style.minWidth) ?? num(style.width);
      if (explicitW === undefined || explicitW + slop.start + slop.end < MIN_TOUCH)
        problems.push(`${where}: icon-only control is narrower than ${MIN_TOUCH}`);
    }
  };

  const visit = (node: ReactTestInstance, ancestors: ReactTestInstance[]) => {
    if (isHost(node)) check(node, ancestors);
    const next = isHost(node) ? [...ancestors, node] : ancestors;
    for (const child of node.children) if (typeof child !== 'string') visit(child, next);
  };
  visit(root, []);

  if (!scrolls && !options.fixedLayout)
    problems.push('the screen has no scrolling container, so large text could not be reached');
  return { problems, controls, headers, names };
}

/** Elements that announce themselves: an alert, or a live region. */
export function announcements(root: ReactTestInstance): string[] {
  const found: string[] = [];
  walkHosts(root, (host) => {
    const live = props(host).accessibilityLiveRegion ?? props(host)['aria-live'];
    if (roleOf(host) === 'alert' || live === 'polite' || live === 'assertive') {
      const text = visibleText(host).trim() || stringProp(host, 'accessibilityLabel');
      if (text) found.push(text);
    }
  });
  return found;
}

export const hasArabicLetters = (text: string) => /[؀-ۿ]/.test(text);
export const hasPlaceholderLeak = (text: string) => /[{}]/.test(text);
