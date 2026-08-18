'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useCachedFetch } from '@/lib/use-cached-fetch';

/** Shared read-only profile.
 *
 *  PageHeader, Nav and DesktopSidebar each fired their own uncached
 *  fetch('/api/profile') on mount purely to resolve the app icon — three
 *  requests for one string, on every page, plus a visible icon swap once they
 *  landed. They read from here instead, and the cached value is available on
 *  the first render so the swap is gone too.
 *
 *  Read-only by design: the editor pages keep useProfileEdit(), which owns
 *  mutation. */
interface SharedProfile {
  app_icon?: string;
  [key: string]: unknown;
}

const Ctx = createContext<SharedProfile | null>(null);

export default function ProfileProvider({ children }: { children: ReactNode }) {
  const { data } = useCachedFetch<SharedProfile>(
    '/api/profile',
    'cache-profile-v1',
    5 * 60 * 1000,
  );
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

/** The selected home-screen icon, defaulting to the same value the three
 *  components used to default to independently. */
export function useAppIcon(): string {
  const p = useContext(Ctx);
  return (p?.app_icon as string) ?? 'speed';
}
