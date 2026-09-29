import Papa from 'papaparse';
import type { ParsedRosterTeam } from '../types';

/**
 * Expected CSV columns (order-insensitive, headers required):
 *   team, members, emails, ps_id
 *
 * - `team`     team name (also accepted: team_name)
 * - `members`  member name(s)   (also: member, member_name, name)
 * - `emails`   email(s)         (also: email)
 * - `ps_id`    SIH problem-statement ID (also: sih_ps_id, ps id, psid)
 *
 * Either one row per TEAM (several names / emails separated by " | ", where
 * emails[i] belongs to members[i]) or one row per MEMBER (team repeated).
 * Rows with the same team name are merged.
 *
 * The old scoreboard format (rank, points, solves, captain, ...) still works;
 * when there is no `rank` column the teams are numbered in file order.
 */

const SPLIT_RE = /\s*\|\s*/;

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

const ALIASES: Record<string, string[]> = {
  team:    ['team', 'teamname'],
  members: ['members', 'member', 'membername', 'membernames', 'name', 'names'],
  emails:  ['emails', 'email', 'emailid', 'emailids'],
  ps_id:   ['psid', 'sihpsid', 'psnumber', 'psno', 'problemstatementid', 'problemstatement'],
};

function pickRoundHeader(row: Record<string, string>, name: string): string {
  // Tolerate BOM, case, spaces and underscores in header names.
  const clean = (k: string) => k.replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = ALIASES[name] ?? [clean(name)];
  const hit = Object.keys(row).find((k) => wanted.includes(clean(k)));
  return hit ? (row[hit] ?? '') : '';
}

/**
 * last_solve_utc arrives as "YYYY-MM-DD HH:MM:SS" (UTC, no zone) from the
 * scoreboard export, but a spreadsheet round-trip can turn it into an ISO
 * string that already carries a zone. Accept both; anything unreadable is
 * null, never a throw — a throw inside Papa's callback never reached the
 * promise, and the importer hung with no message.
 */
function parseUtc(raw: string): string | null {
  if (!raw) return null;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(iso);
  const d = new Date(hasZone ? iso : iso + 'Z');
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Something the parser noticed about one row. A `skipped` row is not in
 * `teams` at all; a `warning` row was imported, minus the part named.
 */
export interface RowIssue {
  row: number;            // line in the file, header = 1
  team: string;
  kind: 'skipped' | 'warning';
  reason: string;         // short, groupable: "no emails", "missing rank", …
  detail?: string;
}

export interface ParsedCsv {
  teams: ParsedRosterTeam[];
  issues: RowIssue[];
}

export function parseRosterCsv(file: File | string): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file as any, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
       try {
        const issues: RowIssue[] = [];
        const teams: ParsedRosterTeam[] = [];

        // Malformed lines (a stray quote, too many or too few fields) still
        // come through as rows, just wrong — say which ones.
        result.errors.forEach((e) => {
          if (typeof e.row !== 'number') return;
          issues.push({ row: e.row + 2, team: '', kind: 'warning', reason: 'CSV format', detail: e.message });
        });

        const byTeam = new Map<string, ParsedRosterTeam>();

        result.data.forEach((rawRow, idx) => {
          const g = (name: string) => pickRoundHeader(rawRow, name);
          const team_name = g('team').trim();
          if (!team_name) return;

          const membersStr = g('members');
          const emailsStr  = g('emails');

          const usernames = membersStr ? membersStr.split(SPLIT_RE).map((s) => s.trim()) : [];
          const emails    = emailsStr  ? emailsStr.split(SPLIT_RE).map((s) => s.trim())  : [];

          const row = idx + 2;
          const skip = (reason: string, detail?: string) =>
            issues.push({ row, team: team_name, kind: 'skipped', reason, detail });

          if (emails.length === 0) {
            skip('no emails', 'the emails column is empty');
            return;
          }

          const all = emails.map((email, i) => ({
            username: usernames[i] ?? null,
            email:    email.toLowerCase(),
          })).filter((m) => m.email.length > 0);
          const members: ParsedRosterTeam['members'] = all.filter((m) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email));
          const bad = all.filter((m) => !members.includes(m)).map((m) => m.email);

          if (members.length === 0) {
            skip('no valid emails', bad.length ? `not an email: ${bad.join(', ')}` : 'the emails column is empty');
            return;
          }

          if (bad.length) {
            issues.push({ row, team: team_name, kind: 'warning', reason: 'invalid email dropped',
              detail: `${bad.join(', ')}; ${bad.length === 1 ? 'that member' : 'those members'} cannot claim` });
          }

          const last_solve_raw = g('last_solve_utc').trim();
          const last_solve = parseUtc(last_solve_raw);
          if (last_solve_raw && !last_solve) {
            issues.push({ row, team: team_name, kind: 'warning', reason: 'unreadable last_solve_utc',
              detail: `"${last_solve_raw}"; the team is imported without it` });
          }

          const ps_id = g('ps_id').trim() || null;
          const key = team_name.toLowerCase();
          const existing = byTeam.get(key);
          if (existing) {
            // Same team on another row (one-row-per-member files): merge.
            members.forEach((m) => {
              if (!existing.members.some((x) => x.email === m.email)) existing.members.push(m);
            });
            existing.member_count = existing.members.length;
            if (!existing.ps_id && ps_id) existing.ps_id = ps_id;
            return;
          }

          byTeam.set(key, {
            // Old scoreboard files carry a rank; new ones do not, so 0 for now
            // and numbered in file order below (the database needs a number).
            rank:         toIntOrNull(g('rank')) ?? 0,
            team_name,
            points:       toIntOrNull(g('points')),
            solves:       toIntOrNull(g('solves')),
            member_count: toIntOrNull(g('member_count')) ?? members.length,
            captain:      g('captain').trim() || null,
            last_solve,
            ps_id,
            members,
          });
        });

        let next = 1;
        byTeam.forEach((t) => {
          t.member_count = t.members.length;
          if (!t.rank) t.rank = next;
          next = Math.max(next, t.rank) + 1;
          teams.push(t);
        });

        issues.sort((a, b) => a.row - b.row);
        resolve({ teams, issues });
       } catch (err) {
        // Surface as "Parse failed: …" in the console instead of hanging.
        reject(err);
       }
      },
      error: (err) => reject(err),
    });
  });
}
