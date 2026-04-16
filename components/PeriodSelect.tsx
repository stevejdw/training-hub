'use client';

import { useState, useRef, useEffect } from 'react';
import { PeriodOption } from '@/lib/periods';

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

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find((o) => o.key === value);
  const lineColor = color === 'orange' ? '#f97316' : '#9ca3af';
  const borderColor = color === 'orange' ? 'border-orange-500/50' : 'border-gray-600';
  const activeBg = color === 'orange' ? 'bg-orange-500/20 text-orange-300' : 'bg-gray-700 text-gray-200';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800 border ${borderColor} hover:bg-gray-700 transition-colors text-sm`}
      >
        {/* Line indicator */}
        <svg width="24" height="12" className="flex-shrink-0">
          {color === 'orange' ? (
            <line x1="0" y1="6" x2="24" y2="6" stroke={lineColor} strokeWidth="2.5" />
          ) : (
            <line x1="0" y1="6" x2="24" y2="6" stroke={lineColor} strokeWidth="2" strokeDasharray="5 3" />
          )}
        </svg>
        <span className="text-white font-medium">
          {value === 'none' ? noneLabel : (selected?.label ?? value)}
        </span>
        {selected && value !== 'none' && (
          <span className="text-gray-500 text-xs">{selected.range}</span>
        )}
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-gray-900 border border-gray-700 rounded-xl shadow-xl min-w-[220px] py-1 overflow-hidden">
          {includeNone && (
            <button
              onClick={() => { onChange('none'); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-800 transition-colors ${value === 'none' ? 'text-gray-300 bg-gray-800' : 'text-gray-400'}`}
            >
              {noneLabel}
            </button>
          )}
          {includeNone && <div className="border-t border-gray-800 my-1" />}
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => { onChange(opt.key); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-800 transition-colors flex items-center justify-between gap-4 ${
                value === opt.key ? activeBg : 'text-gray-300'
              }`}
            >
              <span>{opt.label}</span>
              <span className="text-gray-500 text-xs flex-shrink-0">{opt.range}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
