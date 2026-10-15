/**
 * The static accessibility scan both apps run over their source (M7.X). It parses every file with
 * the TypeScript compiler (so comments, strings and type members are never mistaken for styles) and
 * reports the rules a screen reader, a larger font or a right-to-left language can break:
 *
 * - `physical-style`   left/right in a style (use start/end), a fixed text alignment or direction.
 * - `font-scaling`     text that cannot grow: allowFontScaling={false}, a small maxFontSizeMultiplier,
 *                      adjustsFontSizeToFit, numberOfLines.
 * - `control`          a Pressable/Touchable/Switch/Button without a role and a name; a TextInput
 *                      without a label; an Image without a description.
 * - `field-autofill`   a kit Field with neither textContentType nor autoComplete.
 * - `raw-control`      a screen file that builds its own Pressable/TextInput/Switch instead of the kit.
 * - `colour`           a colour literal outside the tokens (hex, rgb, hsl, a colour name).
 * - `direction-glyph`  an arrow or chevron character, which would point the wrong way in Arabic.
 *
 * Anything else stays a decision for a person; every exception is listed by the caller with a reason.
 */
import ts from 'typescript';

export type Rule =
  | 'physical-style'
  | 'font-scaling'
  | 'control'
  | 'field-autofill'
  | 'raw-control'
  | 'colour'
  | 'direction-glyph';

export interface Finding {
  readonly rule: Rule;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface ScanConfig {
  /** Files (as paths relative to the repository) that may build raw controls: the UI kits. */
  readonly kitFiles: readonly string[];
  /** Files that are screens, and so may only use the kit's controls. */
  readonly isScreenFile: (file: string) => boolean;
  /** Kit components that wrap a TextInput. */
  readonly fieldComponents: readonly string[];
  /** Files that define colours (the tokens and the theme). */
  readonly colourFiles: readonly string[];
  /** Documented exceptions, each with its reason: `${rule} ${file}` (the whole file) or `${rule} ${file}:${line}`. */
  readonly allow?: Readonly<Record<string, string>>;
}

const PHYSICAL_BOX =
  /^(margin|padding)(Left|Right)$|^border(Left|Right)(Width|Color)?$|^border(Top|Bottom)(Left|Right)Radius$/;
const PHYSICAL_EDGE = new Set(['left', 'right']);
const COLOUR_NAMES = new Set(['white', 'black', 'red', 'green', 'blue', 'gray', 'grey', 'yellow', 'orange']);
const DIRECTION_GLYPHS = /[←→↑↓↔↩↪↗↘➔➜➡⬅›‹«»▶◀▸◂❯❮]/;
const RAW_CONTROLS = new Set([
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
  'Switch',
  'TextInput',
]);
const NEEDS_ROLE = new Set([
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
  'Switch',
]);
const COLOUR_LITERAL = /^#[0-9a-f]{3,8}$|^(rgb|rgba|hsl|hsla)\(/i;

function attr(el: ts.JsxOpeningLikeElement, ...names: string[]): ts.JsxAttribute | undefined {
  for (const a of el.attributes.properties)
    if (ts.isJsxAttribute(a) && names.includes(a.name.getText())) return a;
  return undefined;
}

const hasSpread = (el: ts.JsxOpeningLikeElement) => el.attributes.properties.some(ts.isJsxSpreadAttribute);

/** The literal value of an attribute: `"x"`, `{"x"}`, `{false}`, `{1.2}`; undefined when computed. */
function literalOf(a: ts.JsxAttribute | undefined): string | number | boolean | null | undefined {
  if (!a) return undefined;
  const init = a.initializer;
  if (!init) return true;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteralLike(e)) return e.text;
    if (ts.isNumericLiteral(e)) return Number(e.text);
    if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (e.kind === ts.SyntaxKind.NullKeyword) return null;
  }
  return undefined;
}

const hasTextChild = (el: ts.JsxElement) =>
  el.children.some(
    (c) => (ts.isJsxText(c) && c.text.trim() !== '') || ts.isJsxExpression(c) || ts.isJsxElement(c),
  );

function keyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

/** True when an object literal is (part of) a style: inside StyleSheet.*, a style prop or a style option. */
function inStyleContext(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && /^StyleSheet\.(create|flatten|compose)$/.test(p.expression.getText()))
      return true;
    if (ts.isJsxAttribute(p) && /style$/i.test(p.name.getText())) return true;
    if (ts.isPropertyAssignment(p)) {
      const k = keyName(p.name);
      if (k && /style$/i.test(k)) return true;
    }
    if (ts.isVariableDeclaration(p) && /style/i.test(p.name.getText())) return true;
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

