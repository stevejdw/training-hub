'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ALL_NAV_ITEMS } from '@/components/nav-items';
import { getThemePreference, setThemePreference, type ThemePreference } from '@/components/ThemeProvider';
import { useIsDesktop } from './useIsDesktop';

const THEME_CYCLE: ThemePreference[] = ['dark', 'light', 'ocean', 'ocean-light', 'sand-dark', 'sand'];

// g-then-key navigation shortcuts (desktop only)
const G_SHORTCUTS: Record<string, string> = {
  h: '/home', a: '/activities', p: '/training?tab=power',
  t: '/training', e: '/events', c: '/chat',
};

interface ActivityHit {
  id: number;
  name: string;
  start_date: string;
  distance: number;
  tss: number | null;
}

interface Command {
  key: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  run: () => void;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** ⌘K command palette: navigation, quick actions, activity search.
 *  Mounted once in the root layout; keyboard shortcuts are active only
 *  at the lg+ desktop breakpoint so the iOS WebView never sees them. */
export default function CommandPalette() {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [hits, setHits] = useState<ActivityHit[]>([]);
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done'>('idle');
  const gPressedAt = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelected(0);
    setHits([]);
  }, []);

  // Sync the native <dialog> with open state
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      inputRef.current?.focus();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  // Global shortcuts — attached only on desktop
  useEffect(() => {
    if (!isDesktop) return;

    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        return;
      }
      if (open || isEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'g') { gPressedAt.current = Date.now(); return; }
      if (Date.now() - gPressedAt.current < 1000 && G_SHORTCUTS[e.key]) {
        gPressedAt.current = 0;
        router.push(G_SHORTCUTS[e.key]);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDesktop, open, router]);

  // Debounced activity search
  useEffect(() => {
    if (!open || query.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/activities?q=${encodeURIComponent(query.trim())}`)
        .then(r => r.ok ? r.json() : { activities: [] })
        .then(d => setHits((d.activities ?? []).slice(0, 6)))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [open, query]);

  const commands: Command[] = useMemo(() => {
    const nav: Command[] = ALL_NAV_ITEMS
      .filter(i => i.key !== 'more')
      .map(i => ({
        key: `nav-${i.key}`,
        label: i.label,
        hint: 'Go to',
        icon: i.icon,
        run: () => { router.push(i.href); close(); },
      }));

    const actions: Command[] = [
      {
        key: 'action-theme',
        label: 'Cycle theme',
        hint: 'Action',
        run: () => {
          const cur = getThemePreference();
          const idx = THEME_CYCLE.indexOf(cur as ThemePreference);
          setThemePreference(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
        },
      },
      {
        key: 'action-sync',
        label: syncState === 'syncing' ? 'Syncing Strava…' : syncState === 'done' ? 'Strava synced ✓' : 'Sync Strava',
        hint: 'Action',
        run: () => {
          if (syncState === 'syncing') return;
          setSyncState('syncing');
          fetch('/api/sync', { method: 'POST' })
            .then(() => setSyncState('done'))
            .catch(() => setSyncState('idle'));
        },
      },
      {
        key: 'action-chat',
        label: 'New coach chat',
        hint: 'Action',
        run: () => { router.push('/chat'); close(); },
      },
    ];

    const q = query.trim().toLowerCase();
    const base = [...nav, ...actions].filter(c => !q || c.label.toLowerCase().includes(q));

    const activityCmds: Command[] = hits.map(h => ({
      key: `activity-${h.id}`,
      label: h.name,
      hint: `${new Date(h.start_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })} · ${(h.distance / 1000).toFixed(0)} km${h.tss != null ? ` · ${Math.round(h.tss)} TSS` : ''}`,
      run: () => { router.push(`/activities/${h.id}`); close(); },
    }));

    return [...base, ...activityCmds];
  }, [query, hits, syncState, router, close]);

  // Clamp selection when the list changes
  useEffect(() => {
    setSelected(s => Math.min(s, Math.max(0, commands.length - 1)));
  }, [commands.length]);

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, commands.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); commands[selected]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  // Keep the selected row in view
  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <dialog
      ref={dialogRef}
      onClose={close}
      onCancel={close}
      onMouseDown={e => { if (e.target === dialogRef.current) close(); }}
      className="m-0 p-0 bg-transparent backdrop:bg-black/60 fixed left-1/2 top-24 -translate-x-1/2 w-full max-w-xl"
    >
      <div className="bg-surface border border-line-strong rounded-xl shadow-2xl overflow-hidden">
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(0); }}
          onKeyDown={onInputKeyDown}
          placeholder="Search pages, actions, activities…"
          className="w-full bg-transparent px-4 py-3.5 text-sm text-ink placeholder-ink-4 focus:outline-none border-b border-line"
        />
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1.5">
          {commands.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-4 text-center">No matches</p>
          ) : commands.map((c, i) => (
            <button
              key={c.key}
              onClick={() => c.run()}
              onMouseEnter={() => setSelected(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                i === selected ? 'bg-accent/15 text-ink' : 'text-ink-2'
              }`}
            >
              {c.icon && <span className="text-ink-4 [&>svg]:w-4 [&>svg]:h-4">{c.icon}</span>}
              <span className="flex-1 truncate">{c.label}</span>
              {c.hint && <span className="text-micro text-ink-4 flex-shrink-0">{c.hint}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 px-4 py-2 border-t border-line text-micro text-ink-5">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span className="ml-auto">g then h/a/p/t/e/c for quick nav</span>
        </div>
      </div>
    </dialog>
  );
}
