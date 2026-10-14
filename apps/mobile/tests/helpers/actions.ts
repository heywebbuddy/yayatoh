import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

/** Types into a field by its testID. */
export const type = (testID: string, text: string) => fireEvent.changeText(screen.getByTestId(testID), text);

/** Presses a control by its testID, inside act so the async work it starts is flushed. */
export const press = async (testID: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
};

export const pressName = async (name: string | RegExp) => {
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name }));
  });
};

export const onPath = (view: { getPathname(): string }, path: string) =>
  waitFor(() => expect(view.getPathname()).toBe(path));

export const text = (testID: string): string => {
  const node = screen.getByTestId(testID);
  const children = node.props.children;
  return Array.isArray(children) ? children.join('') : String(children);
};

/** A tab of the bottom bar, by its label (the bar adds ", tab, 1 of 3" for screen readers). */
export const tab = (name: string) => screen.getByLabelText(new RegExp(`^${name}, tab`));

export const openTab = async (name: string) => {
  await act(async () => {
    fireEvent.press(tab(name));
  });
};
