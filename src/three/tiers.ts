/* ============================================================================
   Capability gate, tier probe and governor.
   ----------------------------------------------------------------------------
   Nothing else in src/three/ mounts until this resolves. The decision is made
   BEFORE a single shader compiles, because the expensive mistake is starting a
   scene a device cannot finish.

   Tier D is not a fallback. It is the product that ships regardless — the
   existing 2D certificate renderers already produce the real PNG — and every
   tier above it is additive.
   ========================================================================== */

export type Tier = 'A' | 'B' | 'C' | 'D';

export interface TierProfile {
  tier: Tier;
  /** Phase-field solver grid, square. Bandwidth scales with the square. */
  grid: number;
  /** Solver substeps per frame. */
  substeps: number;
  /** Hard ceiling on rendered pixels (width * height), before DPR clamp. */
  pixelBudget: number;
  /** Secondary guard on devicePixelRatio. */
  maxDpr: number;
  bloom: boolean;
  /** Depth of field is the first thing cut; it is the most expensive pass. */
  dof: boolean;
  grain: boolean;
  /** Free-standing hero specimen on landing and /verify. */
  heroPrism: boolean;
  /** Grown UI borders driven by a second, tiny field. */
  deposition: boolean;
}

const PROFILES: Record<Tier, TierProfile> = {
  A: { tier: 'A', grid: 512, substeps: 24, pixelBudget: 2_600_000, maxDpr: 2.0,  bloom: true,  dof: true,  grain: true,  heroPrism: true,  deposition: true  },
  B: { tier: 'B', grid: 320, substeps: 16, pixelBudget: 1_600_000, maxDpr: 1.5,  bloom: true,  dof: false, grain: true,  heroPrism: true,  deposition: true  },
  C: { tier: 'C', grid: 192, substeps: 8,  pixelBudget:   900_000, maxDpr: 1.25, bloom: false, dof: false, grain: true,  heroPrism: false, deposition: false },
  D: { tier: 'D', grid: 0,   substeps: 0,  pixelBudget:         0, maxDpr: 1.0,  bloom: false, dof: false, grain: true,  heroPrism: false, deposition: false },
};

export const profileFor = (t: Tier): TierProfile => PROFILES[t];

const MOTION_KEY = 'creds.motion';
const CONTEXT_LOSS_KEY = 'creds.contextLost';

const readFlag = (k: string): boolean => {
  try { return sessionStorage.getItem(k) === '1'; } catch { return false; }
};
const writeFlag = (k: string, v: boolean) => {
  try { v ? sessionStorage.setItem(k, '1') : sessionStorage.removeItem(k); } catch { /* private mode */ }
};

/** The OS-level hint. It is a DEFAULT, never a verdict — see motionAllowed(). */
export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ----------------------------------------------------------------------------
   MOTION IS TRI-STATE, and that is the whole fix.

   It used to be a boolean OR'd with the OS hint:

       if (prefersReducedMotion()) -> Tier D
       if (motionReducedByUser())  -> Tier D

   which meant that on any machine with "reduce motion" switched on at the OS
   level - a Windows default after a battery-saver prompt, an accessibility
   setting someone turned on years ago for something else - the control in the
   footer could not do the one thing its label promised. Clicking it set the
   flag and reloaded into Tier D. Clicking it again cleared the flag and
   reloaded into Tier D, because the OS check ran first and was unanswerable.
   The button was not broken; it was outvoted, every time, with no way to win.

   Three states fix it honestly:

       'auto'  follow the OS. The default, so the accessibility setting is
               still respected by every first-time visitor.
       'off'   no motion, whatever the OS says.
       'on'    motion, whatever the OS says. An explicit, in-page, per-person
               override, which is exactly the escape hatch the OS hint is
               supposed to have.

   Stored in localStorage rather than sessionStorage: a person who had to ask
   for motion twice should not have to ask again in the next tab.
   -------------------------------------------------------------------------- */

export type MotionPref = 'auto' | 'on' | 'off';

