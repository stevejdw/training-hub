'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SPORT_FILTER_LABELS, SportFilter, sportLabel, sportColor } from '@/lib/sport-types';
import { useCachedFetch } from '@/lib/use-cached-fetch';
import ActivityCard from '@/components/ActivityCard';
import SettingsGear from '@/components/SettingsGear';

interface ActivitiesResponse {
  activities: Activity[];
  total: number;
  page: number;
  pages: number;
}

interface Activity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  average_watts: number | null;
  normalized_power: number | null;
  average_heartrate: number | null;
  tss: number | null;
  total_elevation_gain: number;
  trainer: boolean;
  gear_id: string | null;
  gear_name: string | null;
  power_meter: string | null;
}

interface GearItem {
  id: string;
  name: string | null;
  nickname: string | null;
  retired: boolean | null;
  activity_count: number;
  power_meter: string | null;
}

interface PowerMeterItem {
  power_meter: string;
  activity_count: number;
}

type SortCol = 'start_date' | 'distance' | 'moving_time' | 'average_watts' | 'average_heartrate' | 'tss';
type SortDir = 'ASC' | 'DESC';

type ColKey = 'distance' | 'moving_time' | 'average_watts' | 'normalized_power' | 'average_heartrate' | 'tss' | 'elevation' | 'power_meter';

const ALL_COLUMNS: { key: ColKey; label: string; defaultOn: boolean }[] = [
  { key: 'distance',          label: 'Distance',    defaultOn: true  },
  { key: 'moving_time',       label: 'Time',        defaultOn: true  },
  { key: 'average_watts',     label: 'Avg W',       defaultOn: true  },
  { key: 'normalized_power',  label: 'NP',          defaultOn: false },
  { key: 'average_heartrate', label: 'Avg HR',      defaultOn: true  },
  { key: 'tss',               label: 'TSS',         defaultOn: true  },
  { key: 'elevation',         label: 'Elevation',   defaultOn: false },
  { key: 'power_meter',       label: 'Power Meter', defaultOn: true  },
];

const DEFAULT_COLS = new Set(ALL_COLUMNS.filter(c => c.defaultOn).map(c => c.key)) as Set<ColKey>;
const COLS_STORAGE_KEY = 'activities-visible-cols-v1';

