import { render } from '@testing-library/react-native';
import { Pressable, Text, TextInput } from 'react-native';
import { expectAccessibleControls } from './helpers/a11y';

describe('the accessibility audit used by the screen tests', () => {
  it('passes controls that have a name and 44 points', () => {
    render(
      <>
        <Pressable accessibilityRole="button" accessibilityLabel="Go" style={{ minHeight: 44 }}>
          <Text>Go</Text>
        </Pressable>
        <TextInput accessibilityLabel="Name" />
      </>,
    );
    expectAccessibleControls();
  });

  it('catches an unnamed button, a small target, an undescribed image and an unlabelled field', () => {
    render(
      <>
        <Pressable accessibilityRole="button" style={{ minHeight: 44 }} testID="a" />
        <Pressable accessibilityRole="button" accessibilityLabel="Tiny" style={{ minHeight: 20 }} />
        <Text accessible accessibilityRole="image" testID="img" />
        <TextInput testID="field" />
      </>,
    );
    expect(() => expectAccessibleControls()).toThrow(
      /without a name[\s\S]*smaller than 44[\s\S]*without a description[\s\S]*without a label/,
    );
  });
});
