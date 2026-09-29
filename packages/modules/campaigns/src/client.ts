/** Browser-safe exports for the campaign editor: blocks, merge fields, lifecycle. */
export * from './domain/blocks.ts';
export * from './domain/lifecycle.ts';
export {
  applyMerge,
  MERGE_FIELDS,
  type MergeField,
  mergeProblems,
  recipientValues,
  splitName,
} from '@yayatoh/notifications/merge';
