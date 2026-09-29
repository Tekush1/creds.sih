/* ============================================================================
   The contract every system in src/three/ codes against.
   ----------------------------------------------------------------------------
   The governing idea: nothing about the crystal is decorative. Every parameter
   of the growth is a real field of the record, so two certificates cannot look
   alike and a given certificate always looks the same.

       hash(certificate id)  ->  seed positions, lattice orientation, vein noise
       rank                  ->  undercooling, seed count, grain-boundary count
       solves                ->  nucleation density
       chosen name           ->  a hard Dirichlet boundary the melt cannot enter

   That last one is the point of the whole piece: the person is a boundary
   condition of the physics, not a layer composited on top.
   ========================================================================== */

import type { EventKey, RoundKey } from '../types';

/* ---- The state machine --------------------------------------------------- */

export type BenchState =
  | 'BOOT'       // tier gate resolving; programs pre-warming
  | 'FRACTURE'   // 2D only, no GL context yet — the hairline propagates
  | 'INJECT'     // GL fades in beneath the crack; melt spreads along the fissure
  | 'UNDERCOOL'  // the melt visibly cools; nothing solid yet
  | 'GROW'       // seeds pop, dendrites advance under the anisotropic solve
  | 'IMPINGE'    // dendrites meet; grain boundaries form as matte seams
  | 'LOCK'       // thermal contraction, facet flash, substeps -> 0, frozen
  | 'RESORB'     // the one retreat in the whole world; fires once on commit
  | 'REGROW'     // melt refreezes around the glyphs as void inclusions
  | 'SEAL'       // facet flash, then the patina strike — the only cold colour
  | 'CLEAVE'     // download: fracture along a real cleavage plane
  | 'PROBE'      // /verify at rest: neutral bench, composition charged
  | 'NUCLEATE'   // /verify match: grows to the shape the holder saw
  | 'REFUSE'     // /verify no-match: charged, held, never nucleates
  | 'ADMIN';     // no canvas at all

/** States in which the solver must be stepping. Everything else is frozen. */
export const LIVE_STATES: ReadonlySet<BenchState> = new Set<BenchState>([
  'INJECT', 'UNDERCOOL', 'GROW', 'IMPINGE', 'RESORB', 'REGROW', 'NUCLEATE', 'REFUSE',
]);

/** States in which bloom is allowed to exist. Bloom only while molten. */
export const MOLTEN_STATES: ReadonlySet<BenchState> = new Set<BenchState>([
  'INJECT', 'UNDERCOOL', 'GROW', 'RESORB', 'REGROW', 'REFUSE',
]);

/* ---- Mineralogy ---------------------------------------------------------- */

export type MineralKey = 'sih' | 'neutral';

export interface Mineral {
  key: MineralKey;
  /** Human-readable, printed in the provenance panel. */
  label: string;
  /** Crystal habit — the k in the anisotropy term. Drives branch symmetry. */
  habit: number;
  /** Matrix (the pale host rock). Always bone; the vein is what changes. */
  matrix: [number, number, number];
  /** The vein metal/mineral at rest. */
  vein: [number, number, number];
  /** The live crystallization front — the hottest visible colour. */
  front: [number, number, number];
  /** Oxidised cooled edge. */
  rim: [number, number, number];
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  // sRGB -> linear, because the renderer works in linear and tonemaps on output.
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [
    toLinear(((n >> 16) & 255) / 255),
    toLinear(((n >> 8) & 255) / 255),
    toLinear((n & 255) / 255),
  ];
};

export const MINERALS: Record<MineralKey, Mineral> = {
  sih: {
    key: 'sih',
    label: 'native copper in quartz',
    habit: 6,                       // hexagonal
    matrix: rgb('#EDE4D4'),
    vein:   rgb('#D9660B'),
    front:  rgb('#FF9933'),
    rim:    rgb('#7A3A0A'),
  },
  neutral: {
    key: 'neutral',
    label: 'smoky quartz with pyrite',
    habit: 6,
    matrix: rgb('#EDE4D4'),
    vein:   rgb('#B9AE93'),
    front:  rgb('#F7EBD2'),
    rim:    rgb('#4C4133'),
  },
};

export function mineralForEvent(e: EventKey | null | undefined): Mineral {
  if (e === 'sih') return MINERALS.sih;
  return MINERALS.neutral;
}

/* ---- Deterministic derivation from the record ---------------------------- */

/** FNV-1a. Small, stable across engines, and good enough to decorrelate. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic [0,1) stream seeded from a certificate id. */
export function seededStream(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0x100000000;
  };
}

