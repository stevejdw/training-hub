// Maps user-facing filter labels to Strava sport_type values
export const SPORT_FILTERS = {
  All:    [] as string[], // empty = no filter
  Walk:   ['Walk', 'Hike'],
  Ride:   ['Ride'],
  Gravel: ['GravelRide'],
  eMTB:   ['EMountainBikeRide', 'EBikeRide'],
  MTB:    ['MountainBikeRide'],
  Run:    ['Run'],
} as const;

export type SportFilter = keyof typeof SPORT_FILTERS;

export const SPORT_FILTER_LABELS: SportFilter[] = ['All', 'Walk', 'Ride', 'Gravel', 'eMTB', 'MTB', 'Run'];

export function sportLabel(type: string): string {
  const map: Record<string, string> = {
    Ride:                  'Ride',
    GravelRide:            'Gravel',
    Walk:                  'Walk',
    Hike:                  'Hike',
    Run:                   'Run',
    EBikeRide:             'eBike',
    EMountainBikeRide:     'eMTB',
    MountainBikeRide:      'MTB',
    WeightTraining:        'Weights',
    Workout:               'Workout',
    Swim:                  'Swim',
    Elliptical:            'Elliptical',
  };
  return map[type] ?? type;
}

export function sportColor(type: string): string {
  const map: Record<string, string> = {
    Ride:                  '#f97316', // orange
    GravelRide:            '#fb923c',
    EBikeRide:             '#22c55e', // green
    EMountainBikeRide:     '#16a34a',
    MountainBikeRide:      '#15803d',
    Walk:                  '#60a5fa', // blue
    Hike:                  '#3b82f6',
    Run:                   '#a78bfa', // purple
    WeightTraining:        '#f43f5e',
    Swim:                  '#06b6d4',
  };
  return map[type] ?? '#6b7280';
}
