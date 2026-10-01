/* ============================================================================
   EventPage — the claim flow, and the only path by which a certificate is
   ever issued.
   ----------------------------------------------------------------------------
   The claim asks for a round, an email and a name. The team is found from
   the email (rosterLookupByEmail) and handed to issueCert(), which checks the
   email against that team exactly as before; if the database has no
   email-only lookup yet, the flow falls back to asking for the team. The
   email regex, the 1–80 name bound and the allowed-character regex are the
   ones that shipped. This file announces facts to the bench; it decides
   nothing about the record.

   THE CANVAS IS NEVER INTERACTIVE. Nothing here is parented to a 3D object.
   Every input, button, label, error and link is ordinary DOM inside
   .above-bench at z-index 10, and the whole flow works with WebGL entirely
   disabled — which is why useBench() is read defensively: if the world is not
   mounted, the claim flow still issues certificates.

   THE DOWNLOAD IS NOT THE 3D. CertificateRenderer
   remains the single source of truth for the exported PNG; this page only hands
   the bytes they produced to an anchor. The 3D slab is the ceremony, the 2D
   canvas is the document.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EVENTS, getEvent } from '../data/events';
import type { EventInfo, IssuedCert, RosterLookup, RoundKey } from '../types';
import { rosterLookup, rosterLookupByEmail, issueCert } from '../data/rosters';
import CertificateRenderer from '../components/CertificateRenderer';
import { World } from '../components/EventCard';
import { motionLevel } from '../three/tiers';
import { useBench, type BenchApi } from '../three/BenchProvider';
import { buildEtchMask } from '../three/glyphMask';
import { deriveSpecimen, type BenchState, type SpecimenParams } from '../three/contract';

type Step = 'round' | 'email' | 'team' | 'name' | 'cert';

/* ---- driving the bench ---------------------------------------------------
   THE RATCHET: matter advances and never retreats. The charge ladder below is
   the only order in which this page is allowed to move the world, and the one
   licensed exception — RESORB, on commit — is issued explicitly and closes the
   ladder behind it. LOCK is deliberately absent: it is a freeze, not a stage,
   so a user who escapes the entrance by typing still gets seeded and grown
   when their progress asks for it. */
const CHARGE_LADDER: readonly BenchState[] = [
  'BOOT', 'FRACTURE', 'INJECT', 'UNDERCOOL', 'GROW', 'IMPINGE',
];
const chargeOf = (s: BenchState): number => CHARGE_LADDER.indexOf(s);

/** What this page needs from the world. Nothing else is touched. */
type BenchDriver = Pick<BenchApi, 'state' | 'setState' | 'setMineral' | 'setSpecimen' | 'setEtchMask'>;

/** The world is additive. If <BenchProvider> is not mounted above this route,
 *  the claim flow must still issue certificates — that is the acceptance gate
 *  for the whole project — so the driver degrades to no-ops rather than
 *  throwing. useContext() inside useBench() has already run by the time the
 *  guard throws, so hook order is unaffected. */
const NO_BENCH: BenchDriver = {
  state: 'LOCK',
  setState: () => {},
  setMineral: () => {},
  setSpecimen: () => {},
  setEtchMask: () => {},
};

function useBenchDriver(): BenchDriver {
  try {
    return useBench();
  } catch {
    return NO_BENCH;
  }
}

export default function EventPage() {
  const { key } = useParams();
  const nav = useNavigate();
  const ev = key ? getEvent(key) : null;

  if (!ev) {
    return (
      <div className="above-bench mx-auto max-w-2xl px-4 sm:px-6 pt-16 pb-16">
        <div className="fact-label">Error</div>
        <h1 className="record mt-4">Unknown event.</h1>
        <button onClick={() => nav('/')} className="mt-8 btn-secondary">Back to events</button>
      </div>
    );
  }
  if (!ev.is_active) return <Locked ev={ev} />;
  return <Flow ev={ev} />;
}

/** Database and network errors, in words a participant can act on. The raw
 *  message still goes to the console for whoever is debugging. */