export function motionPreference(): MotionPref {
  try {
    const v = localStorage.getItem(MOTION_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch { return 'auto'; }
}

export function setMotionPreference(v: MotionPref) {
  try {
    if (v === 'auto') localStorage.removeItem(MOTION_KEY);
    else localStorage.setItem(MOTION_KEY, v);
  } catch { /* private mode */ }
}

/** Whether this visitor gets motion at all. The single source of truth. */
export function motionAllowed(): boolean {
  const pref = motionPreference();
  if (pref === 'on')  return true;
  if (pref === 'off') return false;
  return !prefersReducedMotion();
}

/**
 * How much the sky moves, as opposed to whether it moves at all.
 *
 * An OS that asks for reduced motion gets 'gentle', not stillness: the stars
 * twinkle and the gas drifts, but nothing flies toward the viewer and nothing
 * tracks the pointer — the vestibular triggers reduced-motion exists to stop.
 * Only an explicit 'off' in the footer freezes the frame.
 */
export type MotionLevel = 'full' | 'gentle' | 'still';

export function motionLevel(): MotionLevel {
  const pref = motionPreference();
  if (pref === 'on')  return 'full';
  if (pref === 'off') return 'still';
  return prefersReducedMotion() ? 'gentle' : 'full';
}

export const markContextLost = () => writeFlag(CONTEXT_LOSS_KEY, true);

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/**
 * The hard gate. Any true branch here means no canvas is ever created —
 * we do not create a context to find out.
 */
export function forcedToTierD(): string | null {
  if (typeof window === 'undefined')            return 'no window';
  if (!motionAllowed())                         return motionPreference() === 'off'
                                                  ? 'motion turned off in the footer'
                                                  : 'your system asks for reduced motion';
  if (readFlag(CONTEXT_LOSS_KEY))               return 'a WebGL context was already lost this session';

  const nav = navigator as NavigatorWithHints;
  if (nav.connection?.saveData)                 return 'Save-Data requested';
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) return 'deviceMemory < 4GB';

  // Coarse pointer on a small viewport is a phone; those get Tier C at best,
  // but only if they also clear the WebGL2 float checks below.
  const probe = probeWebGL2();
  if (!probe.ok) return probe.reason;

  return null;
}

interface GlProbe { ok: boolean; reason: string; renderer: string; parallelCompile: boolean; caveat: boolean }

/**
 * Create a throwaway context, ask it the three questions that decide whether
 * the solver is even arithmetically possible, then destroy it.
 *
 * EXT_color_buffer_float is non-negotiable: the phase field cannot be
 * integrated at 8-bit precision, so there is no degraded path — only Tier D.
 */
function probeWebGL2(): GlProbe {
  const fail = (reason: string): GlProbe => ({ ok: false, reason, renderer: '', parallelCompile: false, caveat: false });
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement('canvas');

    // Ask for the good context first. If the browser declines, ask again
    // WITHOUT the caveat flag before giving up.
    //
    // failIfMajorPerformanceCaveat is a notorious false negative: it refuses a
    // context on hybrid-graphics laptops, on partially accelerated browsers,
    // behind driver blocklists and inside VMs and remote sessions — machines
    // that render this scene perfectly well. Treating that refusal as "no
    // WebGL" silently dropped real users to a blank Tier D, which also made
    // the reduce-motion control look broken because there was never any motion
    // to reduce. A caveat is a reason to be conservative about the tier, not a
    // reason to refuse to draw.
    const opts = { antialias: false, depth: false } as const;
    let caveat = false;
    let gl = canvas.getContext('webgl2', { ...opts, failIfMajorPerformanceCaveat: true }) as WebGL2RenderingContext | null;
    if (!gl) {
      gl = canvas.getContext('webgl2', opts) as WebGL2RenderingContext | null;
      caveat = !!gl;
    }
    if (!gl) return fail('no WebGL2 context');

    // This one is not negotiable. The phase field cannot be integrated at
    // 8-bit precision, so there is no degraded path — only Tier D.
    if (!gl.getExtension('EXT_color_buffer_float')) return fail('no EXT_color_buffer_float');

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    const parallelCompile = !!gl.getExtension('KHR_parallel_shader_compile');

    // A named software rasteriser is still a refusal: the solver at 3fps is
    // worse than a still. But only when the driver actually names itself.
    if (/swiftshader|llvmpipe|softpipe|basic render/i.test(renderer)) {
      return fail(`software renderer (${renderer})`);
    }

    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, reason: caveat ? 'performance caveat reported' : '', renderer, parallelCompile, caveat };
  } catch (e) {
    return fail(`WebGL probe threw: ${(e as Error)?.message ?? e}`);
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

/** The starting tier, before the frame-timing probe refines it. */
export function initialTier(): { tier: Tier; reason: string; renderer: string } {
  const blocked = forcedToTierD();
  if (blocked) return { tier: 'D', reason: blocked, renderer: '' };

  const probe = probeWebGL2();
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600;
  const cores = navigator.hardwareConcurrency ?? 4;

  // Phones start at C and are allowed to stay there; the governor only ever
  // demotes, so an optimistic start on mobile is a guaranteed visible stutter.
  if (coarse && small) return { tier: 'C', reason: 'coarse pointer, small viewport', renderer: probe.renderer };
  // The browser warned about performance but still gave us a context. Draw,
  // but start low and let the governor decide from measured frames.
  if (probe.caveat)    return { tier: 'C', reason: 'performance caveat reported', renderer: probe.renderer };
  if (cores <= 4)      return { tier: 'B', reason: `hardwareConcurrency ${cores}`, renderer: probe.renderer };
  return { tier: 'B', reason: 'pending frame-timing probe', renderer: probe.renderer };
}

/** Size the drawing buffer to the tier's pixel budget, not to a DPR guess. */
export function resolutionFor(p: TierProfile, w: number, h: number): number {
  if (p.tier === 'D') return 1;
  const dpr = Math.min(window.devicePixelRatio || 1, p.maxDpr);
  const area = w * h * dpr * dpr;
  if (area <= p.pixelBudget) return dpr;
  return Math.max(0.75, dpr * Math.sqrt(p.pixelBudget / area));
}

/* ----------------------------------------------------------------------------
   The governor.

   One boot probe picks the tier. A rolling median demotes if the device cannot
   hold the budget. It NEVER promotes within a session — quality that
   oscillates reads to a user as stutter, which is worse than being one tier
   too conservative for the whole visit.
   -------------------------------------------------------------------------- */

export class Governor {
  private samples: number[] = [];
  private booting = true;
  private bootFrames = 0;
  private bootSamples: number[] = [];
  private overBudgetSince = 0;
  private hiddenAt = 0;

  constructor(
    private tier: Tier,
    private onChange: (t: Tier, why: string) => void,
  ) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  private onVisibility = () => {
    if (document.hidden) { this.hiddenAt = performance.now(); return; }
    // A fanless laptop three minutes into a long-lived scene is thermally
    // throttled in a way a one-shot boot probe cannot see. Re-open the probe,
    // demote-only.
    if (this.hiddenAt && performance.now() - this.hiddenAt > 60_000) {
      this.booting = true;
      this.bootFrames = 0;
      this.bootSamples = [];
    }
    this.hiddenAt = 0;
  };

  /** Call once per frame with the measured frame time in ms. */
  sample(ms: number) {
    if (this.booting) {
      this.bootFrames++;
      // Discard the first 12 frames: shader compile, texture upload and the
      // first composite land there and are not representative.
      if (this.bootFrames > 12) this.bootSamples.push(ms);
      if (this.bootSamples.length >= 28) {
        const med = median(this.bootSamples);
        this.booting = false;
        this.bootSamples = [];
        if (med > 14) this.demote(`boot probe median ${med.toFixed(1)}ms`);
        else if (med <= 9 && this.tier === 'B') {
          // The single exception to demote-only, and it happens once, before
          // anything has been shown at the lower tier.
          this.tier = 'A';
          this.onChange('A', `boot probe median ${med.toFixed(1)}ms`);
        }
      }
      return;
    }

    this.samples.push(ms);
    if (this.samples.length > 45) this.samples.shift();
    if (this.samples.length < 45) return;

    const med = median(this.samples);
    if (med > 20) {
      if (!this.overBudgetSince) this.overBudgetSince = performance.now();
      else if (performance.now() - this.overBudgetSince > 1000) {
        this.demote(`rolling median ${med.toFixed(1)}ms`);
        this.overBudgetSince = 0;
        this.samples = [];
      }
    } else {
      this.overBudgetSince = 0;
    }
  }

  private demote(why: string) {
    const next: Record<Tier, Tier> = { A: 'B', B: 'C', C: 'D', D: 'D' };
    const n = next[this.tier];
    if (n === this.tier) return;
    this.tier = n;
    this.onChange(n, why);
  }

  current(): Tier { return this.tier; }

  dispose() {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
