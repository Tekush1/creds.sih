/* ============================================================================
   /admin/login — the operator door.
   ----------------------------------------------------------------------------
   The sign-in page keeps the sky (the console behind it does not), and its
   card is clear glass like every other card on the site. Nothing on the page
   depends on WebGL.

   THE LOGIC IS UNCHANGED: signInAdmin(), the isAdmin() gate behind it, the
   exact error strings and the FormEvent handler are the same lines that
   shipped. Sign-in is a submit handler and stays one — never a useEffect.
   ========================================================================== */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInAdmin, isAdmin } from '../data/admin';

export default function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await signInAdmin(email.trim().toLowerCase(), password);
      const ok = await isAdmin();
      if (!ok) throw new Error('Signed in, but this account is not authorized.');
      nav('/admin');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="above-bench mx-auto max-w-md px-5 sm:px-6 pt-14 pb-20" data-mineral="neutral">
      <span className="chip reveal" style={{ '--i': 0, '--dot': 'var(--color-brand)' } as React.CSSProperties}>
        <span className="chip__dot" /> Staff only
      </span>

      <h1 className="record mt-6 reveal" style={{ '--i': 1 } as React.CSSProperties}>
        Sign <em>in.</em>
      </h1>

      <p className="mt-5 text-[17px] leading-relaxed reveal" style={{ '--i': 2, color: 'var(--color-body)' } as React.CSSProperties}>
        Restricted access for the cyberhx team.
      </p>

      <form onSubmit={submit} className="panel form-card mt-8 reveal" style={{ '--i': 3 } as React.CSSProperties}>
        <div>
          <label htmlFor="admin-email" className="field-label">Email</label>
          <input
            id="admin-email"
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input mt-2"
            autoComplete="username"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <div className="mt-5">
          <label htmlFor="admin-password" className="field-label">Password</label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input mt-2"
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
          />
        </div>

        {/* The failure carries the message verbatim. */}
        {error && (
          <div role="alert" className="notice notice--error mt-5">
            <span className="notice__icon" aria-hidden="true">!</span>
            <div>
              <p className="notice__title">Not signed in</p>
              <p className="mt-1 text-[14.5px] leading-relaxed" style={{ color: 'var(--color-bone)' }}>{error}</p>
            </div>
          </div>
        )}

        <button type="submit" disabled={busy} className="btn-primary mt-6 w-full">
          {busy ? (<><span className="spinner" aria-hidden="true" /> Signing in…</>) : (<>Sign in <span aria-hidden="true">&rarr;</span></>)}
        </button>

        <p className="field-hint text-center">Access is granted by the platform owner.</p>
      </form>
    </div>
  );
}