function friendly(err: unknown): string {
  const raw = String((err as any)?.message ?? err ?? '');
  console.error('claim error:', raw);
  if (/closed/i.test(raw)) return 'Certificates for this event are closed.';
  if (/not on the roster|roster row not found/i.test(raw))
    return "We couldn't match that email to this event's list. Use the email your team registered with, and check you picked the right round.";
  if (/1\.\.80|1–80/.test(raw)) return 'Name must be 1–80 characters.';
  if (/invalid characters/i.test(raw)) return "Names can use letters, numbers, spaces and . , ' - ( ) & /";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw))
    return "Couldn't reach the server. Check your connection and try again.";
  if (/429|too many|rate limit/i.test(raw)) return 'Too many attempts. Wait a minute and try again.';
  return 'Something went wrong. Please try again in a moment.';
}

/** The rules the database enforces on a certificate name, checked first so
 *  the message is friendly. Returns null when the name is fine. */
function nameProblem(n: string): string | null {
  if (n.length < 1 || n.length > 80) return 'Name must be 1–80 characters.';
  if (!/^[\p{L}\p{N} '.,\-()&/]+$/u.test(n)) return "Names can use letters, numbers, spaces and . , ' - ( ) & /";
  return null;
}

/* A past event: no claim flow at all. Certificates already issued still
   verify, so the page points there, and on to the event that is open. */
function Locked({ ev }: { ev: EventInfo }) {
  const open = Object.values(EVENTS).filter((e) => e.is_active);
  return (
    <div data-mineral={ev.key} className="above-bench mx-auto max-w-3xl px-5 sm:px-6 pt-8 pb-20">
      <Link to="/" viewTransition className="backlink">
        <span aria-hidden="true">&larr;</span> All events
      </Link>

      <header className="claim-head">
        <div className="min-w-0">
          <p className="claim-head__edition">{ev.edition ?? ''}</p>
          <h1 className="claim-head__title">{ev.title ?? ev.name}</h1>
          <p className="claim-head__tagline">{ev.tagline}</p>
        </div>
        <div className="emblem ev--locked" aria-hidden="true">
          <World logo={ev.logo} emblem={ev.emblem} moving={false} />
        </div>
      </header>

      <div className="panel locked-panel step-enter" role="status">
        <div className="locked-panel__icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="22" height="22"><rect x="3" y="7" width="10" height="7.5" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </div>
        <h2 className="locked-panel__title">Certificates for {ev.title ?? ev.name} are closed</h2>
        <p className="locked-panel__text">
          {ev.title ?? ev.name} is a past event, and its certificates are no longer
          being issued. If you already have one, you can still verify it.
        </p>
        <div className="locked-panel__actions">
          {open.map((o) => (
            <Link key={o.key} to={`/event/${o.key}`} viewTransition className="btn-primary" data-mineral={o.key}>
              Claim your {o.title ?? o.name} certificate <span aria-hidden="true">&rarr;</span>
            </Link>
          ))}
          <Link to="/verify" viewTransition className="btn-secondary">Verify a certificate</Link>
        </div>
      </div>
    </div>
  );
}

function Flow({ ev }: { ev: EventInfo }) {
  const [step, setStep]         = useState<Step>('round');
  const [round, setRound]       = useState<RoundKey>('qualifier');
  const [email, setEmail]       = useState('');
  const [team, setTeam]         = useState('');
  const [chosen, setChosen]     = useState('');
  const [lookup, setLookup]     = useState<RosterLookup | null>(null);
  const [cert, setCert]         = useState<IssuedCert | null>(null);
  const [returning, setReturning] = useState(false);
  /** The name typed this time, when it differs from the one on the record. */
  const [typedName, setTypedName] = useState<string | null>(null);
  /** Only when the database cannot look a person up by email alone. */
  const [needTeam, setNeedTeam] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  /** The specimen grown from the issued record. Local, so the provenance panel
   *  reads exactly the parameters the world was handed. */
  const [, setSpecimen]           = useState<SpecimenParams | null>(null);
  /** The PNG the 2D renderer produced. The page never draws it itself. */
  const [pngUrl, setPngUrl]       = useState('');

  const bench = useBenchDriver();
  const { state: benchState, setState: setBenchState } = bench;

  // Email, then name: the team is found from the email. The team question
  // only comes back if the database has no email-only lookup.
  const stepOrder: Step[] = needTeam ? ['round', 'email', 'team', 'name', 'cert'] : ['round', 'email', 'name', 'cert'];
  const stepIdx = stepOrder.indexOf(step);

  /* ---- the charge ------------------------------------------------------ */

  const charged = useRef(0);

  // The provider runs the scripted entrance on its own clock. Follow it, so a
  // step that the beats have already overtaken never re-issues an earlier one.
  useEffect(() => {
    const r = chargeOf(benchState);
    if (r > charged.current) charged.current = r;
  }, [benchState]);

  const advance = useCallback((next: BenchState) => {
    const r = chargeOf(next);
    if (r < 0 || r <= charged.current) return;
    charged.current = r;
    setBenchState(next);
  }, [setBenchState]);

  // On mount: this event's mineralogy, then the fracture. The hairline is the
  // exploit, and it is 2D — no GL context exists yet.
  const { setMineral } = bench;
  useEffect(() => {
    setMineral(ev.key);
    advance('FRACTURE');
  }, [ev.key, setMineral, advance]);

  /* ---- the record ------------------------------------------------------ */

  const participantForRenderer = useMemo(() => {
    if (!cert) return null;
    return {
      id:              cert.id,
      name:            cert.chosen_name,
      email:           cert.email,
      team:            cert.team_name,
      rank:            cert.rank,
      score:           cert.points ?? undefined,
      issuedAt:        (cert.issued_at || '').split('T')[0],
      certificateType: (round === 'finals' ? 'grandfinale' : 'participant') as 'participant' | 'grandfinale',
    };
  }, [cert, round]);

  // Stable, so the renderer is never handed a new callback identity on a
  // pointer-driven re-render. onImageGenerated must never reach anything that
  // re-renders per frame: it carries a multi-megabyte data URL.
  const onImageGenerated = useCallback((url: string) => setPngUrl(url), []);

  /**
   * RESORB → REGROW → SEAL. Called once, from the commit handler, after the
   * certificate exists. The world can fail freely here: it never fails a claim.
   */
  function deposit(c: IssuedCert, name: string, roster: RosterLookup | null) {
    charged.current = Number.MAX_SAFE_INTEGER; // the ladder closes behind the commit
    try {
      const spec = deriveSpecimen({
        certId:    c.id,
        event:     ev.key,
        round:     c.round,
        rank:      c.rank,
        fieldSize: 0,
        solves:    roster?.solves ?? null,
        points:    c.points,
      });
      setSpecimen(spec);
      bench.setSpecimen(spec);

      // The mask is built ONCE, here, on commit — never per keystroke. The name
      // was proofread as crisp DOM before anything melted.
      buildEtchMask(name)
        .then((mask) => { bench.setEtchMask(mask); setBenchState('RESORB'); })
        .catch(() => { bench.setEtchMask(null); setBenchState('RESORB'); });
    } catch {
      /* A world that cannot melt must never surface as a claim error: the
         certificate exists, and the ceremony is additive. */
    }
  }

  /* ---- the steps: round, email, name (team found from the email) ------ */

  async function submitEmail() {
    setError(null);
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setError('Enter a valid email address.'); return; }
    setEmail(e);
    advance('UNDERCOOL');
    setBusy(true);
    try {
      const r = await rosterLookupByEmail(ev.key, round, e);
      if (r === null) { setNeedTeam(true); setStep('team'); return; }
      if (!r.valid || !r.team_name) {
        setError(`We couldn't find ${e} on the ${roundLabel.toLowerCase()} scoreboard. Use the email you registered with, or check you picked the right round.`);
        return;
      }
      setTeam(r.team_name);
      setLookup(r); setStep('name');
      advance('GROW');
    } catch (err: any) { setError(friendly(err)); }
    finally { setBusy(false); }
  }
  async function submitTeam() {
    setError(null);
    const t = team.trim();
    if (!t) { setError('Enter your team name.'); return; }
    setBusy(true);
    try {
      const r = await rosterLookup(ev.key, round, email, t);
      if (!r.valid) { setError(`We couldn't verify “${t}” with the email you provided. Double-check both entries and try again.`); return; }
      setLookup(r); setStep('name');
      advance('GROW');
    } catch (e: any) { setError(friendly(e)); }
    finally { setBusy(false); }
  }
  async function submitName() {
    setError(null);
    const n = chosen.trim();
    const bad = nameProblem(n);
    if (bad) { setError(bad); return; }
    setBusy(true);
    advance('IMPINGE');
    try {
      const c = await issueCert(ev.key, round, email, team, n);
      // One certificate per person: a claim that comes back with an older
      // record is someone returning for the certificate they already hold.
      setReturning(Date.now() - Date.parse(c.issued_at) > 2 * 60 * 1000);
      // The name is fixed by the first claim; say so if this one typed another.
      setTypedName(c.chosen_name.trim() !== n ? n : null);
      setCert(c); setStep('cert');
      deposit(c, n, lookup);
    } catch (e: any) { setError(friendly(e)); }
    finally { setBusy(false); }
  }

  /* ---- changing the name on an issued certificate ---------------------- */
  // The ID is for life; the name on it can be corrected. Re-claiming with the
  // new name updates the same certificate (issue_cert does it server-side).
  const [editing, setEditing]   = useState(false);
  const [newName, setNewName]   = useState('');
  const [nameMsg, setNameMsg]   = useState<{ ok: boolean; text: string } | null>(null);

  function openRename() {
    setNewName(cert?.chosen_name ?? '');
    setNameMsg(null);
    setEditing(true);
  }
  async function saveName() {
    if (!cert) return;
    const n = newName.trim();
    const bad = nameProblem(n);
    if (bad) { setNameMsg({ ok: false, text: bad }); return; }
    if (n === cert.chosen_name) { setEditing(false); return; }
    setBusy(true); setNameMsg(null);
    try {
      const c = await issueCert(ev.key, round, email, team, n);
      if (c.id !== cert.id || c.chosen_name.trim() !== n) {
        setNameMsg({ ok: false, text: "The name couldn't be changed right now. Please try again later." });
        return;
      }
      setCert(c); setChosen(n); setTypedName(null); setPngUrl('');
      setEditing(false);
      setNameMsg({ ok: true, text: `Name updated. Your certificate ID stays ${c.id}.` });
    } catch (e: any) {
      setNameMsg({ ok: false, text: friendly(e) });
    } finally { setBusy(false); }
  }

  /* ---- CLEAVE ---------------------------------------------------------- */

  function cleave() {
    if (!pngUrl || !cert) return;
    setBenchState('CLEAVE');
    // iOS Safari will not save a data-URL download to Photos, so it gets the
    // image in its own tab to press-and-hold — the same hand-off the
    // renderers use.
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(`<html><head><title>${cert.id}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#03040B;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;height:auto}p{color:#D2D9F2;font:14px system-ui,sans-serif;margin-top:16px;text-align:center;padding:0 16px}</style></head><body><img src="${pngUrl}"/><p>Press and hold the image, then choose Save to Photos.</p></body></html>`);
        win.document.close();
      }
      return;
    }
    const a = document.createElement('a');
    a.href = pngUrl;
    a.download = `${cert.id}.${pngUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const roundLabel = ev.roundLabels[round];
  const STEPS = needTeam ? ['Round', 'Email', 'Team', 'Name', 'Certificate'] : ['Round', 'Email', 'Name', 'Certificate'];
  const [copied, setCopied] = useState(false);
  const verifyUrl = cert ? `${window.location.origin}/verify?id=${encodeURIComponent(cert.id)}` : '';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch { /* clipboard refused: the link is still visible to copy by hand */ }
  }

  return (
    <div data-mineral={ev.key} className="above-bench mx-auto max-w-3xl px-5 sm:px-6 pt-8 pb-20">
      {step === 'round' ? (
        <Link to="/" viewTransition className="backlink">
          <span aria-hidden="true">&larr;</span> All events
        </Link>
      ) : (
        <button type="button" className="backlink" onClick={() => setStep(stepOrder[Math.max(0, stepIdx - 1)])}>
          <span aria-hidden="true">&larr;</span> Back
        </button>
      )}

      <header className="claim-head">
        <div className="min-w-0">
          <p className="claim-head__edition">{ev.edition ?? ''}</p>
          <h1 className="claim-head__title">{ev.title ?? ev.name}</h1>
          <p className="claim-head__tagline">{ev.tagline}</p>
        </div>
        <div className="emblem" aria-hidden="true">
          <World logo={ev.logo} emblem={ev.emblem} moving={motionLevel() !== 'still'} />
        </div>
      </header>

      {/* The stepper. Done steps carry a check, the current one glows in the
          event's colour, the rest wait. The labels are the words a person
          would use, not the machine's. */}
      <ol className="stepper" aria-label="Progress">
        {STEPS.map((l, i) => (
          <li
            key={l}
            className="stepper__step"
            data-state={i < stepIdx ? 'done' : i === stepIdx ? 'current' : 'todo'}
            aria-current={i === stepIdx ? 'step' : undefined}
          >
            <span className="stepper__dot">
              {i < stepIdx ? (
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                i + 1
              )}
            </span>
            <span className="stepper__label">{l}</span>
          </li>
        ))}
      </ol>

      {error && (
        <div role="alert" className="notice notice--error mt-8">
          <span className="notice__icon" aria-hidden="true">!</span>
          <p>{error}</p>
        </div>
      )}

      <div className="mt-9">
        {step === 'round' && (
          <Section title="Choose your round" subtitle="Each round has its own certificate. Pick the one your team played.">
            <div className="grid gap-4 sm:grid-cols-2">
              {(['qualifier', 'finals'] as RoundKey[]).map((r) => {
                const open = ev.roundOpen[r];
                return (
                  <button
                    key={r}
                    onClick={() => { setRound(r); setStep('email'); advance('INJECT'); }}
                    className="panel round-card deposit text-left"
                  >
                    <span className="chip" style={{ '--dot': open ? 'var(--color-patina)' : 'var(--color-pyrite)' } as React.CSSProperties}>
                      <span className="chip__dot" />
                      {open ? 'Open' : 'Results pending'}
                    </span>
                    <span className="round-card__title">{ev.roundLabels[r]}</span>
                    {ev.roundNotes && <span className="round-card__note">{ev.roundNotes[r]}</span>}
                    <span className="round-card__cta">
                      Continue <span aria-hidden="true">&rarr;</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {step === 'email' && (
          <Section title="What's your email?" subtitle={`The address you registered for ${ev.title ?? ev.name} with.`}>
            <div className="panel form-card">
              <label htmlFor="claim-email" className="field-label">Email address</label>
              <div className="deposit mt-2" data-touched={email.trim().length > 0}>
                <input
                  id="claim-email"
                  autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submitEmail(); }}
                  placeholder="you@example.com" className="input" autoComplete="email"
                />
              </div>
              <Actions onNext={submitEmail} label="Continue" busy={busy} />
            </div>
          </Section>
        )}

        {step === 'team' && (
          <Section title="And your team?" subtitle={`We'll find ${email} in the ${roundLabel.toLowerCase()} round.`}>
            <div className="panel form-card">
              <label htmlFor="claim-team" className="field-label">Team name</label>
              <div className="deposit mt-2" data-touched={team.trim().length > 0}>
                <input
                  id="claim-team"
                  autoFocus value={team} onChange={(e) => setTeam(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submitTeam(); }}
                  placeholder="Exactly as registered" className="input"
                />
              </div>
              <Actions onNext={submitTeam} label="Find my team" busy={busy} />
            </div>
          </Section>
        )}

        {step === 'name' && lookup && (
          <Section title="You're on the scoreboard." subtitle="Now choose the name that goes on your certificate.">
            <div className="panel match-card">
              <span className="chip" style={{ '--dot': 'var(--color-patina)' } as React.CSSProperties}>
                <span className="chip__dot" /> Team found
              </span>
              <p className="match-card__team">{lookup.team_name}</p>
              <dl className="match-card__stats">
                {lookup.points != null && <div><dt>Points</dt><dd>{lookup.points.toLocaleString('en-US')}</dd></div>}
                {lookup.member_count != null && <div><dt>Members</dt><dd>{lookup.member_count}</dd></div>}
                <div><dt>Round</dt><dd>{roundLabel}</dd></div>
              </dl>
            </div>

            <div className="panel form-card mt-4">
              <label htmlFor="claim-name" className="field-label">Name on the certificate</label>
              <div className="deposit mt-2" data-touched={chosen.trim().length > 0}>
                <input
                  id="claim-name"
                  autoFocus value={chosen} onChange={(e) => setChosen(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submitName(); }}
                  placeholder="e.g. Aman Singh Tomar" className="input" autoComplete="name"
                />
              </div>
              <p className="field-hint">It's printed exactly as typed and can't be changed afterwards.</p>

              {/* Proofread in the face it will be printed in. */}
              <div className="name-proof" aria-hidden={!chosen.trim()}>
                <span className="field-label">Preview</span>
                <span className="name-proof__name">{chosen.trim() || 'Your name'}</span>
              </div>

              <Actions onNext={submitName} label="Issue my certificate" busy={busy} />
            </div>
          </Section>
        )}

        {step === 'cert' && cert && participantForRenderer && (
          <div>
            <div className="panel issued">
              <div className="issued__seal" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <p className="issued__kicker">{returning ? 'Your certificate' : 'Certificate issued'}</p>
              <h2 className="issued__name">{cert.chosen_name}</h2>
              {returning && (
                <p className="issued__note">
                  Welcome back. This is the certificate you claimed on {(cert.issued_at || '').split('T')[0]}.
                  Your certificate ID stays the same every time you come back.
                </p>
              )}
              {typedName && (
                <p className="issued__note">
                  This certificate is issued to <strong>{cert.chosen_name}</strong> (you entered
                  “{typedName}”). Use <strong>Change name</strong> below to correct it.
                </p>
              )}
              <p className="issued__meta">
                {cert.team_name} &middot; {roundLabel} &middot; {(cert.issued_at || '').split('T')[0]}
              </p>

              <div className="issued__id">
                <span className="field-label">Certificate ID</span>
                <code>{cert.id}</code>
              </div>

              <div className="issued__actions">
                <button onClick={cleave} disabled={!pngUrl} className="btn-primary">
                  {pngUrl ? 'Download certificate' : 'Preparing…'}
                </button>
                <button onClick={copyLink} className="btn-secondary" type="button">
                  {copied ? 'Link copied' : 'Copy verification link'}
                </button>
                {!editing && (
                  <button onClick={openRename} className="btn-secondary" type="button">
                    Change name
                  </button>
                )}
              </div>

              {editing && (
                <div className="rename">
                  <label htmlFor="rename-input" className="field-label">New name on the certificate</label>
                  <input
                    id="rename-input"
                    autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !busy) saveName(); if (e.key === 'Escape') setEditing(false); }}
                    className="input mt-2" autoComplete="name" maxLength={80}
                  />
                  <div className="name-proof" aria-hidden={!newName.trim()}>
                    <span className="field-label">Preview</span>
                    <span className="name-proof__name">{newName.trim() || 'Your name'}</span>
                  </div>
                  <p className="field-hint">Your certificate ID stays the same. Only the name changes.</p>
                  <div className="rename__actions">
                    <button onClick={() => setEditing(false)} className="btn-secondary" type="button" disabled={busy}>Cancel</button>
                    <button onClick={saveName} className="btn-primary" type="button" disabled={busy}>
                      {busy && <span className="spinner" aria-hidden="true" />}
                      Save name
                    </button>
                  </div>
                </div>
              )}

              {nameMsg && (
                <div role="status" className={`notice ${nameMsg.ok ? 'notice--ok' : 'notice--error'} mt-4 text-left`}>
                  <span className="notice__icon" aria-hidden="true">{nameMsg.ok ? '\u2713' : '!'}</span>
                  <p>{nameMsg.text}</p>
                </div>
              )}
            </div>

            <div className="mt-7">
              <CertificateRenderer participant={participantForRenderer as any} onImageGenerated={onImageGenerated} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="step-enter">
      <h2 className="record-sm">{title}</h2>
      {subtitle && <p className="mt-3 max-w-[60ch]" style={{ color: 'var(--color-body)' }}>{subtitle}</p>}
      <div className="mt-7">{children}</div>
    </div>
  );
}

function Actions({ onNext, label, busy }: { onNext: () => void; label: string; busy: boolean }) {
  return (
    <div className="mt-6 flex justify-end">
      <button onClick={onNext} disabled={busy} className="btn-primary">
        {busy ? (<><span className="spinner" aria-hidden="true" /> Checking…</>) : (<>{label} <span aria-hidden="true">&rarr;</span></>)}
      </button>
    </div>
  );
}
