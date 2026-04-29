'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(setProfile)
      .catch(e => setError(String(e)));
  }, []);

  function update<K extends keyof AthleteProfile>(key: K, value: AthleteProfile[K]) {
    setProfile(prev => prev ? { ...prev, [key]: value } : prev);
  }

  async function save(override?: AthleteProfile) {
    const body = override ?? profile;
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

  return { profile, setProfile, update, save, saving, saved, error };
}

/** Shared input/textarea base classes for the editor pages. */
export const inputCls = 'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors';

/** Common page wrapper used by all account-style pages. */
export function PageShell({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={icon} title={title} />
      <div className="flex-1 overflow-y-auto scroll-touch">
        <div className="max-w-2xl mx-auto px-4 py-5 md:px-8 md:py-8 space-y-5">
          {children}
          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
