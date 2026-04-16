// Cycling sport types — the only ones shown in this app
export const CYCLING_TYPES = [
  'Ride', 'VirtualRide', 'GravelRide',
  'MountainBikeRide', 'EBikeRide', 'EMountainBikeRide',
];

// Maps user-facing filter labels to Strava sport_type values
export const SPORT_FILTERS = {
  All:    [] as string[], // empty = show all cycling types
  Ride:   ['Ride', 'VirtualRide'],
  Gravel: ['GravelRide'],
  eMTB:   ['EMountainBikeRide', 'EBikeRide'],
  MTB:    ['MountainBikeRide'],
} as const;

export type SportFilter = keyof typeof SPORT_FILTERS;

export const SPORT_FILTER_LABELS: SportFilter[] = ['All', 'Ride', 'Gravel', 'MTB', 'eMTB'];

export function sportLabel(type: string): string {
  const map: Record<string, string> = {
    Ride:                  'Ride',
    VirtualRide:           'Virtual',
    GravelRide:            'Gravel',
    EBikeRide:             'eBike',
    EMountainBikeRide:     'eMTB',
    MountainBikeRide:      'MTB',
  };
  return map[type] ?? type;
}

export function sportColor(type: string): string {
  const map: Record<string, string> = {
    Ride:                  '#38bdf8', // sky blue
    VirtualRide:           '#818cf8', // indigo
    GravelRide:            '#1e40af', // navy blue
    MountainBikeRide:      '#f97316', // orange
    EBikeRide:             '#22c55e', // green
    EMountainBikeRide:     '#22c55e', // green
  };
  return map[type] ?? '#6b7280';
}
