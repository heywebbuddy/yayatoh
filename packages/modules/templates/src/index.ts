// M6.8b: agency templates published downward (the client's own copy).
export {
  existingTemplateIdsTx,
  insertTemplateCopyTx,
  replaceTemplateCopyTx,
  type TemplateContent,
  templateContentTx,
} from './copy.ts';
export { privateColumns } from './private-columns.ts';
export {
  isStarterKey,
  STARTER_KEYS,
  STARTER_TEMPLATES,
  type StarterKey,
  starterEventInput,
} from './starters.ts';
export {
  createFromTemplateCommand,
  deleteTemplateCommand,
  duplicateEventCommand,
  EventSnapshot,
  listTemplatesQuery,
  saveTemplateCommand,
  TemplateDto,
} from './templates.ts';
