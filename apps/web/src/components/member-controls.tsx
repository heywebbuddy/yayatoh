'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { MemberState } from '@/app/[locale]/o/[org]/(org)/team/actions.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { useStepUpActionState } from './step-up.tsx';

const ROLES = [
  'owner',
  'admin',
  'manager',
  'finance',
  'marketing',
  'box_office',
  'scanner',
  'viewer',
] as const;

type Notify = (message: string) => void;
const NoticeContext = createContext<Notify>(() => {});

/**
 * The team table's announcements (M1.2c leftover): a role change or a removal is said out loud
 * here, and focus comes here after a removal (the row it was in is gone).
 */
export function TeamNotices({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; at: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const notify = useCallback((text: string) => setMessage({ text, at: Date.now() }), []);
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  return (
    <NoticeContext value={notify}>
      <div ref={ref} tabIndex={-1} className="outline-none">
        {message ? <Alert key={message.at} tone="info" title={message.text} /> : null}
      </div>
      {children}
    </NoticeContext>
  );
}

const INITIAL: MemberState = { ok: false, code: null };

function useMessage() {
  const t = useTranslations();
  return (state: MemberState) =>
    state.reason === 'last_owner'
      ? t('team.errors.last_owner')
      : state.reason === 'owner_only'
        ? t('team.errors.owner_only')
        : t(errorMessageKey(state.code));
}

/**
 * Change a member's role or remove them (M1.2c leftover). Both are step-up commands: "Confirm
 * it's you" opens when needed and the same change is sent again. Removing asks first; only owners
 * see (and may choose) the owner role.
 */
export function MemberControls({
  name,
  role,
  canOwn,
  changeRole,
  remove,
}: {
  name: string;
  role: string;
  /** The viewer is an owner: may make owners and change or remove them. */
  canOwn: boolean;
  changeRole: (prev: MemberState, form: FormData) => Promise<MemberState>;
  remove: (prev: MemberState, form: FormData) => Promise<MemberState>;
}) {
  const t = useTranslations();
  const notify = useContext(NoticeContext);
  const message = useMessage();
  const selectId = useId();
  const confirmId = useId();
  const [confirming, setConfirming] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null);
  const yesButton = useRef<HTMLButtonElement>(null);
  // Announced as soon as the server answers: after a removal this row (and this component) is
  // gone in the same render, so an effect here might never run.
  const changeAndTell = useCallback(
    async (prev: MemberState, form: FormData) => {
      const r = await changeRole(prev, form);
      if (r.ok) notify(t('team.roleChanged', { name }));
      return r;
    },
    [changeRole, notify, t, name],
  );
  const removeAndTell = useCallback(
    async (prev: MemberState, form: FormData) => {
      const r = await remove(prev, form);
      if (r.ok) notify(t('team.removed', { name }));
      return r;
    },
    [remove, notify, t, name],
  );
  const [roleState, roleAction, rolePending, roleForm] = useStepUpActionState(changeAndTell, INITIAL);
  const [removeState, removeAction, removePending, removeForm] = useStepUpActionState(removeAndTell, INITIAL);
  const roles = canOwn ? ROLES : ROLES.filter((r) => r !== 'owner');

  // Focus follows the confirmation: into it when it opens, back to "Remove" when cancelled.
  const refocus = useRef(false);
  useEffect(() => {
    if (confirming) yesButton.current?.focus();
    else if (refocus.current) {
      refocus.current = false;
      removeButton.current?.focus();
    }
  }, [confirming]);

  if (role === 'owner' && !canOwn)
    return <span className="text-caption text-zinc-500">{t('team.ownerOnly')}</span>;

  const cancel = () => {
    refocus.current = true;
    setConfirming(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form ref={roleForm} action={roleAction} className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="sr-only">
            {t('team.roleFor', { name })}
          </label>
          <select
            id={selectId}
            name="role"
            defaultValue={role}
            key={role}
            className="min-h-8 rounded-pill border border-zinc-200 bg-white px-3 text-caption"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={rolePending}
            aria-label={t('team.saveRoleFor', { name })}
          >
            {t('team.saveRole')}
          </Button>
        </form>
        {confirming ? null : (
          <Button
            ref={removeButton}
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            aria-label={t('team.removeName', { name })}
          >
            {t('team.remove')}
          </Button>
        )}
      </div>
      {confirming ? (
        <form
          ref={removeForm}
          action={removeAction}
          aria-labelledby={confirmId}
          className="flex flex-wrap items-center gap-2 rounded-card border border-zinc-200 bg-zinc-50 px-3 py-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
          }}
        >
          <p id={confirmId} className="text-caption text-zinc-700">
            {t('team.confirmRemove', { name })}
          </p>
          <Button ref={yesButton} type="submit" size="sm" disabled={removePending}>
            {t('team.confirmRemoveYes')}
          </Button>
          <Button variant="secondary" size="sm" onClick={cancel}>
            {t('team.cancel')}
          </Button>
        </form>
      ) : null}
      <div aria-live="polite">
        {roleState.code ? <Alert title={message(roleState)} /> : null}
        {removeState.code ? <Alert title={message(removeState)} /> : null}
      </div>
    </div>
  );
}
