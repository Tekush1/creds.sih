/* ============================================================================
   /admin — the console.
   ----------------------------------------------------------------------------
   THE LOGIC IS UNCHANGED: the session + is_admin gate, the allowlist refusal,
   sign-out, CSV parsing and import, roster counts and the recent-certificates
   list are the same calls in the same order. Only the markup moved onto the
   site's design system: the sky behind, clear-glass cards, the same type,
   labels, buttons and chips as every public page.
   ========================================================================== */

import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2, LogOut, Upload, RefreshCw } from 'lucide-react';
import { currentSession, isAdmin, onAuthChange, signOut } from '../data/admin';
import { EVENTS, getEvent } from '../data/events';
import { importRoster, rosterCounts } from '../data/rosters';
import { listRecentCerts } from '../data/certs';
import { parseRosterCsv, type RowIssue } from '../lib/csv';
import type { EventKey, IssuedCert, RoundKey, ParsedRosterTeam } from '../types';

export default function Admin() {
  const nav = useNavigate();
  const [checking, setChecking]     = useState(true);
  const [authEmail, setAuthEmail]   = useState<string | null>(null);
  const [admin, setAdmin]           = useState(false);

  useEffect(() => {
    (async () => {
      const s = await currentSession();
      setAuthEmail(s?.user.email ?? null);
      if (s) setAdmin(await isAdmin());
      setChecking(false);
    })();
    const sub = onAuthChange(async (email) => {
      setAuthEmail(email);
      if (email) setAdmin(await isAdmin());
      else setAdmin(false);
    });
    return () => { sub.data.subscription.unsubscribe(); };
  }, []);

  if (checking) {
    return (
      <div className="above-bench mx-auto max-w-md px-5 pt-24 pb-24 text-center" style={{ color: 'var(--color-label)' }}>
        <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Checking your access…
      </div>
    );
  }
  if (!authEmail) {
    return <Navigate to="/admin/login" replace />;
  }
  if (!admin) {
    return (
      <div className="above-bench mx-auto max-w-md px-5 sm:px-6 pt-14 pb-20" data-mineral="neutral">
        <div role="alert" className="notice notice--error">
          <span className="notice__icon" aria-hidden="true">!</span>
          <div>
            <p className="notice__title">No console access</p>
            <p className="mt-1 text-[14.5px] leading-relaxed" style={{ color: 'var(--color-bone)' }}>
              Signed in as <code className="adm-code">{authEmail}</code>, but this account is not on the admins allowlist.
            </p>
          </div>
        </div>
        <button onClick={async () => { await signOut(); nav('/admin/login'); }} className="btn-secondary mt-4">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    );
  }

  return <AdminPanel authEmail={authEmail} onSignOut={async () => { await signOut(); nav('/admin/login'); }} />;
}

