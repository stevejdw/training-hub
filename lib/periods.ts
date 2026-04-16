export interface PeriodOption {
  key: string;
  label: string;
  range: string; // date range string e.g. "3/9 – 4/16"
}

function fmt(d: Date) {
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function buildPeriodOptions(): PeriodOption[] {
  const now = new Date();
  const sub = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d;
  };

  const relative: PeriodOption[] = [
    { key: '4w',  label: 'Last 4 weeks',  range: `${fmt(sub(28))} – ${fmt(now)}` },
    { key: '6w',  label: 'Last 6 weeks',  range: `${fmt(sub(42))} – ${fmt(now)}` },
    { key: '3m',  label: 'Last 3 months', range: `${fmt(sub(90))} – ${fmt(now)}` },
    { key: '6m',  label: 'Last 6 months', range: `${fmt(sub(180))} – ${fmt(now)}` },
    { key: '12m', label: 'Last 12 months', range: `${fmt(sub(365))} – ${fmt(now)}` },
  ];

  const currentYear = now.getFullYear();
  const years: PeriodOption[] = [];
  for (let y = currentYear; y >= currentYear - 4; y--) {
    years.push({
      key: `y:${y}`,
      label: `All of ${y}`,
      range: `1/1 – 31/12`,
    });
  }

  const allTime: PeriodOption = { key: 'all', label: 'All time', range: '2011 – now' };

  return [...relative, ...years, allTime];
}
