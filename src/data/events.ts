import { EventInfo, EventKey } from '../types';

export const EVENTS: Record<EventKey, EventInfo> = {
  sih: {
    key: 'sih',
    name: 'Smart India Hackathon 2026',
    title: 'Smart India Hackathon',
    edition: 'NATIONAL · 2026',
    // The logo is drawn full-bleed inside the planet disc.
    emblem: { size: 84 },
    roundNotes: {
      qualifier: 'For every team that took part in the Smart India Hackathon.',
      finals:    'For the teams that reached the Grand Finale.',
    },
    tagline: 'Certificates open.',
    cert_prefix: 'SIH-2026',
    logo: '/sih_logo.svg',
    roundLabels: {
      qualifier: 'Participant',
      finals:    'Grand Finale',
    },
    is_active: true,
    held:   '2026',
    format: 'National hackathon',
    status: 'complete',
    stats: [
      { value: '9th',  label: 'edition' },
      { value: '2026', label: 'season' },
    ],
    roundOpen: { qualifier: true, finals: true },
    theme: {
      codename: 'INNOVATION · e-ATMANIRBHAR BHARAT',
      motto:    '\"solve real problems, build for India\"',
      heroGradient: 'from-orange-500/40 via-orange-300/20 to-transparent',
      scanlines: false,
    },
  },
};

export function getEvent(key: string): EventInfo | null {
  return (EVENTS as Record<string, EventInfo>)[key] ?? null;
}
