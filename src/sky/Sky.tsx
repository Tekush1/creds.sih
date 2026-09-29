import { useEffect, useRef, useState } from 'react';
import { useBench } from '../three/BenchProvider';
import { motionLevel } from '../three/tiers';
import { SkyEngine } from './engine';

/* ============================================================================
   The background: a galaxy the camera drifts through.
   ----------------------------------------------------------------------------
   Fixed, behind everything, never interactive — every input and button is
   ordinary DOM above it, exactly as before.

   It listens to the same bench state the pages already drive, so none of them
   change: the event a page sets tints the gas, and issuing a certificate sends
   the camera through the field at speed. If WebGL is missing or the context
   is lost, a CSS sky takes its place; nothing here can fail a claim.
   ========================================================================== */

export default function Sky() {
  const { mineral, state } = useBench();
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<SkyEngine | null>(null);
  const [level] = useState(motionLevel);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    try {
      const e = new SkyEngine(el, {
        level,
        accent: mineral.key,
        onLost: () => setFailed('context lost'),
      });
      engine.current = e;
      e.start();
    } catch (err) {
      setFailed((err as Error)?.message ?? 'WebGL unavailable');
    }
    return () => {
      engine.current?.dispose();
      engine.current = null;
    };
    // The accent is pushed by the effect below; restarting the engine for it
    // would regenerate the whole field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  // Moving between events is a short trip; the first paint is not.
  const firstAccent = useRef(true);
  useEffect(() => {
    engine.current?.setAccent(mineral.key);
    if (firstAccent.current) { firstAccent.current = false; return; }
    if (mineral.key !== 'neutral') engine.current?.warp(0.35, 1.4);
  }, [mineral.key]);

  // The certificate has been issued. This is the moment.
  const prev = useRef(state);
  useEffect(() => {
    if (state === 'RESORB' && prev.current !== 'RESORB') engine.current?.warp(1, 2.2);
    prev.current = state;
  }, [state]);

  // Inspectable from devtools when someone says the background is dead.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.sky = failed ? 'fallback' : level;
    if (failed) root.dataset.skyReason = failed;
    else delete root.dataset.skyReason;
  }, [failed, level]);

  if (failed) return <SkyFallback moving={level !== 'still'} />;
  return <canvas ref={canvas} className="sky-canvas" aria-hidden="true" />;
}

/** No WebGL at all: layered gradients for the gas and two tiled star fields
 *  drifting at different speeds, which is still depth. Pure CSS. */
function SkyFallback({ moving }: { moving: boolean }) {
  return (
    <div className="sky-fallback" data-moving={moving ? 'true' : undefined} aria-hidden="true">
      <span className="sky-fallback__stars sky-fallback__stars--far" />
      <span className="sky-fallback__stars sky-fallback__stars--near" />
    </div>
  );
}
