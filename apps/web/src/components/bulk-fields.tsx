'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

/**
 * The bulk form's action picker and its inputs: a label for label actions, a subject and message
 * for email. Only the fields the chosen action uses are shown (and required).
 */
export function BulkFields({
  canWrite,
  canExport,
  labelSuggestions,
}: {
  canWrite: boolean;
  canExport: boolean;
  labelSuggestions: readonly string[];
}) {
  const t = useTranslations('bulk');
  const [what, setWhat] = useState(canWrite ? 'addLabel' : 'export');
  const cls = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bulk-what" className="text-caption text-zinc-600">
          {t('action')}
        </label>
        <select
          id="bulk-what"
          name="bulk"
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          className={cls}
        >
          {canWrite ? <option value="addLabel">{t('addLabel')}</option> : null}
          {canWrite ? <option value="removeLabel">{t('removeLabel')}</option> : null}
          {canWrite ? <option value="email">{t('email')}</option> : null}
          {canExport ? <option value="export">{t('export')}</option> : null}
        </select>
      </div>
      {what === 'addLabel' || what === 'removeLabel' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bulk-label" className="text-caption text-zinc-600">
            {t('label')}
          </label>
          <input
            id="bulk-label"
            name="bulkLabel"
            required
            maxLength={40}
            list="bulk-label-suggestions"
            autoComplete="off"
            className={cls}
          />
          <datalist id="bulk-label-suggestions">
            {labelSuggestions.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
      ) : null}
      {what === 'email' ? (
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bulk-subject" className="text-caption text-zinc-600">
              {t('subject')}
            </label>
            <input id="bulk-subject" name="subject" required maxLength={150} className={cls} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bulk-message" className="text-caption text-zinc-600">
              {t('message')}
            </label>
            <textarea
              id="bulk-message"
              name="message"
              required
              maxLength={5000}
              rows={5}
              aria-describedby="bulk-message-hint"
              className="rounded-card border border-zinc-200 bg-white px-4 py-3 text-body"
            />
            <span id="bulk-message-hint" className="text-caption text-zinc-500">
              {t('messageHint')}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}
