export interface ZoneDef {
  z: number;
  name: string;
  min: number;
  max: number | null; // null = open upper bound
  color: string;
}

export interface ZoneResult extends ZoneDef {
  seconds: number;
  pct: number;
}

// Purple scale (light → dark) for power
const POWER_COLORS = ['#e8d0e8', '#cb9acb', '#a85fa8', '#7d2e7d', '#4e1a4e'];
// Red scale (light → dark) for HR
const HR_COLORS    = ['#f5cfc9', '#e8988e', '#d45c52', '#b02020', '#721010'];

export function powerZoneDefs(ftp: number, custom?: number[] | null): ZoneDef[] {
  const b = custom && custom.length === 4
    ? custom
    : [
        Math.round(ftp * 0.55),
        Math.round(ftp * 0.75),
        Math.round(ftp * 0.87),
        Math.round(ftp * 0.94),
      ];
  return [
    { z: 1, name: 'Recovery',  min: 0,        max: b[0],  color: POWER_COLORS[0] },
    { z: 2, name: 'Endurance', min: b[0] + 1, max: b[1],  color: POWER_COLORS[1] },
    { z: 3, name: 'Tempo',     min: b[1] + 1, max: b[2],  color: POWER_COLORS[2] },
    { z: 4, name: 'Threshold', min: b[2] + 1, max: b[3],  color: POWER_COLORS[3] },
    { z: 5, name: 'VO2Max',    min: b[3] + 1, max: null,  color: POWER_COLORS[4] },
  ];
}

export function hrZoneDefs(maxHr: number, custom?: number[] | null): ZoneDef[] {
  const b = custom && custom.length === 4
    ? custom
    : [
        Math.round(maxHr * 0.60),
        Math.round(maxHr * 0.70),
        Math.round(maxHr * 0.80),
        Math.round(maxHr * 0.90),
      ];
  return [
    { z: 1, name: 'Recovery',  min: 0,        max: b[0],  color: HR_COLORS[0] },
    { z: 2, name: 'Endurance', min: b[0] + 1, max: b[1],  color: HR_COLORS[1] },
    { z: 3, name: 'Tempo',     min: b[1] + 1, max: b[2],  color: HR_COLORS[2] },
    { z: 4, name: 'Threshold', min: b[2] + 1, max: b[3],  color: HR_COLORS[3] },
    { z: 5, name: 'Anaerobic', min: b[3] + 1, max: null,  color: HR_COLORS[4] },
  ];
}

export function calcZoneTime(stream: (number | null)[], zones: ZoneDef[]): ZoneResult[] {
  const counts = new Array(zones.length).fill(0) as number[];
  for (const val of stream) {
    if (!val || val <= 0) continue;
    for (let i = zones.length - 1; i >= 0; i--) {
      if (val >= zones[i].min && (zones[i].max === null || val <= zones[i].max!)) {
        counts[i]++;
        break;
      }
    }
  }
  const total = counts.reduce((s, n) => s + n, 0) || 1;
  return zones.map((z, i) => ({
    ...z,
    seconds: counts[i],
    pct: Math.round((counts[i] / total) * 1000) / 10,
  }));
}
