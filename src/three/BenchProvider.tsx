/* ============================================================================
   BenchProvider — the context and the state machine that drive the world.
   ----------------------------------------------------------------------------
   A page imports NOTHING from three.js. It calls

       const { setState, setSpecimen, setMineral, setEtchMask, state } = useBench();

   and the world follows. That separation is what lets the claim flow be built,
   reviewed and shipped with WebGL entirely disabled — which is the acceptance
   gate for this whole project.

   THE SCRIPTED BEATS LIVE HERE, not in the pages. A page announces a fact
   ("the record is claimed", "this id verified"), and the machine decides how
   long the world spends undercooling, growing, impinging and freezing. Every
   duration is scaled by an entrance budget computed once, because the full
   4.2s sequence is for a first visit on a real machine and nobody else.
   ========================================================================== */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  LIVE_STATES,
  MINERALS,
  mineralForEvent,
  type BenchState,
  type Mineral,
  type MineralKey,
  type SpecimenParams,
} from './contract';
import type { EventKey } from '../types';
import {
  initialTier,
  profileFor,
  motionAllowed,
  motionPreference,
  setMotionPreference,
  type Tier,
  type TierProfile,
} from './tiers';
import { buildEtchMask } from './glyphMask';

/* ---- route awareness without a router dependency -------------------------- */

let historyPatched = false;
function patchHistory() {
  if (historyPatched || typeof window === 'undefined') return;
  historyPatched = true;
  for (const key of ['pushState', 'replaceState'] as const) {
    const original = history[key];
    history[key] = function patched(this: History, ...args: unknown[]) {
      const result = (original as (...a: unknown[]) => unknown).apply(this, args);
      // Deferred, and that matters. React Router calls pushState from inside
      // its own render work; dispatching synchronously would notify this
      // store's subscriber mid-render and React would warn that BenchProvider
      // is being updated while a different component renders. A microtask
      // lands the notification after the commit, and useSyncExternalStore
      // simply re-reads the snapshot then.
      queueMicrotask(() => window.dispatchEvent(new Event('creds:navigate')));
      return result;
    } as typeof history.pushState;
  }
}

function subscribePath(onChange: () => void) {
  patchHistory();
  window.addEventListener('popstate', onChange);
  window.addEventListener('creds:navigate', onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('creds:navigate', onChange);
  };
}

const pathSnapshot = () => (typeof window === 'undefined' ? '/' : window.location.pathname);

/* ---- the scripted beats --------------------------------------------------- */

/** Milliseconds at full budget, and the state each one hands off to. */
const BEATS: Partial<Record<BenchState, { ms: number; next: BenchState; entrance?: boolean }>> = {
  FRACTURE: { ms: 600, next: 'INJECT', entrance: true },
  INJECT: { ms: 1000, next: 'UNDERCOOL', entrance: true },
  UNDERCOOL: { ms: 700, next: 'GROW', entrance: true },
  GROW: { ms: 900, next: 'IMPINGE', entrance: true },
  IMPINGE: { ms: 1000, next: 'LOCK', entrance: true },
  RESORB: { ms: 900, next: 'REGROW' },
  REGROW: { ms: 1400, next: 'SEAL' },
  SEAL: { ms: 700, next: 'LOCK' },
  CLEAVE: { ms: 900, next: 'LOCK' },
  NUCLEATE: { ms: 1700, next: 'IMPINGE' },
};

const ENTRANCE_CHAIN: ReadonlySet<BenchState> = new Set<BenchState>([
  'FRACTURE',
  'INJECT',
  'UNDERCOOL',
  'GROW',
  'IMPINGE',
]);

const SEEN_KEY = 'creds.seenEntrance';

/**
 * WHO ACTUALLY SEES THE FULL SEQUENCE. The 4.2s entrance runs on a first
 * visit, at >=1024px, on Tier A or B. Everyone else gets a cut-down, and that
 * decision is made here at mount rather than deferred to analytics a
 * certificate portal — which has exactly one traffic spike, immediately after
 * a CTF ends — will never get in time to act on.
 */
function entranceBudget(tier: Tier): number {
  if (typeof window === 'undefined') return 0;
  if (tier === 'D' || !motionAllowed()) return 0;

  let seen = false;
  try {
    seen = sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    /* private mode */
  }
  if (seen) return 700 / 4200;

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (tier === 'C' || coarse || window.innerWidth < 1024) return 1200 / 4200;
  return 1;
}

/* ---- the context ---------------------------------------------------------- */

