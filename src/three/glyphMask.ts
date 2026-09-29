/* ============================================================================
   glyphMask — the typed name as a boundary condition of the physics.
   ----------------------------------------------------------------------------
   This produces ONE thing: an offscreen canvas carrying only the glyph layer,
   white on black, at the real 1.3837:1 section aspect. It is not the
   certificate. The exported PNG is, and stays, the job of
   src/components/CertificateRenderer.tsx — WebGL capture varies by GPU and
   colour profile and a credential must not.

   TIMING IS THE USABILITY FIX. This runs exactly ONCE, on commit, for the
   RESORB beat. It never runs per keystroke: the name field is crisp DOM during
   entry, and rasterising a mask on every character would make the single most
   consequential input in the product the least legible thing on screen.

   THE SHOULDER IS DELIBERATE. Glyphs are stroked outward at falling alpha
   before they are filled, so the mask carries a short ramp outside each letter
   rather than a hard step. The solver reads > 0.5 as a hard Dirichlet wall;
   the slab reads the ramp as the 0.6mm bevel that catches the cold rake. One
   texture, two jobs, no blur filter and no SDF pass on the main thread.
   ========================================================================== */

/** 1024 x 740 is 1.3837:1, the aspect of the shipped 1475x1066 templates. */
export const ETCH_W = 1024;
export const ETCH_H = 740;

/** Where the name sits in slab uv. Just below centre, across the fracture. */
const BASE_V = 0.44;

const MAX_PX = 104;
const MIN_PX = 46;
const MEASURE = 0.78;

export interface EtchBox {
  /** Normalised slab-uv bounding box of the typed name. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxes = new WeakMap<HTMLCanvasElement, EtchBox>();

/** The text bbox of a mask, in slab uv. Consumed by the slab's luminance
 *  clamp, which is what guarantees the name's contrast against the matrix at
 *  every simulation state instead of leaving it to a per-screen judgement. */
export const etchBBoxOf = (canvas: HTMLCanvasElement | null): EtchBox | null =>
  canvas ? boxes.get(canvas) ?? null : null;

const fontStack = (px: number) => `400 ${px}px "Playfair Display", Georgia, serif`;

/**
 * Rasterise a name into a fresh mask canvas. Synchronous: call
 * {@link buildEtchMask} instead unless the face is already known to be loaded.
 */
export function drawEtchMask(name: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ETCH_W;
  canvas.height = ETCH_H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, ETCH_W, ETCH_H);

  const text = (name ?? '').trim();
  if (!text) {
    boxes.set(canvas, { x: 0.5, y: BASE_V, w: 0, h: 0 });
    return canvas;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Auto-fit. The record is Playfair 400 and only Playfair 400 — a long name
  // gets smaller, it never changes face and it never wraps.
  let px = MAX_PX;
  const limit = ETCH_W * MEASURE;
  for (; px > MIN_PX; px -= 2) {
    ctx.font = fontStack(px);
    if (ctx.measureText(text).width <= limit) break;
  }
  ctx.font = fontStack(px);

  const m = ctx.measureText(text);
  let width = m.width;
  if (width > limit) width = limit;

  const cx = ETCH_W / 2;
  const cy = (1 - BASE_V) * ETCH_H;

  ctx.save();
  if (m.width > limit) ctx.setTransform(limit / m.width, 0, 0, 1, cx * (1 - limit / m.width), 0);

  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // The ramp: three outward strokes at falling alpha, then the solid fill.
  const shoulder: Array<[number, string]> = [
    [11, 'rgba(255,255,255,0.22)'],
    [7, 'rgba(255,255,255,0.46)'],
    [3.5, 'rgba(255,255,255,0.74)'],
  ];
  for (const [w, colour] of shoulder) {
    ctx.lineWidth = w;
    ctx.strokeStyle = colour;
    ctx.strokeText(text, cx, cy);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, cx, cy);
  ctx.restore();

  const ascent = m.actualBoundingBoxAscent || px * 0.72;
  const descent = m.actualBoundingBoxDescent || px * 0.28;

  boxes.set(canvas, {
    x: cx / ETCH_W,
    y: BASE_V,
    w: Math.min(width + 22, ETCH_W) / ETCH_W,
    h: (ascent + descent + 22) / ETCH_H,
  });

  return canvas;
}

/**
 * Load the display face, then rasterise. Playfair Display is already imported
 * by src/index.css, so this resolves from cache on every real visit and costs
 * no new font request.
 */
export async function buildEtchMask(name: string): Promise<HTMLCanvasElement> {
  try {
    if (typeof document !== 'undefined' && document.fonts) {
      await document.fonts.load(fontStack(MAX_PX), name || 'A');
    }
  } catch {
    /* A missing face falls back to Georgia; the mask is still correct. */
  }
  return drawEtchMask(name);
}
