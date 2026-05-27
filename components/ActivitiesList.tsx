'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { SPORT_FILTER_LABELS, SportFilter, sportLabel, sportColor } from '@/lib/sport-types';
import { useCachedFetch } from '@/lib/use-cached-fetch';

interface ActivitiesResponse {
  activities: Activity[];
  total: number;
  page: number;
  pages: number;
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000; // seconds
  if (diff < 60)         return 'just now';
  if (diff < 3600)       return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)      return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7)  return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
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

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}h` : `${m}m`;
}

const TYPE_FILTERS = SPORT_FILTER_LABELS.filter(f => f !== 'All') as SportFilter[];

function SortArrow({ col, sortBy, sortDir }: { col: SortCol; sortBy: SortCol; sortDir: SortDir }) {
  if (sortBy !== col) return <span className="text-gray-700 ml-0.5">↕</span>;
  return <span className="text-orange-400 ml-0.5">{sortDir === 'ASC' ? '↑' : '↓'}</span>;
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

  // Pagination
  const [page, setPage]   = useState(1);

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
    setPage(1);
  }

  function togglePowerMeter(pm: string) {
    setSelectedPowerMeters(prev => prev.includes(pm) ? prev.filter(x => x !== pm) : [...prev, pm]);
    setPage(1);
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

  // Filter panel visibility
  const [showFilters, setShowFilters] = useState(false);

  // Power meter backfill state
  const [pmSyncing, setPmSyncing] = useState(false);
  const [pmResult,  setPmResult]  = useState<string | null>(null);

  async function handlePowerMeterSync() {
    if (pmSyncing) return;
    setPmSyncing(true);
    setPmResult(null);
    try {
      const res = await fetch('/api/activities/backfill-power-meter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await res.json() as {
        updated?: number; no_match?: number; icu_with_power_meter?: number;
        total_icu?: number; error?: string;
      };
      if (d.error) throw new Error(d.error);
      if ((d.updated ?? 0) > 0) {
        setPmResult(`✓ Updated ${d.updated} of ${d.icu_with_power_meter} activities with power meter data`);
        setPage(1);
        setSelected(prev => [...prev]);
      } else {
        setPmResult(`Already up to date — ${d.icu_with_power_meter ?? 0} activities have power meter data`);
      }
    } catch (err) {
      setPmResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPmSyncing(false);
      setTimeout(() => setPmResult(null), 30000);
    }
  }

  // Manual sync state
  const [syncing,     setSyncing]     = useState(false);
  const [syncResult,  setSyncResult]  = useState<string | null>(null);
  const [lastSync,    setLastSync]    = useState<string | null>(null);

  // Fetch last-synced timestamp on mount and after every manual sync
  const refreshLastSync = useCallback(async () => {
    try {
      const r = await fetch('/api/sync', { method: 'GET' });
      const d = await r.json() as { last_sync: string | null };
      setLastSync(d.last_sync);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { refreshLastSync(); }, [refreshLastSync]);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);

    // Cold-lambda + cold-Neon-SSL sometimes makes the first request flake.
    // Retry once silently before surfacing an error.
    async function doSync(): Promise<{ synced?: number; names?: string[]; error?: string }> {
      const r = await fetch('/api/sync', { method: 'POST' });
      const text = await r.text();
      try {
        return JSON.parse(text) as { synced?: number; names?: string[]; error?: string };
      } catch {
        throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
    }

    let d: { synced?: number; names?: string[]; error?: string };
    try {
      try {
        d = await doSync();
        if (d.error) throw new Error(d.error);
      } catch {
        // warm the lambda and retry once
        await new Promise(res => setTimeout(res, 500));
        d = await doSync();
        if (d.error) throw new Error(d.error);
      }
      if (d.synced === 0) {
        setSyncResult('Already up to date');
      } else {
        setSyncResult(`✓ Synced ${d.synced} new activit${d.synced === 1 ? 'y' : 'ies'}`);
        // Refresh the list
        setPage(1);
        setSelected(prev => [...prev]); // trigger re-fetch
      }
      refreshLastSync();
    } catch (err) {
      setSyncResult(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 6000);
    }
  }

  function toggleType(f: SportFilter) {
    setSelected(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
    setPage(1);
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
    setPage(1);
  }

  function handleSort(col: SortCol) {
    if (sortBy === col) {
      setSortDir(d => d === 'DESC' ? 'ASC' : 'DESC');
    } else {
      setSortBy(col);
      setSortDir('DESC');
    }
    setPage(1);
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

  const activities = data?.activities ?? [];
  const pages = data?.pages ?? 1;
  const total = data?.total ?? 0;

  return (
    <div className="h-full flex flex-col md:max-w-5xl md:mx-auto md:w-full">

      {/* Fixed-position toast for power meter sync result */}
      {pmResult && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium max-w-sm w-max text-center
            ${pmResult.startsWith('Failed')
              ? 'bg-red-900 text-red-200 border border-red-600'
              : 'bg-green-900 text-green-200 border border-green-600'}`}
        >
          {pmResult}
        </div>
      )}

      {/* Top bar */}
      <div className="border-b border-gray-800 px-3 py-2.5 flex-shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          {/* Sport filter chips — scrollable, no wrap */}
          <div className="flex gap-1.5 overflow-x-auto flex-1 min-w-0 scrollbar-none">
            {TYPE_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => toggleType(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                  selected.includes(f)
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {f}
              </button>
            ))}
            {selected.length > 0 && (
              <button
                onClick={() => { setSelected([]); setPage(1); }}
                className="px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-white transition-colors whitespace-nowrap flex-shrink-0"
              >
                ✕
              </button>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!loading && (
              <span className="text-xs text-gray-600">{total.toLocaleString()}</span>
            )}

            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(v => !v)}
              title="More filters"
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                showFilters || hasActiveFilters
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 8h12M9 12h6M11 16h2" />
              </svg>
            </button>

            {/* Last-synced indicator */}
            {lastSync && (
              <span
                className="text-[11px] text-gray-500 whitespace-nowrap"
                title={new Date(lastSync).toLocaleString()}
              >
                Synced {timeAgo(lastSync)}
              </span>
            )}

            {/* Power meter sync */}
            <button
              onClick={handlePowerMeterSync}
              disabled={pmSyncing}
              title={pmSyncing ? 'Syncing power meter data…' : 'Sync power meter data from intervals.icu'}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                pmSyncing
                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-800 text-blue-400/60 hover:text-blue-400 hover:bg-gray-700'
              }`}
            >
              <svg
                className={`w-4 h-4 ${pmSyncing ? 'animate-pulse' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </button>

            {/* Sync */}
            <button
              onClick={handleSync}
              disabled={syncing}
              title={syncing ? 'Syncing…' : 'Sync from Strava'}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                syncing
                  ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              <svg
                className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {syncResult && (
          <p className={`text-xs ${syncResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
            {syncResult}
          </p>
        )}

        {/* Expanded filter panel */}
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {/* Date range */}
            <div className="space-y-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Date range</p>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-orange-500"
                  placeholder="From"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setPage(1); }}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-orange-500"
                  placeholder="To"
                />
              </div>
            </div>

            {/* Duration */}
            <div className="space-y-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Duration (minutes)</p>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={minMins}
                  onChange={e => { setMinMins(e.target.value); setPage(1); }}
                  className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-orange-500"
                  placeholder="Min"
                  min="0"
                />
                <span className="text-gray-600">–</span>
                <input
                  type="number"
                  value={maxMins}
                  onChange={e => { setMaxMins(e.target.value); setPage(1); }}
                  className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-orange-500"
                  placeholder="Max"
                  min="0"
                />
              </div>
            </div>

            {/* Distance */}
            <div className="space-y-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Distance (km)</p>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={minKm}
                  onChange={e => { setMinKm(e.target.value); setPage(1); }}
                  className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-orange-500"
                  placeholder="Min"
                  min="0"
                />
                <span className="text-gray-600">–</span>
                <input
                  type="number"
                  value={maxKm}
                  onChange={e => { setMaxKm(e.target.value); setPage(1); }}
                  className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-orange-500"
                  placeholder="Max"
                  min="0"
                />
              </div>
            </div>

            {/* Gear */}
            {(gearList.length > 0 || noGearCount > 0) && (
              <div className="space-y-1 sm:col-span-2" data-gear-dropdown>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Gear</p>
                <div className="relative">
                  <button
                    onClick={() => setGearDropdownOpen(o => !o)}
                    className="w-full sm:w-72 flex items-center justify-between gap-2 bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-lg px-3 py-2 text-sm text-left transition-colors"
                  >
                    <span className="text-gray-300 truncate">
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
                    <svg className={`w-4 h-4 text-gray-500 transition-transform ${gearDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {gearDropdownOpen && (
                    <div className="absolute z-30 mt-1 w-full sm:w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl py-1 max-h-72 overflow-y-auto">
                      {gearList.map(g => {
                        const label = g.nickname || g.name || g.id;
                        const isOn  = selectedGear.includes(g.id);
                        return (
                          <div
                            key={g.id}
                            className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-800 cursor-pointer ${isOn ? 'text-white' : 'text-gray-300'}`}
                            onClick={() => toggleGear(g.id)}
                          >
                            <input
                              type="checkbox"
                              checked={isOn}
                              readOnly
                              className="accent-orange-500 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="truncate">{label}</div>
                              {g.power_meter && (
                                <div className="text-[10px] text-blue-400/70 truncate">{g.power_meter}</div>
                              )}
                            </div>
                            <span className="text-xs text-gray-500 flex-shrink-0">{g.activity_count}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); renameGear(g.id, label); }}
                              className="text-gray-600 hover:text-orange-400 transition-colors flex-shrink-0"
                              title="Rename gear"
                              aria-label="Rename gear"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setPowerMeter(g.id, g.power_meter); }}
                              className={`transition-colors flex-shrink-0 ${g.power_meter ? 'text-blue-400/70 hover:text-blue-400' : 'text-gray-600 hover:text-blue-400'}`}
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
                          className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-800 cursor-pointer border-t border-gray-800 ${selectedGear.includes('__none__') ? 'text-white' : 'text-gray-300'}`}
                          onClick={() => toggleGear('__none__')}
                        >
                          <input
                            type="checkbox"
                            checked={selectedGear.includes('__none__')}
                            readOnly
                            className="accent-orange-500 flex-shrink-0"
                          />
                          <span className="flex-1 italic text-gray-400">No gear</span>
                          <span className="text-xs text-gray-500 flex-shrink-0">{noGearCount}</span>
                        </div>
                      )}
                      {selectedGear.length > 0 && (
                        <div className="border-t border-gray-800 px-3 py-1.5">
                          <button
                            onClick={() => { setSelectedGear([]); setPage(1); }}
                            className="text-xs text-gray-500 hover:text-orange-400 transition-colors"
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
                <p className="text-xs text-gray-500 uppercase tracking-wider">Power Meter</p>
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
                            : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                      >
                        {pm.power_meter}
                        <span className="text-gray-500">{pm.activity_count}</span>
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
                  className="text-xs text-gray-500 hover:text-white transition-colors"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto scroll-touch">
        <table className="min-w-[600px] w-full text-sm">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              <th
                className="text-left px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none whitespace-nowrap"
                onClick={() => handleSort('start_date')}
              >
                Date <SortArrow col="start_date" sortBy={sortBy} sortDir={sortDir} />
              </th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Type</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Name</th>
              <th
                className="text-right px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none whitespace-nowrap"
                onClick={() => handleSort('distance')}
              >
                Dist <SortArrow col="distance" sortBy={sortBy} sortDir={sortDir} />
              </th>
              <th
                className="text-right px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none whitespace-nowrap"
                onClick={() => handleSort('moving_time')}
              >
                Time <SortArrow col="moving_time" sortBy={sortBy} sortDir={sortDir} />
              </th>
              <th
                className="text-right px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none whitespace-nowrap"
                onClick={() => handleSort('average_watts')}
              >
                Avg W <SortArrow col="average_watts" sortBy={sortBy} sortDir={sortDir} />
              </th>
              <th
                className="text-right px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none whitespace-nowrap"
                onClick={() => handleSort('average_heartrate')}
              >
                Avg HR <SortArrow col="average_heartrate" sortBy={sortBy} sortDir={sortDir} />
              </th>
              <th
                className="text-right px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none whitespace-nowrap"
                onClick={() => handleSort('tss')}
              >
                TSS <SortArrow col="tss" sortBy={sortBy} sortDir={sortDir} />
              </th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium whitespace-nowrap">Power Meter</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : activities.map(a => {
                  const date = new Date(a.start_date);
                  const color = sportColor(a.sport_type);
                  return (
                    <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
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
                          className="text-white hover:text-orange-400 transition-colors line-clamp-1"
                        >
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {a.distance > 0 ? `${(a.distance / 1000).toFixed(1)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">{fmt(a.moving_time)}</td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {a.average_watts ? `${Math.round(a.average_watts)}W` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {a.average_heartrate ? Math.round(a.average_heartrate) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {a.tss ? Math.round(a.tss) : '—'}
                      </td>
                      <td className="px-4 py-3 text-left whitespace-nowrap">
                        {a.power_meter
                          ? <span className="text-blue-400/80 text-xs">{a.power_meter}</span>
                          : <span className="text-gray-700">—</span>}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>

        {!loading && activities.length === 0 && (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
            No activities match your filters
          </div>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="border-t border-gray-800 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500">Page {page} of {pages}</span>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
