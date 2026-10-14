import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

const MIN_TOUCH = 44;

/**
 * Every control on the screen has a role, a spoken name and a target of at least 44 points; every
 * image has a description and every text field a label. Switches size themselves (the row around
 * them carries the 44 points), so only their name is checked.
 */
export function expectAccessibleControls() {
  const problems: string[] = [];
  for (const role of ['button', 'tab', 'switch'] as const) {
    for (const el of screen.queryAllByRole(role)) {
      const name = el.props.accessibilityLabel;
      if (typeof name !== 'string' || name.trim() === '')
        problems.push(`${role} without a name (${el.props.testID ?? '?'})`);
      if (role === 'switch') continue;
      const style = StyleSheet.flatten(el.props.style) ?? {};
      if (!(Number(style.minHeight ?? style.height ?? 0) >= MIN_TOUCH))
        problems.push(`${role} "${name}" is smaller than ${MIN_TOUCH} points`);
    }
  }
  for (const el of screen.queryAllByRole('image')) {
    const name = el.props.accessibilityLabel;
    if (typeof name !== 'string' || name.trim() === '')
      problems.push(`image without a description (${el.props.testID ?? '?'})`);
  }
  for (const el of screen.UNSAFE_queryAllByType(require('react-native').TextInput)) {
    const name = el.props.accessibilityLabel;
    if (typeof name !== 'string' || name.trim() === '')
      problems.push(`text field without a label (${el.props.testID ?? '?'})`);
  }
  expect(problems).toEqual([]);
}