export function scanSource(file: string, text: string, config: ScanConfig): Finding[] {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Finding[] = [];
  const isKit = config.kitFiles.includes(file);
  const isScreen = config.isScreenFile(file);
  const isColourFile = config.colourFiles.includes(file);

  // Which local names come from react-native / expo-router (a kit's own `Button` is not RN's).
  const rn = new Map<string, string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const mod = stmt.moduleSpecifier.text;
    const bindings = stmt.importClause?.namedBindings;
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      ['react-native', 'expo-router', 'expo-apple-authentication'].includes(mod)
    )
      for (const el of bindings.elements) rn.set(el.name.text, (el.propertyName ?? el.name).text);
    if (bindings && ts.isNamespaceImport(bindings) && mod === 'expo-apple-authentication')
      rn.set(`${bindings.name.text}.AppleAuthenticationButton`, 'AppleAuthenticationButton');
  }

  const add = (rule: Rule, node: ts.Node, message: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const key = `${rule} ${file}:${line}`;
    if (config.allow && (key in config.allow || `${rule} ${file}` in config.allow)) return;
    found.push({ rule, file, line, message });
  };

  const visit = (node: ts.Node) => {
    // --- physical styles
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const key = ts.isPropertyAssignment(node) ? keyName(node.name) : node.name.text;
      if (key && PHYSICAL_BOX.test(key))
        add('physical-style', node, `${key} is physical, use the start/end form`);
      if (key && PHYSICAL_EDGE.has(key) && inStyleContext(node))
        add('physical-style', node, `${key} is physical, use start/end`);
      if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer)) {
        const v = node.initializer.text;
        if (key === 'textAlign' && (v === 'left' || v === 'right'))
          add('physical-style', node, `textAlign '${v}' does not mirror`);
        if (key === 'flexDirection' && v === 'row-reverse')
          add('physical-style', node, 'row-reverse hard-codes an order');
        if (key === 'writingDirection' && (v === 'ltr' || v === 'rtl'))
          add('physical-style', node, 'writingDirection must follow the language');
        // A colour name or literal in a colour style.
        if (key && /color$/i.test(key) && inStyleContext(node) && !isColourFile) {
          if (COLOUR_LITERAL.test(v) || COLOUR_NAMES.has(v.toLowerCase()))
            add('colour', node, `${key}: '${v}' is not a token`);
        }
      }
    }

    // --- colour literals anywhere in code (a string that is only a colour)
    if (ts.isStringLiteralLike(node) && !isColourFile && COLOUR_LITERAL.test(node.text.trim()))
      add('colour', node, `'${node.text}' is a colour literal, use the tokens`);

    // --- direction glyphs in text
    if (ts.isJsxText(node) && DIRECTION_GLYPHS.test(node.text)) add('direction-glyph', node, 'arrow in text');
    if (
      ts.isStringLiteralLike(node) &&
      DIRECTION_GLYPHS.test(node.text) &&
      !ts.isImportDeclaration(node.parent)
    )
      add('direction-glyph', node, `'${node.text}' has an arrow or chevron that would not mirror`);

    // --- JSX elements
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText();
      const element = ts.isJsxOpeningElement(node) ? (node.parent as ts.JsxElement) : undefined;
      const origin = rn.get(tag);

      // Text that cannot grow.
      if (literalOf(attr(node, 'allowFontScaling')) === false)
        add('font-scaling', node, `${tag}: allowFontScaling={false}`);
      const cap = literalOf(attr(node, 'maxFontSizeMultiplier'));
      if (typeof cap === 'number' && cap > 0 && cap < 1.5)
        add('font-scaling', node, `${tag}: maxFontSizeMultiplier ${cap} is below 1.5`);
      if (attr(node, 'adjustsFontSizeToFit'))
        add('font-scaling', node, `${tag}: adjustsFontSizeToFit shrinks text instead of growing it`);
      // On a multiline field, numberOfLines is the visible height of the box, not a cut-off.
      if (attr(node, 'numberOfLines') && !attr(node, 'multiline'))
        add('font-scaling', node, `${tag}: numberOfLines cuts text off at large sizes`);

      if (origin) {
        const named = Boolean(
          attr(node, 'accessibilityLabel', 'aria-label', 'accessibilityLabelledBy', 'aria-labelledby'),
        );
        const roled = Boolean(attr(node, 'accessibilityRole', 'role'));
        if (RAW_CONTROLS.has(origin) && isScreen && !isKit)
          add(
            'raw-control',
            node,
            `${tag} in a screen: use the kit's control, which owns the role, name and 44 points`,
          );
        if (NEEDS_ROLE.has(origin) && !hasSpread(node)) {
          if (!roled) add('control', node, `${tag} has no accessibilityRole`);
          if (!named) add('control', node, `${tag} has no accessibilityLabel`);
        }
        if (origin === 'Text' && attr(node, 'onPress'))
          add('control', node, 'Text with onPress: use a Button, which has a role, a name and 44 points');
        if (origin === 'TextInput' && !named) add('control', node, 'TextInput has no accessibilityLabel');
        if (origin === 'Link' && !named && !(element && hasTextChild(element)))
          add('control', node, 'Link has no name');
        if (origin === 'Image') {
          const described = attr(
            node,
            'alt',
            'accessibilityLabel',
            'aria-label',
            'aria-hidden',
            'importantForAccessibility',
          );
          const decorative = literalOf(attr(node, 'accessible')) === false;
          if (!described && !decorative)
            add('control', node, 'Image has no alt text and is not marked decorative');
        }
      } else if (tag === 'AppleAuthentication.AppleAuthenticationButton') {
        if (!attr(node, 'accessibilityRole', 'role'))
          add('control', node, 'Apple button has no accessibilityRole');
        if (!attr(node, 'accessibilityLabel')) add('control', node, 'Apple button has no accessibilityLabel');
      }

      if (
        config.fieldComponents.includes(tag) &&
        !hasSpread(node) &&
        !attr(node, 'textContentType', 'autoComplete', 'aria-autocomplete')
      )
        add(
          'field-autofill',
          node,
          `${tag} says neither textContentType nor autoComplete (autoComplete="off" is a decision too)`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export const describeFindings = (findings: readonly Finding[]) =>
  findings.map((f) => `${f.rule} ${f.file}:${f.line} ${f.message}`);
