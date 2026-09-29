export type EventKey = 'sih';
export type RoundKey = 'qualifier' | 'finals';

export interface EventInfo {
  key: EventKey;
  name: string;
  tagline: string;
  cert_prefix: string;
  logo: string;
  /** Optional artwork per round. Leave empty to use the built-in design. */
  templates?: {
    qualifier: string;
    finals: string;
  };
  roundLabels: {
    qualifier: string;
    finals: string;
  };
  is_active: boolean;

  /** The event's own name without the edition, for display at size.
   *  e.g. "Smart India Hackathon". Falls back to `name`. */
  title?: string;
  /** e.g. "National · 2026". Set small above the title. */
  edition?: string;
  /** How the logo is framed inside the card's planet disc (radius 40, in
   *  SVG units): drawn `size` square, centred, then shifted by x/y. Each logo
   *  needs its own — one has a background that should become the planet's
   *  surface, another has a badge whose inner circle should BE the planet. */
  emblem?: { size: number; x?: number; y?: number };
  /** The top of this event's certificate, small, for the card's print-out.
   *  A crop of the real template, so what prints is what you will get. */
  preview?: string;
  /** One line per round: who that certificate is for. */
  roundNotes?: { qualifier: string; finals: string };

  /** When it ran, as it should read on screen. e.g. "DEC 2026". */
  held: string;
  /** Duration and reach, stated plainly. e.g. "36-hour national hackathon". */
  format: string;
  /** Where the event is in its life. Drives the status chip and whether the
   *  finals round is offered as claimable or as pending. */
  status: 'complete' | 'finals-pending';
  /** The numbers, shown rather than described. Rendered in mono. */
  stats: ReadonlyArray<{ value: string; label: string }>;
  /** Which rounds can actually be claimed today. A round that has not been
   *  scored yet is listed but not offered. */
  roundOpen: { qualifier: boolean; finals: boolean };

  theme: {
    /** Codename shown above the title on the event page. */
    codename: string;
    /** Short one-line quote / motto. */
    motto: string;
    /** Tailwind gradient stops, e.g. "from-rose-600/40 via-orange-500/20 to-transparent" */
    heroGradient: string;
    /** Whether to render scanlines and glow effects. */
    scanlines?: boolean;
  };
}

export interface RosterLookup {
  valid: boolean;
  team_name: string | null;
  rank: number | null;
  points: number | null;
  solves: number | null;
  member_count: number | null;
  captain: string | null;
}

export interface IssuedCert {
  id: string;
  event_key: EventKey;
  round: RoundKey;
  team_name: string;
  rank: number;
  points: number | null;
  email: string;
  chosen_name: string;
  issued_at: string;
}

export interface ParsedRosterTeam {
  rank: number;
  team_name: string;
  points: number | null;
  solves: number | null;
  member_count: number | null;
  captain: string | null;
  last_solve: string | null;
  /** SIH problem-statement ID, when the CSV has one. */
  ps_id?: string | null;
  members: Array<{ username: string | null; email: string }>;
}

// Compatibility shape consumed by CertificateRenderer + ShareSocial.
export type CertificateType = 'participant' | 'grandfinale';

export interface Participant {
  id: string;
  name: string;
  email: string;
  team: string;
  rank?: number;
  score?: number;
  issuedAt: string;
  certificateType: CertificateType;
}

export interface ShareState {
  photoUrl: string;
  caption: string;
}
