import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { verifyCert } from '../data/certs';
import { getEvent } from '../data/events';
import { deriveSpecimen } from '../three/contract';
import type { SpecimenParams } from '../three/contract';
import { useBench } from '../three/BenchProvider';
import type { IssuedCert } from '../types';

/* ============================================================================
   /verify — the bench, unbranded.
   ----------------------------------------------------------------------------
   THIS ROUTE IS DELIBERATELY NEUTRAL. data-mineral="neutral" pins --vein to
   smoky quartz for the whole subtree, so neither event's colour ever touches a
   verification result. A surface whose job is to say "this is real" must not
   look like marketing for the thing it is vouching for; impartiality is the
   aesthetic. The event is reported here as a fact in mono, never as a logo,
   never as a gradient, never as a brand colour.

   THE BENCH IS TOLD, NEVER ASKED. This component announces one of three facts
   and the provider owns every duration after that:

       at rest   -> PROBE      the melt is charged and nothing has formed
       match     -> NUCLEATE   seeds from the id's hash pop and the crystal
                               grows to the same shape the holder saw
       no match  -> REFUSE     charged, held at temperature, never nucleates

   A LOOKUP THAT FAILED TO COMPLETE IS NOT A REFUSAL. REFUSE is a statement
   about the record — no crystal forms at this composition. A network fault is
   a statement about us, so it returns the bench to PROBE and says so in plain
   language. A recruiter holding a shared link must never confuse "this is
   forged" with "we could not reach the database", so the two are separated in
   wording, in colour and in what the world does.

   Nothing below depends on WebGL. With the canvas absent the page is an
   ordinary form, an ordinary error and an ordinary record.
   ========================================================================== */

/** Two letters, three stars, the domain: "am***@gmail.com". Always three
 *  stars, so the length of the address is not given away either. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.replace(/\*+$/, '').slice(0, 2)}***@${domain}`;
}

/** What the last completed lookup established. Drives the world and the tone. */
type Outcome = 'idle' | 'match' | 'nomatch' | 'fault';

