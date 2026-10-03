/** U7: what the Series field of create-event says for each refusal on it. */
export function seriesErrorKey(code: string): string {
  if (code === 'conflict') return 'seriesField.errors.taken';
  if (code === 'not_found') return 'seriesField.errors.missing';
  return 'seriesField.errors.name';
}