function loadSavedCols(): Set<ColKey> {
  try {
    const saved = localStorage.getItem(COLS_STORAGE_KEY);
    if (saved) return new Set(JSON.parse(saved) as ColKey[]);
  } catch {}
  return new Set(DEFAULT_COLS);
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}h` : `${m}m`;
}

const TYPE_FILTERS = SPORT_FILTER_LABELS.filter(f => f !== 'All') as SportFilter[];

function SortArrow({ col, sortBy, sortDir }: { col: SortCol; sortBy: SortCol; sortDir: SortDir }) {
  if (sortBy !== col) return <span className="text-ink-5 ml-0.5">↕</span>;
  return <span className="text-accent-hi ml-0.5">{sortDir === 'ASC' ? '↑' : '↓'}</span>;
}

export default function ActivitiesList() {
  const searchParams = useSearchParams();

  // Initialise type filters from URL params (set when navigating from dashboard tiles)
  const [selected, setSelected] = useState<SportFilter[]>(() => {
    const f = searchParams.get('filters');
    if (!f || f === 'All') return [];
    return f.split(',').filter(Boolean) as SportFilter[];
  });

  // Date filter — seed from URL if present (dashboard tile navigation)
  const [dateFrom, setDateFrom] = useState<string>(() => searchParams.get('from') ?? '');
  const [dateTo,   setDateTo]   = useState<string>('');

  // Duration filters
  const [minMins, setMinMins] = useState('');
  const [maxMins, setMaxMins] = useState('');

  // Distance filters (km)
  const [minKm, setMinKm] = useState('');
  const [maxKm, setMaxKm] = useState('');

  // Sort
  const [sortBy,  setSortBy]  = useState<SortCol>('start_date');
  const [sortDir, setSortDir] = useState<SortDir>('DESC');

  // Pagination. The table pages; the mobile card list appends instead —
  // `extra` holds everything loaded past the first page, and `loadedPages`
  // is how far the infinite scroll has got. Both are cleared by resetList()
  // rather than by an effect watching the query, so a filter change can't
  // briefly show the old rides under the new filter.
  const [page, setPage]   = useState(1);
  const [extra, setExtra] = useState<Activity[]>([]);
  const [loadedPages, setLoadedPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  function resetList() {
    setPage(1);
    setExtra([]);
    setLoadedPages(1);
  }

  // Gear filter
  const [gearList,    setGearList]    = useState<GearItem[]>([]);
  const [noGearCount, setNoGearCount] = useState(0);
  const [selectedGear, setSelectedGear] = useState<string[]>(() => {
    const g = searchParams.get('gear');
    return g ? g.split(',').filter(Boolean) : [];
  });
  const [gearDropdownOpen, setGearDropdownOpen] = useState(false);

  // Power meter filter
  const [powerMeterList,     setPowerMeterList]     = useState<PowerMeterItem[]>([]);
  const [selectedPowerMeters, setSelectedPowerMeters] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/gear')
      .then(r => r.json())
      .then(d => {
        setGearList(d.gear ?? []);
        setNoGearCount(d.noGearCount ?? 0);
        setPowerMeterList(d.powerMeters ?? []);
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  function toggleGear(id: string) {
    setSelectedGear(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    resetList();
  }

  function togglePowerMeter(pm: string) {
    setSelectedPowerMeters(prev => prev.includes(pm) ? prev.filter(x => x !== pm) : [...prev, pm]);
    resetList();
  }

  // Close dropdown on outside click
  useEffect(() => {
    if (!gearDropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-gear-dropdown]')) setGearDropdownOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [gearDropdownOpen]);

  async function renameGear(id: string, current: string) {
    const next = window.prompt('Rename gear', current);
    if (!next || next.trim() === current) return;
    const r = await fetch(`/api/gear/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: next.trim() }),
    });
    if (r.ok) {
      const data = await fetch('/api/gear').then(x => x.json());
      setGearList(data.gear ?? []);
      setNoGearCount(data.noGearCount ?? 0);
    }
  }

  async function setPowerMeter(id: string, current: string | null) {
    const next = window.prompt('Power meter (leave blank to clear)', current ?? '');
    if (next === null) return; // cancelled
    const r = await fetch(`/api/gear/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ power_meter: next.trim() || null }),
    });
    if (r.ok) {
      const data = await fetch('/api/gear').then(x => x.json());
      setGearList(data.gear ?? []);
      setNoGearCount(data.noGearCount ?? 0);
    }
  }

  // Column visibility
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() =>
    typeof window !== 'undefined' ? loadSavedCols() : new Set(DEFAULT_COLS)
  );
  const [colPickerOpen, setColPickerOpen] = useState(false);

  function toggleCol(key: ColKey) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  // Filter panel visibility
  const [showFilters, setShowFilters] = useState(false);

  function toggleType(f: SportFilter) {
    setSelected(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
    resetList();
  }

  function clearAll() {
    setSelected([]);
    setSelectedGear([]);
    setSelectedPowerMeters([]);
    setDateFrom('');
    setDateTo('');
    setMinMins('');
    setMaxMins('');
    setMinKm('');
    setMaxKm('');
    resetList();
  }

  function handleSort(col: SortCol) {
    if (sortBy === col) {
      setSortDir(d => d === 'DESC' ? 'ASC' : 'DESC');
    } else {
      setSortBy(col);
      setSortDir('DESC');
    }
    resetList();
  }

  const hasActiveFilters = selected.length > 0 || selectedGear.length > 0 || selectedPowerMeters.length > 0 || dateFrom || dateTo || minMins || maxMins || minKm || maxKm;

  const filtersParam = selected.length > 0 ? selected.join(',') : 'All';
  const queryParams = new URLSearchParams({
    filters: filtersParam,
    page:    String(page),
    sortBy,
    sortDir,
  });
  if (dateFrom) queryParams.set('from',    dateFrom);
  if (dateTo)   queryParams.set('dateTo',  dateTo);
  if (minMins)  queryParams.set('minMins', minMins);
  if (maxMins)  queryParams.set('maxMins', maxMins);
  if (minKm)    queryParams.set('minKm',   minKm);
  if (maxKm)    queryParams.set('maxKm',   maxKm);
  if (selectedGear.length > 0) queryParams.set('gear', selectedGear.join(','));
  if (selectedPowerMeters.length > 0) queryParams.set('powerMeter', selectedPowerMeters.join(','));
  const queryString = queryParams.toString();

  const { data, loading } = useCachedFetch<ActivitiesResponse>(
    `/api/activities?${queryString}`,
    `cache-activities-${queryString}`,
    30 * 60 * 1000,
  );

  // Memoised: it's a dependency of loadMore, and a fresh [] on every
  // render would rebuild the observer callback each time.
  const activities = useMemo(() => data?.activities ?? [], [data]);
  const pages = data?.pages ?? 1;
  const total = data?.total ?? 0;

  /* The card list shows page 1 plus everything infinite scroll has appended.
     The table keeps paging, so both can share one query. */
  const cardItems = [...activities, ...extra];
  const hasMore   = loadedPages < pages;

  const loadMore = useCallback(async () => {
    if (loadingMore || loadedPages >= pages) return;
    setLoadingMore(true);
    const next = loadedPages + 1;
    try {
      const q = new URLSearchParams(queryString);
      q.set('page', String(next));
      const d = await fetch(`/api/activities?${q.toString()}`).then(r => r.json()) as ActivitiesResponse;
      // Filter by id: a ride added by a sync between two page fetches shifts
      // the window and would otherwise repeat a row.
      setExtra(prev => {
        const seen = new Set([...activities, ...prev].map(a => a.id));
        return [...prev, ...(d.activities ?? []).filter(a => !seen.has(a.id))];
      });
      setLoadedPages(next);
    } catch {
      /* Leave loadedPages alone so the sentinel retries on the next scroll. */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loadedPages, pages, queryString, activities]);

  /* A scroll handler on the list rather than an IntersectionObserver on a
     sentinel: the list lives in its own scroll container, and a plain
     distance-to-bottom check behaves identically whether the container or
     the page is what's moving. Fires one page ahead of the end so the next
     batch is usually there before you reach it. */
  function onListScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) void loadMore();
  }

  return (
    <div className="h-full flex flex-col md:max-w-5xl xl:max-w-7xl md:mx-auto md:w-full">

      {/* Top bar */}
      <div className="border-b border-line px-3 py-2.5 flex-shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          {/* Sport filter chips — scrollable, no wrap */}
          <div className="flex gap-1.5 overflow-x-auto flex-1 min-w-0 scrollbar-none">
            {TYPE_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => toggleType(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                  selected.includes(f)
                    ? 'bg-accent text-ink'
                    : 'bg-raised text-ink-3 hover:text-ink hover:bg-hover'
                }`}
              >
                {f}
              </button>
            ))}
            {selected.length > 0 && (
              <button
                onClick={() => { setSelected([]); resetList(); }}
                className="px-2 py-1.5 rounded-lg text-xs text-ink-4 hover:text-ink transition-colors whitespace-nowrap flex-shrink-0"
              >
                ✕
              </button>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!loading && (
              <span className="text-xs text-ink-5">{total.toLocaleString()}</span>
            )}

            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(v => !v)}
              title="More filters"
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                showFilters || hasActiveFilters
                  ? 'bg-accent/20 text-accent-hi border border-accent/50'
                  : 'bg-raised text-ink-3 hover:text-ink'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 8h12M9 12h6M11 16h2" />
              </svg>
            </button>

            {/* Column picker — the table's, so mobile has no use for it */}
            <div className="relative hidden md:block">
              <button
                onClick={() => setColPickerOpen(v => !v)}
                title="Show/hide columns"
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                  colPickerOpen
                    ? 'bg-accent/20 text-accent-hi border border-accent/50'
                    : 'bg-raised text-ink-3 hover:text-ink hover:bg-hover'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </button>
              {colPickerOpen && (
                <div className="absolute right-0 top-10 z-40 w-44 bg-surface border border-line-strong rounded-xl shadow-2xl py-2">
                  <p className="text-micro text-ink-4 uppercase tracking-wider px-3 pb-1.5">Columns</p>
                  {ALL_COLUMNS.map(col => (
                    <button
                      key={col.key}
                      onClick={() => toggleCol(col.key)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-raised transition-colors text-left"
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        visibleCols.has(col.key)
                          ? 'bg-accent border-accent'
                          : 'border-line-hover'
                      }`}>
                        {visibleCols.has(col.key) && (
                          <svg className="w-3 h-3 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className={visibleCols.has(col.key) ? 'text-ink' : 'text-ink-3'}>{col.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Gear — mobile only; above md the page header carries it. */}
            <div className="md:hidden">
              <SettingsGear className="w-8 h-8" />
            </div>

          </div>
        </div>

        {/* Expanded filter panel */}
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {/* Date range */}
            <div className="space-y-1">
              <p className="text-xs text-ink-4 uppercase tracking-wider">Date range</p>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); resetList(); }}
                  className="flex-1 bg-raised border border-line-strong rounded-lg px-2 py-1.5 text-sm text-ink-2 focus:outline-none focus:border-accent"
                  placeholder="From"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); resetList(); }}
                  className="flex-1 bg-raised border border-line-strong rounded-lg px-2 py-1.5 text-sm text-ink-2 focus:outline-none focus:border-accent"
                  placeholder="To"
                />
              </div>
            </div>

            {/* Duration */}
            <div className="space-y-1">
              <p className="text-xs text-ink-4 uppercase tracking-wider">Duration (minutes)</p>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={minMins}
                  onChange={e => { setMinMins(e.target.value); resetList(); }}
                  className="w-20 bg-raised border border-line-strong rounded-lg px-2 py-1.5 text-sm text-ink-2 focus:outline-none focus:border-accent"
                  placeholder="Min"
                  min="0"
                />
                <span className="text-ink-5">–</span>
                <input
                  type="number"
                  value={maxMins}
                  onChange={e => { setMaxMins(e.target.value); resetList(); }}
                  className="w-20 bg-raised border border-line-strong rounded-lg px-2 py-1.5 text-sm text-ink-2 focus:outline-none focus:border-accent"
                  placeholder="Max"
                  min="0"
                />
              </div>
            </div>

            {/* Distance */}
            <div className="space-y-1">
              <p className="text-xs text-ink-4 uppercase tracking-wider">Distance (km)</p>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={minKm}
                  onChange={e => { setMinKm(e.target.value); resetList(); }}
                  className="w-20 bg-raised border border-line-strong rounded-lg px-2 py-1.5 text-sm text-ink-2 focus:outline-none focus:border-accent"
                  placeholder="Min"
                  min="0"
                />
                <span className="text-ink-5">–</span>
                <input
                  type="number"
                  value={maxKm}
                  onChange={e => { setMaxKm(e.target.value); resetList(); }}
                  className="w-20 bg-raised border border-line-strong rounded-lg px-2 py-1.5 text-sm text-ink-2 focus:outline-none focus:border-accent"
                  placeholder="Max"
                  min="0"
                />
              </div>
            </div>

            {/* Gear */}
            {(gearList.length > 0 || noGearCount > 0) && (
              <div className="space-y-1 sm:col-span-2" data-gear-dropdown>
                <p className="text-xs text-ink-4 uppercase tracking-wider">Gear</p>
                <div className="relative">
                  <button
                    onClick={() => setGearDropdownOpen(o => !o)}
                    className="w-full sm:w-72 flex items-center justify-between gap-2 bg-raised border border-line-strong hover:border-line-hover rounded-lg px-3 py-2 text-sm text-left transition-colors"
                  >
                    <span className="text-ink-2 truncate">
                      {selectedGear.length === 0
                        ? 'All gear'
                        : selectedGear.length === 1
                          ? (selectedGear[0] === '__none__'
                              ? 'No gear'
                              : (gearList.find(g => g.id === selectedGear[0])?.nickname
                                  ?? gearList.find(g => g.id === selectedGear[0])?.name
                                  ?? selectedGear[0]))
                          : `${selectedGear.length} selected`}
                    </span>
                    <svg className={`w-4 h-4 text-ink-4 transition-transform ${gearDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {gearDropdownOpen && (
                    <div className="absolute z-30 mt-1 w-full sm:w-72 bg-surface border border-line-strong rounded-lg shadow-2xl py-1 max-h-72 overflow-y-auto">
                      {gearList.map(g => {
                        const label = g.nickname || g.name || g.id;
                        const isOn  = selectedGear.includes(g.id);
                        return (
                          <div
                            key={g.id}
                            className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-raised cursor-pointer ${isOn ? 'text-ink' : 'text-ink-2'}`}
                            onClick={() => toggleGear(g.id)}
                          >
                            <input
                              type="checkbox"
                              checked={isOn}
                              readOnly
                              className="accent-accent flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="truncate">{label}</div>
                              {g.power_meter && (
                                <div className="text-micro text-blue-400/70 truncate">{g.power_meter}</div>
                              )}
                            </div>
                            <span className="text-xs text-ink-4 flex-shrink-0">{g.activity_count}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); renameGear(g.id, label); }}
                              className="text-ink-5 hover:text-accent-hi transition-colors flex-shrink-0"
                              title="Rename gear"
                              aria-label="Rename gear"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setPowerMeter(g.id, g.power_meter); }}
                              className={`transition-colors flex-shrink-0 ${g.power_meter ? 'text-blue-400/70 hover:text-blue-400' : 'text-ink-5 hover:text-blue-400'}`}
                              title={g.power_meter ? `Power meter: ${g.power_meter}` : 'Set power meter'}
                              aria-label="Set power meter"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                      {noGearCount > 0 && (
                        <div
                          className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-raised cursor-pointer border-t border-line ${selectedGear.includes('__none__') ? 'text-ink' : 'text-ink-2'}`}
                          onClick={() => toggleGear('__none__')}
                        >
                          <input
                            type="checkbox"
                            checked={selectedGear.includes('__none__')}
                            readOnly
                            className="accent-accent flex-shrink-0"
                          />
                          <span className="flex-1 italic text-ink-3">No gear</span>
                          <span className="text-xs text-ink-4 flex-shrink-0">{noGearCount}</span>
                        </div>
                      )}
                      {selectedGear.length > 0 && (
                        <div className="border-t border-line px-3 py-1.5">
                          <button
                            onClick={() => { setSelectedGear([]); resetList(); }}
                            className="text-xs text-ink-4 hover:text-accent-hi transition-colors"
                          >
                            Clear gear
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Power Meter filter */}
            {powerMeterList.length > 0 && (
              <div className="space-y-1 sm:col-span-2">
                <p className="text-xs text-ink-4 uppercase tracking-wider">Power Meter</p>
                <div className="flex flex-wrap gap-2">
                  {powerMeterList.map(pm => {
                    const isOn = selectedPowerMeters.includes(pm.power_meter);
                    return (
                      <button
                        key={pm.power_meter}
                        onClick={() => togglePowerMeter(pm.power_meter)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          isOn
                            ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                            : 'bg-raised text-ink-3 hover:text-ink hover:bg-hover'
                        }`}
                      >
                        {pm.power_meter}
                        <span className="text-ink-4">{pm.activity_count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Clear all */}
            {hasActiveFilters && (
              <div className="sm:col-span-2">
                <button
                  onClick={clearAll}
                  className="text-xs text-ink-4 hover:text-ink transition-colors"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile: cards. A 600px-wide table on a 375px screen meant sideways
          scrolling and truncated names; this is the same card the Home feed
          uses, with infinite scroll instead of 67 pages of Prev/Next. */}
      <div
        onScroll={onListScroll}
        className="md:hidden flex-1 overflow-y-auto scroll-touch px-3 py-3 space-y-3 pb-nav"
      >
        {loading && cardItems.length === 0
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-raised/50 animate-pulse" />
            ))
          : cardItems.map(a => <ActivityCard key={a.id} ride={a} />)}

        {!loading && cardItems.length === 0 && (
          <div className="flex h-32 items-center justify-center text-sm text-ink-4">
            No activities match your filters
          </div>
        )}

        {loadingMore && (
          <div className="py-3 text-center text-xs text-ink-4">Loading more…</div>
        )}
        {!hasMore && cardItems.length > 0 && (
          <div className="py-3 text-center text-xs text-ink-5">
            {total.toLocaleString()} activities · that&apos;s all of them
          </div>
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block flex-1 overflow-auto scroll-touch">
        <table className="min-w-[600px] w-full text-sm">
          <thead className="sticky top-0 bg-surface border-b border-line">
            <tr>
              <th
                className="text-left px-4 py-3 text-ink-3 font-medium cursor-pointer hover:text-ink select-none whitespace-nowrap"
                onClick={() => handleSort('start_date')}
              >
                Date <SortArrow col="start_date" sortBy={sortBy} sortDir={sortDir} />
              </th>
              <th className="text-left px-4 py-3 text-ink-3 font-medium">Type</th>
              <th className="text-left px-4 py-3 text-ink-3 font-medium">Name</th>
              {visibleCols.has('distance') && (
                <th className="text-right px-4 py-3 text-ink-3 font-medium cursor-pointer hover:text-ink select-none whitespace-nowrap" onClick={() => handleSort('distance')}>
                  Dist <SortArrow col="distance" sortBy={sortBy} sortDir={sortDir} />
                </th>
              )}
              {visibleCols.has('moving_time') && (
                <th className="text-right px-4 py-3 text-ink-3 font-medium cursor-pointer hover:text-ink select-none whitespace-nowrap" onClick={() => handleSort('moving_time')}>
                  Time <SortArrow col="moving_time" sortBy={sortBy} sortDir={sortDir} />
                </th>
              )}
              {visibleCols.has('average_watts') && (
                <th className="text-right px-4 py-3 text-ink-3 font-medium cursor-pointer hover:text-ink select-none whitespace-nowrap" onClick={() => handleSort('average_watts')}>
                  Avg W <SortArrow col="average_watts" sortBy={sortBy} sortDir={sortDir} />
                </th>
              )}
              {visibleCols.has('normalized_power') && (
                <th className="text-right px-4 py-3 text-ink-3 font-medium whitespace-nowrap">NP</th>
              )}
              {visibleCols.has('average_heartrate') && (
                <th className="text-right px-4 py-3 text-ink-3 font-medium cursor-pointer hover:text-ink select-none whitespace-nowrap" onClick={() => handleSort('average_heartrate')}>
                  Avg HR <SortArrow col="average_heartrate" sortBy={sortBy} sortDir={sortDir} />
                </th>
              )}
              {visibleCols.has('tss') && (
                <th className="text-right px-4 py-3 text-ink-3 font-medium cursor-pointer hover:text-ink select-none whitespace-nowrap" onClick={() => handleSort('tss')}>
                  TSS <SortArrow col="tss" sortBy={sortBy} sortDir={sortDir} />
                </th>
              )}
              {visibleCols.has('elevation') && (
                <th className="text-right px-4 py-3 text-ink-3 font-medium whitespace-nowrap">Elev</th>
              )}
              {visibleCols.has('power_meter') && (
                <th className="text-left px-4 py-3 text-ink-3 font-medium whitespace-nowrap">Power Meter</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-line/50">
                    {Array.from({ length: 3 + visibleCols.size }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-raised rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : activities.map(a => {
                  const date = new Date(a.start_date);
                  const color = sportColor(a.sport_type);
                  return (
                    <tr key={a.id} className="border-b border-line/50 hover:bg-raised/40 transition-colors">
                      <td className="px-4 py-3 text-ink-3 whitespace-nowrap">
                        {date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-medium"
                          style={{ background: color + '20', color }}
                        >
                          {sportLabel(a.sport_type)}{a.trainer ? ' 🏠' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/activities/${a.id}`}
                          className="text-ink hover:text-accent-hi transition-colors line-clamp-1"
                        >
                          {a.name}
                        </Link>
                      </td>
                      {visibleCols.has('distance') && (
                        <td className="px-4 py-3 text-right text-ink-2">
                          {a.distance > 0 ? `${(a.distance / 1000).toFixed(1)}` : '—'}
                        </td>
                      )}
                      {visibleCols.has('moving_time') && (
                        <td className="px-4 py-3 text-right text-ink-2">{fmt(a.moving_time)}</td>
                      )}
                      {visibleCols.has('average_watts') && (
                        <td className="px-4 py-3 text-right text-ink-2">
                          {a.average_watts ? `${Math.round(a.average_watts)}W` : '—'}
                        </td>
                      )}
                      {visibleCols.has('normalized_power') && (
                        <td className="px-4 py-3 text-right text-ink-2">
                          {a.normalized_power ? `${Math.round(a.normalized_power)}W` : '—'}
                        </td>
                      )}
                      {visibleCols.has('average_heartrate') && (
                        <td className="px-4 py-3 text-right text-ink-2">
                          {a.average_heartrate ? Math.round(a.average_heartrate) : '—'}
                        </td>
                      )}
                      {visibleCols.has('tss') && (
                        <td className="px-4 py-3 text-right text-ink-2">
                          {a.tss ? Math.round(a.tss) : '—'}
                        </td>
                      )}
                      {visibleCols.has('elevation') && (
                        <td className="px-4 py-3 text-right text-ink-2">
                          {a.total_elevation_gain > 0 ? `${Math.round(a.total_elevation_gain)}m` : '—'}
                        </td>
                      )}
                      {visibleCols.has('power_meter') && (
                        <td className="px-4 py-3 text-left whitespace-nowrap">
                          {a.power_meter
                            ? <span className="text-blue-400/80 text-xs">{a.power_meter}</span>
                            : <span className="text-ink-5">—</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
          </tbody>
        </table>

        {!loading && activities.length === 0 && (
          <div className="flex items-center justify-center h-32 text-ink-4 text-sm">
            No activities match your filters
          </div>
        )}
      </div>

      {/* Pagination — desktop only; mobile scrolls. */}
      {pages > 1 && (
        <div className="hidden md:flex border-t border-line px-4 py-3 items-center justify-between flex-shrink-0">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-sm bg-raised text-ink-3 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-sm text-ink-4">Page {page} of {pages}</span>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="px-3 py-1.5 rounded-lg text-sm bg-raised text-ink-3 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
