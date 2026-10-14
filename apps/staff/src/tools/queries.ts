/**
 * Server state for the door tools (M7.4c): TanStack Query keys and hooks over the `ToolsDeps`
 * APIs. Screens that show the day's numbers refresh on their own while the app is in the
 * foreground; anything with a person's name in it is kept out of the persisted cache
 * (`meta.persist = false`) and lives only in memory or in the tools vault.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useTools } from './deps';

export const REFRESH_MS = { overview: 15_000, assistance: 10_000, ops: 15_000 } as const;

export const toolKeys = {
  overview: (eventId: string) => ['tools', 'overview', eventId] as const,
  assistance: (eventId: string) => ['tools', 'assistance', eventId] as const,
  ops: (org: string, eventId: string) => ['tools', 'ops', org, eventId] as const,
  pushStatus: (deviceId: string) => ['tools', 'push', deviceId] as const,
  leadSetup: (owner: string) => ['tools', 'leads', 'setup', owner] as const,
  leads: (owner: string) => ['tools', 'leads', 'list', owner] as const,
};

/** True while the app is in the foreground: polling pauses in the background. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s !== 'background'));
    return () => sub.remove();
  }, []);
  return active;
}

export function useOverview() {
  const { staff, device } = useTools();
  const active = useAppActive();
  return useQuery({
    queryKey: toolKeys.overview(device?.eventId ?? ''),
    queryFn: () => (staff && device ? staff.overview(device.eventId) : Promise.reject(new Error('no device'))),
    enabled: !!staff && !!device,
    refetchInterval: active ? REFRESH_MS.overview : false,
  });
}

export function useAssistanceQueue() {
  const { staff, device } = useTools();
  const active = useAppActive();
  return useQuery({
    queryKey: toolKeys.assistance(device?.eventId ?? ''),
    queryFn: () =>
      staff && device ? staff.assistance(device.eventId) : Promise.reject(new Error('no device')),
    enabled: !!staff && !!device,
    refetchInterval: active ? REFRESH_MS.assistance : false,
    meta: { persist: false },
  });
}

export function useOps() {
  const { organizer } = useTools();
  const active = useAppActive();
  return useQuery({
    queryKey: toolKeys.ops(organizer?.org ?? '', organizer?.eventId ?? ''),
    queryFn: () =>
      organizer ? organizer.api.ops(organizer.org, organizer.eventId) : Promise.reject(new Error('no organizer')),
    enabled: !!organizer,
    refetchInterval: active ? REFRESH_MS.ops : false,
    meta: { persist: false },
  });
}

export function useLeadSetup() {
  const { portal } = useTools();
  return useQuery({
    queryKey: toolKeys.leadSetup(portal?.owner ?? ''),
    queryFn: () => (portal ? portal.api.setup() : Promise.reject(new Error('no portal'))),
    enabled: !!portal,
    meta: { persist: false },
  });
}

export function useLeadList(enabled: boolean) {
  const { portal } = useTools();
  return useQuery({
    queryKey: toolKeys.leads(portal?.owner ?? ''),
    queryFn: () => (portal ? portal.api.leads() : Promise.reject(new Error('no portal'))),
    enabled: !!portal && enabled,
    meta: { persist: false },
  });
}
