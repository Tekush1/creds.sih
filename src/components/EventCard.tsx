import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventInfo } from '../types';
import { motionLevel } from '../three/tiers';

/* ============================================================================
   An event, as a world.
   ----------------------------------------------------------------------------
   The card is a pane of glass with a bite taken out of its top-right corner,
   and the event sits in that bite as a planet — half inside the card, half out
   in the sky it came from. The edge of the bite is an orbit, and a satellite
   travels it, passing behind the planet and back in front, so the emblem is a
   body with depth rather than a logo in a square.

   The rest is the event stated plainly: its name at size, when and how long,
   the numbers (counted up the first time they appear), and its rounds drawn
   as a flight path — a filled node for a round that can be claimed, a hollow
   one for a round that has not been scored yet.

   The body carries the notch as a CSS mask; the planet lives OUTSIDE the
   masked element, because a mask would cut the planet out along with the
   glass.

   AND IT PRINTS. Along the bottom edge is a slot. Point at the card and the
   event's certificate comes out of it — the real template, top half first,
   under a print head of light — because that is what this site is for. The
   card is not a link to a certificate; it is the thing that issues one.
   ========================================================================== */

export default function EventCard({ ev, order = 0 }: { ev: EventInfo; order?: number }) {
  if (!ev.is_active) return <LockedCard ev={ev} order={order} />;
  return <OpenCard ev={ev} order={order} />;
}

const LockIcon = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
    <rect x="3" y="7" width="10" height="7.5" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M5.3 7V5.2a2.7 2.7 0 0 1 5.4 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/* A past event: the same card, not a link, with a lock where the claim
   button was and no certificate coming out of the slot. */