export interface BenchApi {
  state: BenchState;
  /** Drive the machine. Scripted beats schedule their own follow-on states. */
  setState: (next: BenchState) => void;
  specimen: SpecimenParams | null;
  setSpecimen: (s: SpecimenParams | null) => void;
  mineral: Mineral;
  setMineral: (m: Mineral | MineralKey | EventKey | null) => void;
  etchMask: HTMLCanvasElement | null;
  setEtchMask: (c: HTMLCanvasElement | null) => void;
  /** THE WOW MOMENT, in one call: rasterise the name once, then RESORB. */
  commitName: (name: string) => Promise<void>;
  /** The download beat. Returns once the cleave has run. */
  cleave: () => void;

  tier: Tier;
  profile: TierProfile;
  tierReason: string;
  demote: (tier: Tier, why: string) => void;
  markLost: () => void;
  contextLost: boolean;

  /** True once the record has been sealed; the camera may then go PLATE_FLAT. */
  sealed: boolean;
  /** True when the solver must not step. */
  frozen: boolean;
  entranceScale: number;

  isVerify: boolean;
  isAdmin: boolean;

  reduceMotion: boolean;
  /** Convenience inverse — what the shell needs to decide whether to animate. */
  motionOn: boolean;
  setReduceMotion: (v: boolean) => void;
}

const BenchContext = createContext<BenchApi | null>(null);

export function useBench(): BenchApi {
  const ctx = useContext(BenchContext);
  if (!ctx) {
    throw new Error('useBench() must be called inside <BenchProvider>.');
  }
  return ctx;
}

