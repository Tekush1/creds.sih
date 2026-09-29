/* ============================================================================
   Header.
   ----------------------------------------------------------------------------
   THE ADMIN-VISIBILITY LOGIC IS UNCHANGED: currentSession() on mount, the
   is_admin RPC behind it, the onAuthChange subscription and its unsubscribe
   in the cleanup. The /admin link is a convenience for a signed-in operator;
   the footer link to /admin/login is the actual door and lives in App.tsx.

   The home link is just the product name, "Credentials".
   ========================================================================== */

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { currentSession, isAdmin, onAuthChange } from '../data/admin';

export default function Header() {
  const loc = useLocation();
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await currentSession();
      if (cancelled) return;
      if (s) setShowAdmin(await isAdmin());
    })();
    const sub = onAuthChange(async (email) => {
      if (email) setShowAdmin(await isAdmin());
      else setShowAdmin(false);
    });
    return () => { cancelled = true; sub.data.subscription.unsubscribe(); };
  }, []);

  const on = (p: string) => (p === '/' ? loc.pathname === '/' : loc.pathname.startsWith(p));

  return (
    // Glass, never an opaque bar: an opaque sticky layer over the fixed WebGL
    // canvas trips Chrome's occlusion culling on scrollable pages and leaves
    // a dead band along the bottom of the viewport.
    <header className="site-header sticky top-0 z-30">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-6">
        <Link to="/" viewTransition className="brand" aria-label="Credentials — home">
          <span className="brand__product">Credentials</span>
        </Link>

        <nav className="navpill" aria-label="Main">
          <NavLink to="/"       label="Events" active={on('/') || loc.pathname.startsWith('/event')} />
          <NavLink to="/verify" label="Verify" active={on('/verify')} />
          {showAdmin && <NavLink to="/admin" label="Admin" active={on('/admin')} />}
        </nav>
      </div>
    </header>
  );
}

function NavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      viewTransition
      aria-current={active ? 'page' : undefined}
      className="navpill__item"
      data-active={active || undefined}
    >
      {label}
    </Link>
  );
}