function LockedCard({ ev, order }: { ev: EventInfo; order: number }) {
  const [level] = useState(motionLevel);
  return (
    <div
      className="ev ev--locked"
      data-mineral={ev.key}
      aria-label={`${ev.title ?? ev.name}: certificates are closed`}
      style={{ '--order': order } as React.CSSProperties}
    >
      <div className="ev__body">
        <span className="ev__glow" aria-hidden="true" />
        <div className="ev__head">
          <span className="chip chip--locked">
            <LockIcon size={12} />
            Certificates closed
          </span>
        </div>
        <p className="ev__edition">{ev.edition ?? ''}</p>
        <h3 className="ev__title">{ev.title ?? ev.name}</h3>
        <p className="ev__meta">
          <span>{ev.held}</span>
          <span aria-hidden="true" className="ev__dot" />
          <span>{ev.format}</span>
        </p>
        <dl className="ev__stats">
          {ev.stats.map((s) => (
            <div key={s.label} className="ev__stat">
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
        <span className="ev__rim" aria-hidden="true" />
        <div className="ev__foot">
          <p className="ev__closed-note">Past event</p>
          <span className="ev__cta ev__cta--locked">
            <span>Locked</span>
            <span className="ev__orb" aria-hidden="true"><LockIcon size={15} /></span>
          </span>
        </div>
      </div>
      <World logo={ev.logo} emblem={ev.emblem} moving={level !== 'still'} />
      <span className="ev__lockbadge" aria-hidden="true"><LockIcon size={13} /></span>
    </div>
  );
}

function OpenCard({ ev, order }: { ev: EventInfo; order: number }) {
  const el = useRef<HTMLAnchorElement>(null);
  const [level] = useState(motionLevel);

  // The glass leans toward the pointer and catches the light where it is;
  // the planet drifts a little further than the card does, which is what
  // puts it in front. Written straight to CSS variables — this runs at
  // pointer rate and must never re-render the card.
  function track(e: React.PointerEvent) {
    const node = el.current;
    if (!node || e.pointerType !== 'mouse') return;
    const r = node.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    node.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    node.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    node.style.setProperty('--ry', `${((x - 0.5) * 6).toFixed(2)}deg`);
    node.style.setProperty('--rx', `${((0.5 - y) * 5).toFixed(2)}deg`);
    node.style.setProperty('--px', (x - 0.5).toFixed(3));
    node.style.setProperty('--py', (y - 0.5).toFixed(3));
  }
  function settle() {
    const node = el.current;
    if (!node) return;
    for (const k of ['--rx', '--ry']) node.style.setProperty(k, '0deg');
    for (const k of ['--px', '--py']) node.style.setProperty(k, '0');
  }

  return (
    <Link
      ref={el}
      to={`/event/${ev.key}`}
      viewTransition
      data-mineral={ev.key}
      onPointerMove={track}
      onPointerLeave={settle}
      className="ev"
      style={{ '--order': order } as React.CSSProperties}
    >
      <div className="ev__body">
        <span className="ev__edge" aria-hidden="true" />
        <span className="ev__glow" aria-hidden="true" />

        <div className="ev__head">
          <span className="chip" data-live style={{ '--dot': 'var(--color-patina)' } as React.CSSProperties}>
            <span className="chip__dot" />
            {ev.status === 'complete' ? 'Certificates open' : `${ev.roundLabels.qualifier} certificates open`}
          </span>
        </div>

        <p className="ev__edition">{ev.edition ?? ''}</p>
        <h3 className="ev__title">{ev.title ?? ev.name}</h3>
        <p className="ev__meta">
          <span>{ev.held}</span>
          <span aria-hidden="true" className="ev__dot" />
          <span>{ev.format}</span>
        </p>

        <dl className="ev__stats">
          {ev.stats.map((s, i) => (
            <div key={s.label} className="ev__stat">
              <dt>{s.label}</dt>
              <dd>
                <CountUp value={s.value} run={level === 'full'} delay={950 + order * 140 + i * 90} />
              </dd>
            </div>
          ))}
        </dl>

        <span className="ev__rim" aria-hidden="true" />
        <span className="ev__slotline" aria-hidden="true" />

        <div className="ev__foot">
          <FlightPath ev={ev} />
          <span className="ev__cta">
            <span>Claim certificate</span>
            <span className="ev__orb" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          </span>
        </div>
      </div>

      <World logo={ev.logo} emblem={ev.emblem} moving={level !== 'still'} />

      {ev.preview && (
        <span className="ev__slot" aria-hidden="true">
          <span className="ev__paper">
            <img src={ev.preview} alt="" width={760} height={285} loading="lazy" decoding="async" />
            <span className="ev__foil" />
          </span>
          <span className="ev__printhead" />
          <span className="ev__tag">Preview &middot; your {ev.title ?? ev.name} certificate</span>
        </span>
      )}
    </Link>
  );
}

/* ---------------------------------------------------------------------------
   The planet in the notch.

   One SVG, layered back to front: the far half of the orbit, the planet, the
   near half of the orbit. The satellite runs in both halves in lockstep and
   each half is clipped to its side of the orbit plane, so it disappears
   behind the disc and comes back round in front — occlusion without a
   z-index trick or a second clock.
   -------------------------------------------------------------------------- */
export function World({ logo, emblem, moving, bare = false }: { logo: string; emblem?: EventInfo['emblem']; moving: boolean; bare?: boolean }) {
  const size = emblem?.size ?? 58;
  const ox = emblem?.x ?? 0;
  const oy = emblem?.y ?? 0;
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (k: string) => `${k}-${raw}`;
  const TILT = -22;
  const orbit = 'M -58 0 A 58 15 0 1 1 58 0 A 58 15 0 1 1 -58 0';

  const satellite = (
    <circle r="2.6" className="ev__sat">
      {moving && <animateMotion dur="11s" repeatCount="indefinite" path={orbit} />}
    </circle>
  );

  return (
    <span className="ev__world" aria-hidden="true">
      <svg viewBox="-75 -75 150 150" width="150" height="150" overflow="visible">
        <defs>
          <clipPath id={id('disc')}><circle r="40" /></clipPath>
          <clipPath id={id('far')}><rect x="-80" y="-80" width="160" height="80" /></clipPath>
          <clipPath id={id('near')}><rect x="-80" y="0" width="160" height="80" /></clipPath>
          <radialGradient id={id('atm')}>
            <stop offset="0.80" style={{ stopColor: 'var(--vein)', stopOpacity: 0 }} />
            <stop offset="0.84" style={{ stopColor: 'var(--vein)', stopOpacity: 0.55 }} />
            <stop offset="1"    style={{ stopColor: 'var(--vein)', stopOpacity: 0 }} />
          </radialGradient>
          <radialGradient id={id('shade')} cx="0.34" cy="0.28" r="0.85">
            <stop offset="0"    stopColor="#fff" stopOpacity="0.20" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.78" stopColor="#000" stopOpacity="0.25" />
            <stop offset="1"    stopColor="#000" stopOpacity="0.70" />
          </radialGradient>
        </defs>

        {/* The edge of the bite. Same centre and radius as the mask. */}
        {!bare && <circle r="56" className="ev__cut" />}

        <g transform={`rotate(${TILT})`} clipPath={`url(#${id('far')})`}>
          <path d={orbit} className="ev__orbit ev__orbit--far" />
          {satellite}
        </g>

        <circle r="50" fill={`url(#${id('atm')})`} />
        <circle r="40" className="ev__disc" />
        <image
          href={logo}
          x={-size / 2 + ox} y={-size / 2 + oy} width={size} height={size}
          preserveAspectRatio="xMidYMid meet"
          clipPath={`url(#${id('disc')})`}
        />
        <circle r="40" fill={`url(#${id('shade')})`} />
        <circle r="40" className="ev__limb" />

        <g transform={`rotate(${TILT})`} clipPath={`url(#${id('near')})`}>
          <path d={orbit} className="ev__orbit" />
          {satellite}
        </g>
      </svg>
    </span>
  );
}

/** The rounds as a trajectory: where you can land, and where you cannot yet. */
function FlightPath({ ev }: { ev: EventInfo }) {
  const q = ev.roundOpen.qualifier;
  const f = ev.roundOpen.finals;
  return (
    <div className="ev__path">
      <span className="ev__node" data-open={q} />
      <span className="ev__line" data-open={f} />
      <span className="ev__node" data-open={f} />
      <span className="ev__node-label" data-open={q}>{ev.roundLabels.qualifier}</span>
      <span />
      <span className="ev__node-label ev__node-label--end" data-open={f}>
        {ev.roundLabels.finals}
        {!f && <span className="ev__pending"> · pending</span>}
      </span>
    </div>
  );
}

/**
 * The number, counted up once on first appearance. Screen readers get the
 * final value immediately; the width is reserved in `ch` so the digits
 * arriving never shove the neighbouring stats sideways.
 */
function CountUp({ value, run, delay }: { value: string; run: boolean; delay: number }) {
  const target = parseInt(value.replace(/[^0-9]/g, ''), 10);
  const animate = run && Number.isFinite(target);
  const [n, setN] = useState<number | null>(animate ? 0 : null);

  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const t0 = performance.now() + delay;
    const dur = 1500;
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / dur));
      setN(Math.round(target * (1 - Math.pow(1 - k, 4))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animate, target, delay]);

  // Counts up in digits, then settles on the value exactly as written ("6,000+")
  const shown = n === null || n >= target ? value : n.toLocaleString('en-US');
  return (
    <>
      <span aria-hidden="true" style={{ display: 'inline-block', minWidth: `${value.length}ch` }}>{shown}</span>
      <span className="sr-only">{value}</span>
    </>
  );
}
