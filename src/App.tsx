/* ============================================================================
   The shell.
   ----------------------------------------------------------------------------
   A plain, bright page. The product is ordinary DOM — every input, button,
   label, error and link. The animated sky (<Sky />, src/sky) is still in
   the codebase but is not mounted (showSky below).

   Delete the canvas and the claim flow is an ordinary form with ordinary
   focus order, screen-reader output, zoom, selection and translate. Nothing
   below the shell is allowed to depend on WebGL existing.

   Every route shares the sky, the admin console included.
   ========================================================================== */

import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Landing from './pages/Landing';
import EventPage from './pages/EventPage';
import Verify from './pages/Verify';
import AdminLogin from './pages/AdminLogin';
import Admin from './pages/Admin';
import { BenchProvider, useBench } from './three/BenchProvider';
import { motionLevel, setMotionPreference } from './three/tiers';
import Sky from './sky/Sky';

export default function App() {
  return (
    <BenchProvider>
      <Shell />
    </BenchProvider>
  );
}

function Shell() {
  const loc = useLocation();
  // The site sits on a plain, bright background. The animated sky is kept
  // in the codebase (src/sky) but no longer mounted; flip this to bring it
  // back.
  const showSky = false;

  return (
    <>
      {showSky && (
        <>
          <Sky />
          <div className="scrim" aria-hidden="true" />
        </>
      )}

      <div className="above-bench flex min-h-screen flex-col">
        <Header />

        {/* Top-aligned and tight. The space below the content is not
            empty any more — it is where the giant rises out of the corner —
            so the page no longer needs to centre itself to look composed. */}
        <main className="site-main flex-1">
          <Routes>
            <Route path="/"             element={<Landing />} />
            <Route path="/event/:key"   element={<EventPage />} />
            <Route path="/verify"       element={<Verify />} />
            <Route path="/admin/login"  element={<AdminLogin />} />
            <Route path="/admin"        element={<Admin />} />
            <Route path="*"             element={<NotFound />} />
          </Routes>
        </main>

        <Footer />
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------
   The footer.

   It carries the only signed-out route into the console, so the Admin link is
   load-bearing and does not move, and it carries the escape hatch from the
   animation. Both are ordinary links and buttons in the tab order on every
   page, including the ones with no canvas at all.
   -------------------------------------------------------------------------- */

function Footer() {
  return (
    <footer className="site-footer mt-auto">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="footer__top">
          <div className="footer__brand">
            <Link to="/" viewTransition className="brand" aria-label="Credentials — home">
              <span className="brand__product">Credentials</span>
            </Link>
            <p className="footer__blurb">
              The official home of certificates for the Smart India Hackathon.
              Every certificate issued here can be verified here.
            </p>
          </div>

          <nav className="footer__cols" aria-label="Footer">
            <div>
              <p className="footer__head">Events</p>
              <FooterLink to="/event/sih">Smart India Hackathon 2026</FooterLink>
            </div>
            <div>
              <p className="footer__head">Certificates</p>
              <FooterLink to="/verify">Verify a certificate</FooterLink>
              {/* The only way in for a signed-out admin. Do not remove. */}
              <FooterLink to="/admin/login">Admin sign-in</FooterLink>
            </div>
          </nav>
        </div>

        <div className="footer__bottom">
          <p>&copy; 2026 All rights reserved.</p>
          <ReduceMotion />
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      viewTransition
      className="footer__link"
    >
      {children}
    </Link>
  );
}

/**
 * THE ESCAPE HATCH — and, just as importantly, the way back in.
 *
 * It writes an explicit preference in both directions rather than toggling a
 * single "reduced" flag, because the flag alone could never beat the OS hint:
 * on a machine set to reduce motion, clearing it just fell back to the OS and
 * landed in Tier D again, so the control could be clicked forever without
 * anything changing. Writing 'on' overrides the OS for this person, on this
 * browser, which is the override the OS setting is supposed to have.
 *
 * It reloads rather than tearing a live scene down, because the gate runs
 * before a single shader compiles.
 */
function ReduceMotion() {
  // 'gentle' still moves, so it offers Reduce rather than Turn on.
  const [on, setOn] = useState(() => motionLevel() !== 'still');

  function toggle() {
    setMotionPreference(on ? 'off' : 'on');
    setOn(!on);
    window.location.reload();
  }

  // A real switch, not a bracketed command: role="switch" and aria-checked
  // say what it is to assistive tech, and the thumb says it to everyone else.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      title={
        on
          ? 'Freeze the background. The page reloads.'
          : 'Turn the moving background on, even if your system asks for reduced motion. The page reloads.'
      }
      className="motion-switch"
    >
      <span className="motion-switch__label">Motion</span>
      <span className="motion-switch__track" aria-hidden="true">
        <span className="motion-switch__thumb" />
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------------------
   404 — the same bench, the same record face. A wrong URL is not an error
   state worth a different visual language.
   -------------------------------------------------------------------------- */

function NotFound() {
  const { setState, setMineral, setSpecimen, setEtchMask } = useBench();

  useEffect(() => {
    // Nothing was claimed here and nothing is being verified, so the bench
    // sits neutral with an open fracture and no specimen in it.
    setSpecimen(null);
    setEtchMask(null);
    setMineral('neutral');
    setState('FRACTURE');
  }, [setState, setMineral, setSpecimen, setEtchMask]);

  return (
    <div className="mx-auto max-w-2xl px-6 pt-10 pb-14" data-mineral="neutral">
      <h1 className="record">Not found.</h1>

      <p className="mt-6 max-w-lg text-[17px] leading-relaxed">
        If you were sent a certificate link, the ID goes in the lookup.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/" className="btn-primary">Back to events</Link>
        <Link to="/verify" className="btn-secondary">Verify a certificate</Link>
      </div>
    </div>
  );
}

