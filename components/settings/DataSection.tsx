'use client';

import { useEffect, useState } from 'react';
import { ActionButton, Group, Log, StatTriptych } from './ui';
import { fmtDate } from './ConnectionsSection';

interface HistoryStatus {
  total: number;
  oldestDate: string | null;
  newestDate: string | null;
  oldestEpoch: number;
}

export default function DataSection() {
  const [history, setHistory]     = useState<HistoryStatus | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importLog, setImportLog]   = useState<string[]>([]);
  const [syncBusy, setSyncBusy]     = useState(false);
  const [syncLog, setSyncLog]       = useState<string[]>([]);
  const [pmBusy, setPmBusy]         = useState(false);
  const [pmLog, setPmLog]           = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/strava/history')
      .then(r => r.json())
      .then((d: HistoryStatus) => setHistory(d))
      .catch(() => {});
  }, []);

  async function runRecentSync() {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncLog([]);
    async function doSync(): Promise<{ synced?: number; error?: string }> {
      const r = await fetch('/api/sync', { method: 'POST' });
      const text = await r.text();
      try { return JSON.parse(text) as { synced?: number; error?: string }; }
      catch { throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`); }
    }
    try {
      let d: { synced?: number; error?: string };
      try { d = await doSync(); if (d.error) throw new Error(d.error); }
      catch {
        await new Promise(res => setTimeout(res, 500));
        d = await doSync();
        if (d.error) throw new Error(d.error);
      }
      setSyncLog([d.synced === 0 ? 'Already up to date' : `Synced ${d.synced} new activit${d.synced === 1 ? 'y' : 'ies'}`]);
    } catch (err) {
      setSyncLog([`Failed: ${String(err)}`]);
    } finally {
      setSyncBusy(false);
    }
  }

  async function runHistoryImport() {
    if (importBusy) return;
    setImportBusy(true);
    setImportLog([]);

    let before: number | undefined = history?.oldestEpoch || undefined;
    let totalSynced = 0;
    let finished = false;

    try {
      // Cap at 10 batches (1 000 activities) per press so the loop can't run
      // away in the browser.
      for (let pass = 0; pass < 10; pass++) {
        const res  = await fetch('/api/strava/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(before ? { before } : {}),
        });
        const data = await res.json() as {
          synced: number; hasMore: boolean; nextBefore: number | null;
          oldestDate: string | null; error?: string;
        };

        if (data.error) { setImportLog(l => [...l, `Error: ${data.error}`]); break; }

        totalSynced += data.synced;
        setImportLog(l => [
          ...l,
          `Imported ${data.synced} activities${data.oldestDate ? ` (oldest: ${fmtDate(data.oldestDate)})` : ''}`,
        ]);

        if (!data.hasMore || !data.nextBefore) {
          setImportLog(l => [...l, `Done — ${totalSynced} activities imported total.`]);
          finished = true;
          break;
        }
        before = data.nextBefore;
      }

      // Loop-local rather than state: setState is async, so reading state here
      // would always see the stale value and wrongly report a pause.
      if (!finished && totalSynced > 0) {
        setImportLog(l => [...l, 'Paused after 1 000 activities. Press Import again to continue.']);
      }

      setHistory(await fetch('/api/strava/history').then(r => r.json()) as HistoryStatus);
    } catch (err) {
      setImportLog(l => [...l, `Failed: ${String(err)}`]);
    } finally {
      setImportBusy(false);
    }
  }

  async function runPmBackfill() {
    if (pmBusy) return;
    setPmBusy(true);
    setPmLog([]);
    try {
      const res = await fetch('/api/activities/backfill-power-meter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await res.json() as { updated?: number; icu_with_power_meter?: number; error?: string };
      if (d.error) throw new Error(d.error);
      setPmLog([(d.updated ?? 0) > 0
        ? `Updated ${d.updated} of ${d.icu_with_power_meter} activities with power meter data`
        : `Already up to date — ${d.icu_with_power_meter ?? 0} activities have power meter data`]);
    } catch (err) {
      setPmLog([`Failed: ${String(err)}`]);
    } finally {
      setPmBusy(false);
    }
  }

  return (
    <>
      <Group title="Stored activities">
        <div className="px-4 py-3.5">
          {history ? (
            <StatTriptych
              stats={[
                { label: 'Stored', value: history.total.toLocaleString() },
                { label: 'Newest', value: fmtDate(history.newestDate) },
                { label: 'Oldest', value: fmtDate(history.oldestDate) },
              ]}
            />
          ) : (
            <p className="text-xs text-ink-5">Loading…</p>
          )}
        </div>
      </Group>

      <Group title="Sync" footer="Recent sync pulls the last few weeks. Import older reaches further back, up to 1 000 activities per press, oldest first.">
        <div className="space-y-2 px-4 py-3.5">
          <ActionButton onClick={() => void runRecentSync()} busy={syncBusy} busyLabel="Syncing…">
            Sync recent activities
          </ActionButton>
          <Log lines={syncLog} />
        </div>
        <div className="space-y-2 px-4 py-3.5">
          <ActionButton onClick={() => void runHistoryImport()} busy={importBusy} busyLabel="Importing…">
            Import older activities
          </ActionButton>
          <Log lines={importLog} />
        </div>
        <div className="space-y-2 px-4 py-3.5">
          <ActionButton onClick={() => void runPmBackfill()} busy={pmBusy} busyLabel="Syncing…">
            Backfill power meter names
          </ActionButton>
          <Log lines={pmLog} />
        </div>
      </Group>
    </>
  );
}