export function BenchProvider({ children }: { children: ReactNode }) {
  const path = useSyncExternalStore(subscribePath, pathSnapshot, () => '/');
  const isAdmin = path.startsWith('/admin');
  const isVerify = path.startsWith('/verify');

  const boot = useMemo(() => initialTier(), []);
  const [tier, setTier] = useState<Tier>(boot.tier);
  const [tierReason, setTierReason] = useState<string>(boot.reason);
  const [contextLost, setContextLost] = useState(false);

  const [state, setStateRaw] = useState<BenchState>(isAdmin ? 'ADMIN' : 'BOOT');
  const [specimen, setSpecimen] = useState<SpecimenParams | null>(null);
  const [mineral, setMineralRaw] = useState<Mineral>(MINERALS.neutral);
  const [etchMask, setEtchMask] = useState<HTMLCanvasElement | null>(null);
  const [sealed, setSealed] = useState(false);
  const [refusalHeld, setRefusalHeld] = useState(false);
  const [reduceMotion, setReduceMotionState] = useState(() => !motionAllowed());

  const entranceScale = useMemo(() => entranceBudget(tier), [tier]);
  const timer = useRef<number | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const setState = useCallback(
    (next: BenchState) => {
      clearTimer();
      setStateRaw(next);
      if (next === 'SEAL') setSealed(true);
      if (next === 'FRACTURE' || next === 'BOOT') {
        setSealed(false);
        setRefusalHeld(false);
      }
      if (next === 'REFUSE') setRefusalHeld(false);
    },
    [],
  );

  /* ---- the beat scheduler ------------------------------------------------ */

  useEffect(() => {
    if (isAdmin) return;

    if (state === 'REFUSE') {
      // THE HONEST NEGATIVE: charged, held at temperature, and it never
      // nucleates. After 2.2s the field cools to a dull pyrite grey and stops
      // costing anything. The plain-language DOM error stays beside it,
      // unchanged and actionable — a network failure and a forgery must not be
      // indistinguishable to a recruiter.
      const ms = reduceMotion ? 0 : 2200;
      timer.current = window.setTimeout(() => setRefusalHeld(true), ms);
      return clearTimer;
    }

    const beat = BEATS[state];
    if (!beat) return;

    const scale = beat.entrance ? entranceScale : reduceMotion ? 0 : 1;
    const ms = Math.round(beat.ms * scale);

    if (beat.entrance && entranceScale === 0) {
      // Reduced motion and Tier D start at the frozen end state.
      setStateRaw('LOCK');
      return;
    }

    timer.current = window.setTimeout(() => {
      timer.current = null;
      setStateRaw(beat.next);
      if (beat.next === 'SEAL') setSealed(true);
      if (beat.next === 'LOCK' && ENTRANCE_CHAIN.has(state)) {
        try {
          sessionStorage.setItem(SEEN_KEY, '1');
        } catch {
          /* private mode */
        }
      }
    }, ms);

    return clearTimer;
  }, [state, entranceScale, reduceMotion, isAdmin]);

  /* ---- escape ------------------------------------------------------------ */

  useEffect(() => {
    if (!ENTRANCE_CHAIN.has(state)) return;
    const escape = () => {
      clearTimer();
      setStateRaw('LOCK');
      try {
        sessionStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* private mode */
      }
    };
    const opts = { passive: true } as AddEventListenerOptions;
    window.addEventListener('pointerdown', escape, opts);
    window.addEventListener('keydown', escape, opts);
    window.addEventListener('touchstart', escape, opts);
    window.addEventListener('wheel', escape, opts);
    return () => {
      window.removeEventListener('pointerdown', escape);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('touchstart', escape);
      window.removeEventListener('wheel', escape);
    };
  }, [state]);

  /* ---- route changes ----------------------------------------------------- */

  useEffect(() => {
    if (isAdmin) {
      clearTimer();
      setStateRaw('ADMIN');
    }
  }, [isAdmin]);

  /* ---- mineral ----------------------------------------------------------- */

  const setMineral = useCallback((m: Mineral | MineralKey | EventKey | null) => {
    if (!m) {
      setMineralRaw(MINERALS.neutral);
      return;
    }
    if (typeof m === 'string') {
      setMineralRaw(m in MINERALS ? MINERALS[m as MineralKey] : mineralForEvent(m as EventKey));
      return;
    }
    setMineralRaw(m);
  }, []);

  // One assignment re-minerals the entire page: src/index.css keys --vein off
  // this attribute, so the DOM and the world never disagree about the event.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.mineral = mineral.key;
  }, [mineral.key]);

  // Surfaced so the chosen tier and the reason for it are inspectable from
  // devtools without shipping a debug panel. When someone reports "nothing
  // moves", this is the first thing to read.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.tier = tier;
    el.dataset.tierReason = tierReason;
    // data-motion is load-bearing, not diagnostic: the blanket
    // prefers-reduced-motion block in index.css defers to [data-motion="on"],
    // which is how an explicit opt-in beats the OS hint.
    const pref = motionPreference();
    if (pref === 'auto') delete el.dataset.motion;
    else el.dataset.motion = pref;
  }, [tier, tierReason, reduceMotion]);

  /* ---- the wow moment ---------------------------------------------------- */

  const commitName = useCallback(
    async (name: string) => {
      const mask = await buildEtchMask(name);
      setEtchMask(mask);
      setState('RESORB');
    },
    [setState],
  );

  const cleave = useCallback(() => setState('CLEAVE'), [setState]);

  /* ---- tier -------------------------------------------------------------- */

  // The governor owns the one documented promotion — the boot probe, before
  // anything has been shown at the lower tier. Everything after that is
  // DOWNGRADE ONLY, because quality that oscillates reads to a user as
  // stutter, which is worse than being one tier too conservative for a visit.
  const tierSettled = useRef(false);

  const demote = useCallback((next: Tier, why: string) => {
    setTier((current) => {
      if (!tierSettled.current) {
        tierSettled.current = true;
        return next;
      }
      const order: Tier[] = ['A', 'B', 'C', 'D'];
      return order.indexOf(next) > order.indexOf(current) ? next : current;
    });
    setTierReason(why);
  }, []);

  const markLost = useCallback(() => {
    tierSettled.current = true;
    setContextLost(true);
    setTier('D');
    setTierReason('WebGL context lost');
  }, []);

  /**
   * Explicit, and it writes an explicit preference in BOTH directions.
   *
   * Turning motion ON has to record 'on' rather than merely clearing the flag,
   * or a machine whose OS asks for reduced motion falls straight back into
   * Tier D and the control reads as dead. That was the bug.
   */
  const setReduceMotion = useCallback((v: boolean) => {
    tierSettled.current = true;
    setMotionPreference(v ? 'off' : 'on');
    setReduceMotionState(v);
    if (v) {
      setTier('D');
      setTierReason('motion turned off in the footer');
    }
  }, []);

  const frozen = !LIVE_STATES.has(state) || (state === 'REFUSE' && refusalHeld);

  const value = useMemo<BenchApi>(
    () => ({
      state,
      setState,
      specimen,
      setSpecimen,
      mineral,
      setMineral,
      etchMask,
      setEtchMask,
      commitName,
      cleave,
      tier,
      profile: profileFor(tier),
      tierReason,
      demote,
      markLost,
      contextLost,
      sealed,
      frozen,
      entranceScale,
      isVerify,
      isAdmin,
      reduceMotion,
      motionOn: !reduceMotion,
      setReduceMotion,
    }),
    [
      state,
      setState,
      specimen,
      mineral,
      setMineral,
      etchMask,
      commitName,
      cleave,
      tier,
      tierReason,
      demote,
      markLost,
      contextLost,
      sealed,
      frozen,
      entranceScale,
      isVerify,
      isAdmin,
      reduceMotion,
      setReduceMotion,
    ],
  );

  return <BenchContext.Provider value={value}>{children}</BenchContext.Provider>;
}
