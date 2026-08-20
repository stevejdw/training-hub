'use client';

import { useEffect, useRef, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { AthleteProfile } from '@/lib/profile';

/** Shared hook for the per-page profile editors (Profile, Settings, Goals,
 *  Events). Loads /api/profile, exposes a setter, and provides save() that
 *  PUTs the full object back. Each page mutates only its own section and
 *  saves the merged whole. */
export function useProfileEdit() {
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  /* save() used to read `profile` straight from the render closure, so the very
     common `update(k, v); save();` pair PUT the *pre-update* object — the change
     appeared to stick (local state had moved) and then reverted on reload. The
     ref always holds the latest value, so save() is correct from any closure. */
  const profileRef = useRef<AthleteProfile | null>(null);

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(p => { profileRef.current = p; setProfile(p); })
      .catch(e => setError(String(e)));
  }, []);

  /* Derived from the ref rather than from `prev`, because React defers updater
     functions until re-render — so a same-tick `update(a); update(b); save()`
     would otherwise persist neither. Reading and writing the ref synchronously
     makes sequential updates in one handler compose correctly. */
  function update<K extends keyof AthleteProfile>(key: K, value: AthleteProfile[K]) {
    const base = profileRef.current;
    if (!base) return;
    const next = { ...base, [key]: value };
    profileRef.current = next;
    setProfile(next);
  }

  /** Set one field and persist it in the same tick. Prefer this over
   *  `update(k, v); save();` for controls that save on click. */
  function updateAndSave<K extends keyof AthleteProfile>(key: K, value: AthleteProfile[K]) {
    const base = profileRef.current;
    if (!base) return;
    const next = { ...base, [key]: value };
    profileRef.current = next;
    setProfile(next);
    return save(next);
  }

  async function save(override?: AthleteProfile) {
    const body = override ?? profileRef.current ?? profile;
    if (!body) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  /* Consumers also call setProfile directly; keep the ref honest for them too. */
  useEffect(() => { profileRef.current = profile; }, [profile]);

  return { profile, setProfile, update, updateAndSave, save, saving, saved, error };
}

/** Shared input/textarea base classes for the editor pages. */
export const inputCls = 'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors';

/** Common page wrapper used by all account-style pages. */
export function PageShell({
  title,
  icon,
  right,
  back,
  showSettings,
  width = 'narrow',
  children,
}: {
  title: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  back?: { label: string; onClick: () => void };
  showSettings?: boolean;
  /** 'narrow' caps at 5xl; 'wide' goes to 7xl on xl screens, matching the
   *  analytics pages. Page width used to depend on which wrapper a page
   *  happened to use. */
  width?: 'narrow' | 'wide';
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={icon} title={title} right={right} back={back} showSettings={showSettings} />
      <div className="flex-1 overflow-y-auto scroll-touch">
        {/* pb-nav derives the bottom clearance from --bottom-nav-h instead of
            the <div className="h-20" /> spacer this used to end with. */}
        <div className={`${CONTAINER[width]} mx-auto px-4 py-5 md:px-8 md:py-8 space-y-5 pb-nav`}>
          {children}
        </div>
      </div>
    </div>
  );
}

const CONTAINER = {
  narrow: 'max-w-2xl md:max-w-5xl',
  wide:   'max-w-2xl md:max-w-5xl xl:max-w-7xl',
} as const;