export interface SpecimenParams {
  /** Nucleation sites in field UV space, [0,1]^2. */
  seeds: Array<{ x: number; y: number }>;
  /** Lattice orientation in radians. Rotates the whole anisotropy field. */
  theta0: number;
  /** Domain offset for the vein noise, so two specimens never share a pattern. */
  veinOffset: [number, number];
  /** Undercooling. Higher = faster, more chaotic growth, more grains. */
  undercooling: number;
  /** Compression bands readable on the cut edge. Steps by rank tier. */
  bandCount: number;
  /** Craft density — steps by rank decade, so a top finish is visibly finer. */
  craft: number;
  /** True when rank is good enough to grow a clear single crystal. */
  singleCrystal: boolean;
  mineral: Mineral;
  /** Human-readable provenance lines. Every derived value states its source. */
  provenance: Array<{ key: string; value: string; from: string }>;
}

export interface RecordInput {
  certId: string;
  event: EventKey | null;
  round?: RoundKey;
  rank: number;
  fieldSize: number;
  solves?: number | null;
  points?: number | null;
}

/**
 * Turn a certificate into a crystal. Pure and deterministic: the same record
 * always grows the same specimen, which is what makes it a recognition
 * signature rather than an ornament.
 *
 * Rank is physical and never insulting. A high rank nucleates few seeds and
 * grows one clear crystal with near-mirror faces; a lower rank grows a
 * polycrystalline aggregate with visible matte grain boundaries. Both are
 * handsome — the read is in fineness of manufacture, not size or brightness.
 */
export function deriveSpecimen(input: RecordInput): SpecimenParams {
  const { certId, event, rank, fieldSize, solves } = input;
  const h = hashString(certId);
  const rnd = seededStream(h);

  const theta0 = rnd() * Math.PI * 2;
  const veinOffset: [number, number] = [rnd() * 64, rnd() * 64];

  // Rank -> how ordered the growth is. Top finishes are calmer and cleaner.
  const tier = rank <= 3 ? 0 : rank <= 10 ? 1 : rank <= 25 ? 2 : rank <= 75 ? 3 : 4;
  const singleCrystal = tier <= 1;
  const seedCount = [1, 2, 3, 5, 8][tier];
  const undercooling = [0.42, 0.48, 0.55, 0.63, 0.72][tier];
  const bandCount = [7, 6, 5, 4, 3][tier];
  const craft = [1.0, 0.86, 0.72, 0.58, 0.44][tier];

  // Solves nudge nucleation density without letting it run away.
  const solveBoost = solves && solves > 0 ? Math.min(3, Math.floor(solves / 14)) : 0;
  const n = Math.min(12, seedCount + solveBoost);

  const seeds: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    // Sites sit along the fracture (a horizontal band) and spread outward,
    // because the vein deposits in the fissure, not at random in the rock.
    const along = 0.12 + rnd() * 0.76;
    const across = 0.5 + (rnd() - 0.5) * 0.26;
    seeds.push({ x: along, y: across });
  }

  const mineral = mineralForEvent(event);

  return {
    seeds, theta0, veinOffset, undercooling, bandCount, craft, singleCrystal, mineral,
    provenance: [
      { key: 'SEEDS',  value: String(n),                        from: `rank #${rank}${fieldSize ? ` of ${fieldSize}` : ''}` },
      { key: 'HABIT',  value: `k=${mineral.habit}`,             from: `event mineralogy — ${mineral.label}` },
      { key: 'THETA0', value: `${theta0.toFixed(2)} rad`,       from: 'certificate id hash' },
      { key: 'BANDS',  value: String(bandCount),                from: 'rank tier, read on the cut edge' },
      { key: 'GRAIN',  value: singleCrystal ? 'single crystal' : 'polycrystalline', from: 'undercooling from rank' },
    ],
  };
}

/* ---- The probe (cursor) -------------------------------------------------- */

/**
 * The cursor is the COLD POINT, not a light. Crystallization requires
 * undercooling, so matter grows toward where you point because you are the
 * coldest thing in the bath. This inverts the cursor-as-torch trope and it is
 * the only reason the pointer interaction means anything physically.
 */
export interface ProbeState {
  /** Field-space position, [0,1]^2. */
  x: number;
  y: number;
  /** Smoothed speed, drives how hard the front is pulled. */
  speed: number;
  /** 0 when the pointer has never entered, 1 when active. */
  presence: number;
}

/** Frame-rate independent damping. The house rule — never a raw lerp. */
export const damp = (current: number, target: number, k: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-k * dt));

export const DAMP_POSITION = 7.0;
export const DAMP_ROTATION = 4.5;

/* ---- What the React layer hands the world -------------------------------- */

export interface BenchProps {
  state: BenchState;
  mineral: Mineral;
  specimen: SpecimenParams | null;
  /** Offscreen canvas carrying ONLY the glyph layer, used as the etch mask.
   *  Never the full certificate PNG — that stays the 2D renderers' job. */
  etchMask: HTMLCanvasElement | null;
}
