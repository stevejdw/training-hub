'use client';

/** Desktop sub-navigation rail.
 *
 *  This markup was byte-identical in TrainingPage and PerformancePage.
 *
 *  The active state uses text-accent-fg rather than text-ink: text-ink is the
 *  theme's body colour, which is near-black in the light themes and was being
 *  painted on the accent fill. accent-fg is the colour chosen to sit on it. */
export interface RailTab<K extends string> {
  key: K;
  label: string;
}

export default function SideRail<K extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: ReadonlyArray<RailTab<K>>;
  active: K;
  onSelect: (key: K) => void;
}) {
  return (
    <nav className="hidden md:flex flex-col w-44 border-r border-line py-6 px-3 flex-shrink-0 gap-1">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          aria-current={active === key ? 'page' : undefined}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            active === key
              ? 'bg-accent text-accent-fg'
              : 'text-ink-3 hover:text-ink hover:bg-raised'
          }`}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
