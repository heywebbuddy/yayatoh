'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { ProgramForm, type ProgramFormState } from '@/components/program-form.tsx';
import { errorMessageKey } from '@/lib/errors.ts';
import { type FormState, INITIAL_FORM_STATE } from '@/lib/form-state.ts';
import { keepValues } from '@/lib/keep-values.ts';

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

export interface MenuOption {
  readonly id: string;
  readonly label: string;
  readonly notes: string | null;
}

/** "Remove <option>": refused (with the reason next to it) while guests have chosen it. */
function RemoveOption({ action, label }: { action: Action; label: string }) {
  const t = useTranslations('rsvpQuestions');
  const te = useTranslations();
  const [state, formAction, pending] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} onSubmit={keepValues(formAction)} className="flex flex-col items-end gap-2">
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={t('menu.removeOption', { label })}
      >
        {t('menu.remove')}
      </Button>
      {state.code ? (
        <div aria-live="polite">
          <Alert
            title={state.reason === 'menu_option_in_use' ? t('menu.inUse') : te(errorMessageKey(state.code))}
          />
        </div>
      ) : null}
    </form>
  );
}

/**
 * The event's menu (M4.1e): what the meal question offers, with dietary notes. Each option can be
 * renamed (guests who chose it follow) or removed while nobody chose it; viewers read the list.
 */
export function MenuEditor({
  options,
  canWrite,
  add,
  save,
  remove,
}: {
  options: readonly MenuOption[];
  canWrite: boolean;
  add: (prev: ProgramFormState, form: FormData) => Promise<ProgramFormState>;
  save: Readonly<Record<string, (prev: ProgramFormState, form: FormData) => Promise<ProgramFormState>>>;
  remove: Readonly<Record<string, Action>>;
}) {
  const t = useTranslations('rsvpQuestions');
  const errors = {
    label: t('menu.errors.label'),
    menu_label_taken: t('menu.errors.taken'),
    too_many: t('menu.errors.tooMany'),
  };
  return (
    <div className="flex flex-col gap-4">
      {options.length === 0 ? (
        <p className="m-0 rounded-tile border border-dashed border-line-strong/50 px-4 py-6 text-center text-body text-ink-2">
          {t('menu.empty')}
        </p>
      ) : (
        <ul aria-label={t('menu.listLabel')} className="m-0 flex list-none flex-col gap-2 p-0">
          {options.map((o) => (
            <li
              key={o.id}
              className="flex flex-col gap-2 rounded-tile border border-line bg-surface-2 px-4 py-3"
            >
              <div className="flex flex-wrap items-start gap-3">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-body font-bold text-ink">{o.label}</span>
                  {o.notes ? <span className="text-caption text-ink-2">{o.notes}</span> : null}
                </span>
                {canWrite && remove[o.id] ? (
                  <RemoveOption action={remove[o.id] as Action} label={o.label} />
                ) : null}
              </div>
              {canWrite && save[o.id] ? (
                <details>
                  <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-[10px] px-2 text-caption font-bold text-primary-ink hover:bg-surface-3">
                    {t('menu.edit', { label: o.label })}
                  </summary>
                  <div className="pt-3">
                    <ProgramForm
                      action={save[o.id] as (p: ProgramFormState, f: FormData) => Promise<ProgramFormState>}
                      idPrefix={`menu-${o.id}`}
                      fields={[
                        {
                          kind: 'text',
                          name: 'label',
                          label: t('menu.label'),
                          defaultValue: o.label,
                          maxLength: 80,
                        },
                        {
                          kind: 'text',
                          name: 'notes',
                          label: t('menu.notes'),
                          hint: t('menu.notesHint'),
                          defaultValue: o.notes ?? '',
                          maxLength: 200,
                        },
                      ]}
                      submitLabel={t('menu.save')}
                      successLabel={t('menu.saved')}
                      errors={errors}
                    />
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <h3 className="m-0 text-[16px] font-extrabold text-ink">{t('menu.addTitle')}</h3>
          <ProgramForm
            action={add}
            idPrefix="menu-new"
            fields={[
              { kind: 'text', name: 'label', label: t('menu.label'), maxLength: 80 },
              {
                kind: 'text',
                name: 'notes',
                label: t('menu.notes'),
                hint: t('menu.notesHint'),
                maxLength: 200,
              },
            ]}
            submitLabel={t('menu.add')}
            successLabel={t('menu.added')}
            errors={errors}
            reset
          />
        </div>
      ) : null}
    </div>
  );
}
