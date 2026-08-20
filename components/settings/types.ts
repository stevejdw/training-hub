import type { AthleteProfile } from '@/lib/profile';

/** What every Settings sub-screen needs from the shared profile editor.
 *  Passed as one object rather than eight props per section. */
export interface SettingsCtx {
  profile: AthleteProfile;
  update: <K extends keyof AthleteProfile>(key: K, value: AthleteProfile[K]) => void;
  updateAndSave: <K extends keyof AthleteProfile>(key: K, value: AthleteProfile[K]) => Promise<void> | undefined;
  save: () => Promise<void>;
  saving: boolean;
}

export type SettingsSection = 'appearance' | 'coach' | 'athlete' | 'connections' | 'data';