export default function Verify() {
  const [sp] = useSearchParams();
  const [id, setId] = useState(sp.get('id') ?? '');
  const [busy, setBusy] = useState(false);
  const [cert, setCert] = useState<IssuedCert | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Added, never substituted: the plain-language `error` string above is still
  // the thing a human reads. `outcome` only decides what the bench does and
  // which of the two failure tones the panel wears.
  const [outcome, setOutcome] = useState<Outcome>('idle');
  const [spec, setSpec] = useState<SpecimenParams | null>(null);
  const [touched, setTouched] = useState(() => (sp.get('id') ?? '').trim().length > 0);

  const { setState, setMineral, setSpecimen, setEtchMask } = useBench();

  /* The bench at rest. No record has been produced here, so there is nothing to
     etch and no specimen to grow — only a charged, neutral composition. */
  useEffect(() => {
    setSpecimen(null);
    setEtchMask(null);
    setMineral('neutral');
    setState('PROBE');
  }, [setState, setMineral, setSpecimen, setEtchMask]);

  useEffect(() => { if (sp.get('id')) run(); /* eslint-disable-next-line */ }, []);

  async function run() {
    if (!id.trim()) return;
    setBusy(true); setError(null); setCert(null); setSearched(true);

    // Charge the composition again for the new lookup: whatever grew last time
    // is gone before this one resolves.
    setOutcome('idle');
    setSpec(null);
    setSpecimen(null);
    setState('PROBE');

    try {
      const c = await verifyCert(id);
      if (!c) {
        setError('No certificate found with that ID.');
        // THE HONEST NEGATIVE. Nothing forms, and nothing pretends to.
        setOutcome('nomatch');
        setSpecimen(null);
        setState('REFUSE');
        return;
      }
      setCert(c);
      setOutcome('match');

      // deriveSpecimen() is pure and deterministic over the stored record, so
      // the crystal that grows here is the one the holder watched grow when
      // they claimed it. Only fields that live on the certificate row are fed
      // in — verification derives from the record, never from session state it
      // has no business knowing about.
      const s = deriveSpecimen({
        certId: c.id,
        event: c.event_key,
        round: c.round,
        rank: c.rank,
        fieldSize: 0,
        solves: null,
        points: c.points,
      });
      setSpec(s);
      setSpecimen(s);
      setState('NUCLEATE');
    } catch (e: any) {
      setError(e?.message ?? String(e));
      // We did not learn anything about the record, so the bench must not
      // imply that we did. Back to charged and waiting.
      setOutcome('fault');
      setSpecimen(null);
      setState('PROBE');
    }
    finally { setBusy(false); }
  }

  const ev = cert ? getEvent(cert.event_key) : null;

  return (
    <div className="above-bench mx-auto max-w-2xl px-5 sm:px-6 pt-14 pb-20" data-mineral="neutral">
      <span className="chip reveal" style={{ '--i': 0, '--dot': 'var(--color-brand)' } as React.CSSProperties}>
        <span className="chip__dot" /> Certificate verification
      </span>
      <h1 className="record mt-6 reveal" style={{ '--i': 1 } as React.CSSProperties}>
        Is it <em>genuine?</em>
      </h1>

      <p className="mt-5 max-w-lg text-[17px] leading-relaxed reveal" style={{ '--i': 2, color: 'var(--color-body)' } as React.CSSProperties}>
        Every certificate we issue carries an ID beneath the name. Enter it to
        see the record it belongs to.
      </p>

      {/* ---- The probe ---------------------------------------------------
          Explicit trigger only. The lookup is an exact match on an id the
          holder already has, so there is no search-as-you-type and no
          suggestion list: typing must never be able to walk the table. */}
      <div className="panel form-card mt-8 reveal" style={{ '--i': 3 } as React.CSSProperties}>
        <label htmlFor="cert-id" className="field-label">
          Certificate ID
        </label>

        <div className="mt-3 flex flex-wrap gap-3">
          <div className="deposit min-w-[240px] flex-1" data-touched={touched ? 'true' : undefined}>
            <input
              id="cert-id"
              autoFocus value={id} onChange={(e) => { setId(e.target.value); setTouched(true); }}
              onFocus={() => setTouched(true)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) run(); }}
              placeholder="e.g. SIH-2026-BC2142" className="input mono"
              autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
              aria-describedby="cert-id-help"
              aria-invalid={outcome === 'nomatch' ? true : undefined}
            />
          </div>
          <button onClick={run} disabled={busy} className="btn-primary">{busy ? (<><span className="spinner" aria-hidden="true" /> Checking…</>) : 'Verify'}</button>
        </div>

        <p id="cert-id-help" className="field-hint">
          Letters and digits, e.g. SIH-2026-A1B2C3. Case doesn't matter.
        </p>
      </div>

      <div role="status" aria-live="polite" aria-busy={busy || undefined}>
        {error && (
          <Fault
            tone={outcome === 'nomatch' ? 'refusal' : 'alarm'}
            heading={outcome === 'nomatch' ? 'Not a certificate we issued' : 'The lookup did not complete'}
            note={
              outcome === 'nomatch'
                ? 'Check the ID against the certificate itself — characters are letters and digits only, and the ID is the line printed beneath the name. If it is copied exactly and still does not resolve, this document was not issued by cyberhx.'
                : 'This is a problem reaching our records, not a judgement on the certificate. Nothing has been ruled out. Try again in a moment.'
            }
          >
            {error}
          </Fault>
        )}

        {cert && <Record cert={cert} ev={ev} />}

        {searched && !busy && !cert && !error && (
          <p className="field-hint mt-8">No result.</p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   THE RECORD. Playfair for the name, mono for every field, and not one
   branded pixel — the event is a fact reported about this certificate, the
   same way rank and issue date are.
   -------------------------------------------------------------------------- */
function Record({
  cert,
  ev,
}: {
  cert: IssuedCert;
  ev: ReturnType<typeof getEvent>;
}) {
  const issued = new Date(cert.issued_at).toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <section className="mt-8 step-enter" data-mineral={ev?.key ?? 'neutral'}>
      <div className="panel verified">
        <div className="verified__top">
          <span className="verified__seal" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div>
            <p className="verified__kicker">Verified by cyberhx</p>
            <p className="verified__sub">This certificate is genuine and on record.</p>
          </div>
        </div>

        <h2 className="verified__name">{cert.chosen_name}</h2>
        <p className="verified__event">
          {ev ? ev.roundLabels[cert.round] : cert.round} &middot; {ev ? ev.name : cert.event_key}
        </p>

        <dl className="verified__grid">
          <Fact label="Team"           value={cert.team_name} />
          <Fact label="Rank"           value={`#${cert.rank}`} tint="var(--vein)" />
          <Fact label="Issued"         value={issued} />
          <Fact label="Certificate ID" value={cert.id} mono />
          <Fact label="Email"          value={maskEmail(cert.email)} mono nowrap />
        </dl>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   The two failures, kept visibly apart.

   refusal — dull pyrite, the same grey as a disabled control, because a
             forgery is inert rather than alarming. The record simply is not
             there and no amount of retrying will change that.
   alarm   — the lookup broke. Actionable, so it is allowed to be loud.

   In both cases the original error string is printed verbatim, first.
   -------------------------------------------------------------------------- */
function Fault({
  tone,
  heading,
  note,
  children,
}: {
  tone: 'refusal' | 'alarm';
  heading: string;
  note: string;
  children: any;
}) {
  return (
    // No nested live region here: the wrapper is already role="status", and
    // two of them announce the same failure twice.
    <section className="mt-8 step-enter">
      <div className={`notice ${tone === 'refusal' ? 'notice--refusal' : 'notice--error'}`}>
        <span className="notice__icon" aria-hidden="true">{tone === 'refusal' ? '?' : '!'}</span>
        <div>
          <p className="notice__title">{heading}</p>
          <p className="mt-1.5" style={{ color: 'var(--color-bone)' }}>{children}</p>
          <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed" style={{ color: 'var(--color-body)' }}>{note}</p>
        </div>
      </div>
    </section>
  );
}

/** One field of the record. */
function Fact({ label, value, tint, mono, nowrap }: { label: string; value: string; tint?: string; mono?: boolean; nowrap?: boolean }) {
  const cls = ['verified__value', mono && 'verified__value--mono', nowrap && 'verified__value--nowrap'].filter(Boolean).join(' ');
  return (
    <div>
      <dt className="field-label">{label}</dt>
      <dd className={cls} style={tint ? { color: tint } : undefined} title={nowrap ? value : undefined}>{value}</dd>
    </div>
  );
}

