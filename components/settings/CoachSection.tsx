'use client';

import type { AthleteProfile } from '@/lib/profile';
import type { SettingsCtx } from './types';
import { Chip, Group, inputCls } from './ui';

/** The four coaching prompts. They were four near-identical 40-line blocks;
 *  the only things that ever differed are in this table. */
const PROMPTS: {
  key: keyof AthleteProfile;
  label: string;
  hint: string;
  placeholder: string;
  presets: { chip: string; text: string }[];
}[] = [
  {
    key: 'coach_persona',
    label: 'Coach persona',
    hint: 'The overall identity and tone.',
    placeholder: "e.g. An experienced but approachable coach who balances hard truths with genuine belief in the athlete's potential.",
    presets: [
      { chip: 'Direct',      text: 'Direct and no-nonsense. Skip encouragement, just give me the numbers' },
      { chip: 'Supportive',  text: 'Supportive and enthusiastic. Always find something positive, then give feedback' },
      { chip: 'Scientific',  text: 'Scientific and detail-oriented. Reference research and explain the why' },
      { chip: 'Tough love',  text: 'Hard-ass military coach. Tough love, short, blunt' },
    ],
  },
  {
    key: 'ai_coaching_feedback',
    label: 'Ride feedback style',
    hint: 'How rides get analysed — length, depth, what to focus on.',
    placeholder: "e.g. Keep it to 3–4 sentences. Don't restate my lap data. Compare interval power to the previous 3 similar sessions.",
    presets: [
      { chip: 'Brief',    text: 'Brief insight only: 2–3 sentences, one key takeaway, no numbers I can see on the page' },
      { chip: 'Detailed', text: 'Detailed analysis: compare to recent trend, highlight HR decoupling, give a specific next focus' },
      { chip: 'Minimal',  text: 'Minimal feedback: just tell me if it was a good session or not and what to do next time' },
      { chip: 'Full',     text: 'Full breakdown: lap-by-lap power, HR drift, VI, and a suggested adjustment for next session' },
    ],
  },
  {
    key: 'ai_training_plan_guidance',
    label: 'Training plan approach',
    hint: 'Volume preference, intensity bias, periodisation style.',
    placeholder: 'e.g. Polarised: 80% Z2, 20% hard. Prefer 8–20 min intervals. No more than 2 hard days per week.',
    presets: [
      { chip: 'Polarised',   text: 'Polarised: 80% easy Z2, 20% hard work. Long intervals preferred (8–20 min). Max 2 hard days/week' },
      { chip: 'Sweet spot',  text: 'Sweet spot: mostly tempo/threshold work. 3–4 hard days per week, lower total volume' },
      { chip: 'Traditional', text: 'Traditional base-build-peak: long Z2 blocks early, introduce intensity later' },
      { chip: 'Low vol',     text: 'Low volume, high intensity: 2 rides per week, both high quality. Prioritise VO2 and threshold' },
    ],
  },
  {
    key: 'ai_communication_style',
    label: 'Communication style',
    hint: 'Tone and formatting for chat — how formal, how long, emoji and markdown.',
    placeholder: "e.g. Casual and conversational. Concise — I don't need paragraphs. Skip the markdown tables.",
    presets: [
      { chip: 'Casual',         text: 'Casual and concise. Use some emoji. No markdown tables. Keep responses under 4 sentences unless I ask for detail' },
      { chip: 'Professional',   text: 'Professional and structured. Use markdown headings and bullet points when useful. Reference numbers specifically' },
      { chip: 'Minimalist',     text: 'Minimalist. Just give me the answer. No fluff, no emoji, no formatting' },
      { chip: 'Conversational', text: "Conversational and thorough. Explain your reasoning. Use analogies. Don't be afraid to be detailed" },
    ],
  },
];

/** How many of the four prompts have been filled in — shown on the hub row. */
export function coachSummary(profile: AthleteProfile): string {
  const set = PROMPTS.filter(p => String(profile[p.key] ?? '').trim()).length;
  return set === 0 ? 'Defaults' : `${set} of ${PROMPTS.length} set`;
}

export default function CoachSection({ ctx }: { ctx: SettingsCtx }) {
  const { profile, update, save } = ctx;

  return (
    <Group footer="The more specific you are, the more tailored the coaching. Changes save when you tap away.">
      {PROMPTS.map(({ key, label, hint, placeholder, presets }) => {
        const value = String(profile[key] ?? '');
        return (
          <div key={String(key)} className="space-y-2 px-4 py-4">
            <div>
              <label className="block text-sm font-medium text-ink-2">{label}</label>
              <p className="mt-0.5 text-micro leading-relaxed text-ink-4">{hint}</p>
            </div>
            <textarea
              value={value}
              onChange={e => update(key, e.target.value as AthleteProfile[typeof key])}
              onBlur={() => { void save(); }}
              rows={3}
              className={`${inputCls} resize-none`}
              placeholder={placeholder}
            />
            <div className="flex flex-wrap gap-1.5">
              {presets.map(p => (
                <Chip
                  key={p.chip}
                  active={value === p.text}
                  onClick={() => {
                    update(key, p.text as AthleteProfile[typeof key]);
                    void save();
                  }}
                >
                  {p.chip}
                </Chip>
              ))}
            </div>
          </div>
        );
      })}
    </Group>
  );
}
