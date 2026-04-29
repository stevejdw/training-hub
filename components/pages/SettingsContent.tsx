'use client';

import { useEffect, useState } from 'react';
import { type ThemePreference, getThemePreference, setThemePreference } from '@/components/ThemeProvider';
import { iconFor } from '@/components/nav-items';
import { PageShell, useProfileEdit } from '@/lib/use-profile-edit';

export default function SettingsContent() {
  const { profile, update, save, saving, saved } = useProfileEdit();
  const [theme, setTheme] = useState<ThemePreference>('dark');

  useEffect(() => { setTheme(getThemePreference()); }, []);

  function changeTheme(t: ThemePreference) {
    setTheme(t);
    setThemePreference(t);
  }

  if (!profile) {
    return <PageShell title="Settings" icon={iconFor("settings")}><div className="text-gray-500 text-sm">Loading…</div></PageShell>;
  }

  return (
    <PageShell title="Settings" icon={iconFor("settings")}>
      {/* Appearance */}
      <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Appearance</h2>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => changeTheme('dark')} className={`rounded-xl p-3 border-2 transition-colors text-left ${theme === 'dark' ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600'}`}>
            <div className="flex gap-1 mb-2">
              <div className="w-4 h-4 rounded bg-gray-950 border border-gray-700" />
              <div className="w-4 h-4 rounded bg-gray-800 border border-gray-700" />
              <div className="w-4 h-4 rounded bg-gray-700 border border-gray-700" />
            </div>
            <p className="text-xs font-semibold text-gray-200">Dark</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Always dark</p>
          </button>
          <button onClick={() => changeTheme('auto')} className={`rounded-xl p-3 border-2 transition-colors text-left ${theme === 'auto' ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600'}`}>
            <div className="flex gap-1 mb-2">
              <div className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg, #030712 50%, #f8fafc 50%)' }} />
              <div className="w-4 h-4 rounded bg-orange-500/30 border border-orange-500/50" />
            </div>
            <p className="text-xs font-semibold text-gray-200">Auto</p>
            <p className="text-[10px] text-gray-500 mt-0.5">7am–7pm light</p>
          </button>
          <button onClick={() => changeTheme('light')} className={`rounded-xl p-3 border-2 transition-colors text-left ${theme === 'light' ? 'border-orange-500' : 'border-gray-700 hover:border-gray-600'}`}>
            <div className="flex gap-1 mb-2">
              <div className="w-4 h-4 rounded bg-white border border-gray-300" />
              <div className="w-4 h-4 rounded bg-slate-100 border border-gray-300" />
              <div className="w-4 h-4 rounded bg-slate-200 border border-gray-300" />
            </div>
            <p className="text-xs font-semibold text-gray-200">Light</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Always light</p>
          </button>
        </div>
      </div>

      {/* Coach AI Persona */}
      <div className="bg-gray-900 rounded-xl p-5 space-y-3 border border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Coach AI Persona</h2>
          <p className="text-xs text-gray-500 mt-1">Describe how you want your coach to communicate. Leave blank for the default style.</p>
        </div>
        <textarea
          value={profile.coach_persona ?? ''}
          onChange={e => update('coach_persona', e.target.value)}
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-orange-500"
          placeholder="e.g. Direct and no-nonsense. Skip the encouragement, just give me the numbers and the plan."
        />
      </div>

      <div className="flex justify-end">
        <button onClick={() => save()} disabled={saving} className="px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors">
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save settings'}
        </button>
      </div>
    </PageShell>
  );
}
