'use client';

import { useState, useRef, useEffect } from 'react';
import { PeriodOption } from '@/lib/periods';
import { CHART } from '@/lib/chart-theme';

interface Props {
  options: PeriodOption[];
  value: string;
  onChange: (key: string) => void;
  color: 'orange' | 'gray';
  includeNone?: boolean;
  noneLabel?: string;
}

export default function PeriodSelect({ options, value, onChange, color, includeNone, noneLabel = 'None' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    /* Escape had no handler at all: keyboard users could open the menu but
       only close it by clicking elsewhere. Focus returns to the trigger. */
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.key === value);
  const lineColor = color === 'orange' ? CHART.power : CHART.reference;
  const borderColor = color === 'orange' ? 'border-accent/50' : 'border-line-hover';
  const activeBg = color === 'orange' ? 'bg-accent/20 text-accent-hi' : 'bg-hover text-ink';

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-raised border ${borderColor} hover:bg-hover transition-colors text-sm`}
      >
        {/* Line indicator */}
        <svg width="24" height="12" className="flex-shrink-0">
          {color === 'orange' ? (
            <line x1="0" y1="6" x2="24" y2="6" stroke={lineColor} strokeWidth="2.5" />
          ) : (
            <line x1="0" y1="6" x2="24" y2="6" stroke={lineColor} strokeWidth="2" strokeDasharray="5 3" />
          )}
        </svg>
        <span className="text-ink font-medium">
          {value === 'none' ? noneLabel : (selected?.label ?? value)}
        </span>
        {selected && value !== 'none' && (
          <span className="text-ink-4 text-xs">{selected.range}</span>
        )}
        <svg className={`w-4 h-4 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div role="listbox" className="absolute top-full mt-1 left-0 z-50 bg-surface border border-line-strong rounded-xl shadow-xl min-w-[220px] py-1 overflow-hidden">
          {includeNone && (
            <button
              onClick={() => { onChange('none'); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-raised transition-colors ${value === 'none' ? 'text-ink-2 bg-raised' : 'text-ink-3'}`}
            >
              {noneLabel}
            </button>
          )}
          {includeNone && <div className="border-t border-line my-1" />}
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => { onChange(opt.key); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-raised transition-colors flex items-center justify-between gap-4 ${
                value === opt.key ? activeBg : 'text-ink-2'
              }`}
            >
              <span>{opt.label}</span>
              <span className="text-ink-4 text-xs flex-shrink-0">{opt.range}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
