import { supabase } from '../lib/supabase';
import type { EventKey, RoundKey, RosterLookup, IssuedCert, ParsedRosterTeam } from '../types';

export async function rosterLookup(
  event: EventKey,
  round: RoundKey,
  email: string,
  team: string,
): Promise<RosterLookup> {
  const { data, error } = await supabase.rpc('roster_lookup', {
    p_event: event,
    p_round: round,
    p_email: email,
    p_team:  team,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { valid: false, team_name: null, rank: null, points: null, solves: null, member_count: null, captain: null };
  return row as RosterLookup;
}

/**
 * Find the person's team from their email alone. Returns null when the
 * database does not have the email-only lookup yet (the function is added by
 * supabase_email_only_claim.sql), so the page can fall back to asking for the
 * team instead of failing.
 */
export async function rosterLookupByEmail(
  event: EventKey,
  round: RoundKey,
  email: string,
): Promise<RosterLookup | null> {
  const { data, error } = await supabase.rpc('roster_lookup_email', {
    p_event: event,
    p_round: round,
    p_email: email,
  });
  if (error) {
    const missing = error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '');
    if (missing) return null;
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { valid: false, team_name: null, rank: null, points: null, solves: null, member_count: null, captain: null };
  return row as RosterLookup;
}

export async function issueCert(
  event: EventKey,
  round: RoundKey,
  email: string,
  team: string,
  chosenName: string,
): Promise<IssuedCert> {
  const { data, error } = await supabase.rpc('issue_cert', {
    p_event:       event,
    p_round:       round,
    p_email:       email,
    p_team:        team,
    p_chosen_name: chosenName,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('issue_cert returned no row');
  return row as IssuedCert;
}

export async function importRoster(
  event: EventKey,
  round: RoundKey,
  rows: ParsedRosterTeam[],
): Promise<{ teams_imported: number; members_imported: number }> {
  const { data, error } = await supabase.rpc('import_roster', {
    p_event: event,
    p_round: round,
    p_rows:  rows,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as { teams_imported: number; members_imported: number };
}

export async function rosterCounts(event: EventKey): Promise<Array<{ round: RoundKey; teams: number; members: number }>> {
  const { data, error } = await supabase.rpc('roster_counts', { p_event: event });
  if (error) throw error;
  return (data ?? []) as Array<{ round: RoundKey; teams: number; members: number }>;
}