function AdminPanel({ authEmail, onSignOut }: { authEmail: string; onSignOut: () => void }) {
  const [event, setEvent] = useState<EventKey>('sih');
  const [round, setRound] = useState<RoundKey>('qualifier');

  return (
    <div className="above-bench mx-auto max-w-5xl px-5 sm:px-6 pt-12 pb-20" data-mineral="neutral">
      <div className="adm-head">
        <div>
          <span className="chip reveal" style={{ '--i': 0, '--dot': 'var(--color-brand)' } as React.CSSProperties}>
            <span className="chip__dot" /> Staff only
          </span>
          <h1 className="record-sm mt-5 reveal" style={{ '--i': 1 } as React.CSSProperties}>Admin <em>console</em></h1>
          <p className="mt-2 text-[14px] reveal" style={{ '--i': 2, color: 'var(--color-label)' } as React.CSSProperties}>
            Signed in as <span style={{ color: 'var(--color-bone)' }}>{authEmail}</span>
          </p>
        </div>
        <button onClick={onSignOut} className="btn-secondary adm-btn reveal" style={{ '--i': 2 } as React.CSSProperties}>
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>

      <section className="panel form-card mt-8 reveal" style={{ '--i': 3 } as React.CSSProperties}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="adm-event" className="field-label">Event</label>
            <select
              id="adm-event"
              value={event}
              onChange={(e) => setEvent(e.target.value as EventKey)}
              className="adm-select mt-2"
            >
              {Object.values(EVENTS).map((ev) => (
                <option key={ev.key} value={ev.key}>{ev.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="adm-round" className="field-label">Round</label>
            <select
              id="adm-round"
              value={round}
              onChange={(e) => setRound(e.target.value as RoundKey)}
              className="adm-select mt-2"
            >
              <option value="qualifier">{getEvent(event)?.roundLabels.qualifier ?? 'Qualifier'}</option>
              <option value="finals">{getEvent(event)?.roundLabels.finals ?? 'Finals'}</option>
            </select>
          </div>
        </div>
      </section>

      <RosterImporter event={event} round={round} />
      <RosterStats event={event} />
      <IssuedCertsPanel />
    </div>
  );
}

function RosterImporter({ event, round }: { event: EventKey; round: RoundKey }) {
  const [file, setFile]       = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedRosterTeam[] | null>(null);
  const [issues, setIssues]   = useState<RowIssue[]>([]);
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState<string | null>(null);

  async function pick(f: File | null) {
    setFile(f); setStatus(null); setPreview(null); setIssues([]);
    if (!f) return;
    setBusy(true);
    try {
      const { teams, issues } = await parseRosterCsv(f);
      setPreview(teams);
      setIssues(issues);
    } catch (e: any) {
      setStatus(`Parse failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!preview || preview.length === 0) return;
    setBusy(true); setStatus(null);
    try {
      const r = await importRoster(event, round, preview);
      setStatus(`Imported ${r.teams_imported} teams and ${r.members_imported} members.`);
    } catch (e: any) {
      setStatus(`Import failed: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const ok = status?.startsWith('Imported');
  const skipped  = issues.filter((i) => i.kind === 'skipped');
  const warnings = issues.filter((i) => i.kind === 'warning');
  // "7 rows skipped (6 no emails, 1 missing rank)"
  const why = (list: RowIssue[]) => {
    const n = new Map<string, number>();
    list.forEach((i) => n.set(i.reason, (n.get(i.reason) ?? 0) + 1));
    return [...n].map(([r, c]) => `${c} ${r}`).join(', ');
  };

  return (
    <section className="panel form-card mt-5 step-enter">
      <h2 className="adm-title">Import a roster</h2>
      <p className="adm-sub">
        Uploading replaces the entire roster for the selected event and round.
        Expected columns:{' '}
        {['team', 'members', 'emails', 'ps_id'].map((c, i, a) => (
          <span key={c}><code className="adm-code">{c}</code>{i < a.length - 1 ? ' ' : ''}</span>
        ))}
        . One row per team (several <code className="adm-code">members</code> and <code className="adm-code">emails</code> separated by <code className="adm-code">|</code>) or one row per member.
      </p>

      <label className="btn-secondary adm-btn mt-5 cursor-pointer">
        <Upload className="w-4 h-4" style={{ color: 'var(--color-brand)' }} />
        <span>{file?.name ?? 'Choose CSV file…'}</span>
        <input type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </label>

      {status && (
        <div role="status" className={`notice ${ok ? 'notice--ok' : 'notice--error'} mt-4`}>
          <span className="notice__icon" aria-hidden="true">{ok ? '\u2713' : '!'}</span>
          <p style={{ color: 'var(--color-bone)' }}>{status}</p>
        </div>
      )}

      {preview && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-[14px]" style={{ color: 'var(--color-label)' }}>
              Parsed <span style={{ color: 'var(--color-bone)' }}>{preview.length}</span> teams,{' '}
              <span style={{ color: 'var(--color-bone)' }}>{preview.reduce((s, t) => s + t.members.length, 0)}</span> members
              {skipped.length > 0 && <> &middot; <span style={{ color: 'var(--color-alarm)' }}>{skipped.length} {skipped.length === 1 ? 'row' : 'rows'} skipped</span> ({why(skipped)})</>}
              {warnings.length > 0 && <> &middot; <span style={{ color: 'var(--color-bone)' }}>{warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}</span> ({why(warnings)})</>}
            </p>
            <button onClick={doImport} disabled={busy} className="btn-primary adm-btn">
              {busy && <span className="spinner" aria-hidden="true" />}
              Import into {getEvent(event)?.roundLabels[round] ?? round}
            </button>
          </div>

          {issues.length > 0 && (
            <details className="adm-details mb-3" open={skipped.length > 0 && skipped.length <= 20}>
              <summary>Which rows, and why ({issues.length})</summary>
              <ul>
                {issues.map((i, k) => (
                  <li key={k}>
                    <span className="adm-issue" data-kind={i.kind}>{i.kind === 'skipped' ? 'Skipped' : 'Warning'}</span>{' '}
                    Row {i.row}{i.team && <> &middot; <span style={{ color: 'var(--color-bone)' }}>{i.team}</span></>}: {i.reason}
                    {i.detail && <span style={{ opacity: 0.8 }}> ({i.detail})</span>}
                  </li>
                ))}
              </ul>
              {skipped.length > 0 && (
                <p className="mt-2">
                  Skipped rows are not imported, so nobody on those teams can claim a certificate.
                  Fix them in the CSV and upload it again.
                </p>
              )}
            </details>
          )}

          <div className="adm-table-wrap" style={{ maxHeight: 280 }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th>PS ID</th>
                  <th className="num">Members</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 15).map((t) => (
                  <tr key={t.rank}>
                    <td className="mono">{t.rank}</td>
                    <td>{t.team_name}</td>
                    <td className="mono">{t.ps_id ?? '—'}</td>
                    <td className="num">{t.members.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 15 && <p className="adm-more">…{preview.length - 15} more</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function RosterStats({ event }: { event: EventKey }) {
  const [rows, setRows] = useState<Array<{ round: RoundKey; teams: number; members: number }> | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try { setRows(await rosterCounts(event)); }
    catch { setRows([]); }
    finally { setBusy(false); }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [event]);

  return (
    <section className="panel form-card mt-5 step-enter">
      <div className="adm-row">
        <h2 className="adm-title">Current rosters <span className="adm-title__sub">&middot; {getEvent(event)?.name}</span></h2>
        <button onClick={refresh} className="adm-refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {!rows || rows.length === 0 ? (
        <p className="adm-sub mt-3">No roster imported yet for this event.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.round} className="adm-stat">
              <span className="chip" style={{ '--dot': 'var(--color-patina)' } as React.CSSProperties}>
                <span className="chip__dot" /> {getEvent(event)?.roundLabels[r.round] ?? r.round}
              </span>
              <p className="adm-stat__big">{r.teams.toLocaleString('en-US')} <span>teams</span></p>
              <p className="adm-stat__small">{r.members.toLocaleString('en-US')} members</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function IssuedCertsPanel() {
  const [rows, setRows] = useState<IssuedCert[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setRows(await listRecentCerts(50));
    setBusy(false);
  }
  useEffect(() => { refresh(); }, []);

  return (
    <section className="panel form-card mt-5 step-enter">
      <div className="adm-row">
        <h2 className="adm-title">Recently issued certificates {rows && rows.length > 0 && <span className="adm-title__sub">&middot; latest {rows.length}</span>}</h2>
        <button onClick={refresh} className="adm-refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {!rows ? <p className="adm-sub mt-3">Loading…</p> : rows.length === 0 ? (
        <p className="adm-sub mt-3">None yet.</p>
      ) : (
        <div className="adm-table-wrap mt-4" style={{ maxHeight: 420 }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Certificate ID</th>
                <th>Event</th>
                <th>Round</th>
                <th>Name</th>
                <th>Team</th>
                <th className="num">Rank</th>
                <th>Issued</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="mono id">{c.id}</td>
                  <td>{getEvent(c.event_key)?.name ?? c.event_key}</td>
                  <td>{getEvent(c.event_key)?.roundLabels[c.round] ?? c.round}</td>
                  <td className="strong">{c.chosen_name}</td>
                  <td>{c.team_name}</td>
                  <td className="num">#{c.rank}</td>
                  <td className="nowrap">{new Date(c.issued_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
