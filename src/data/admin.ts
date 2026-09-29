import { supabase } from '../lib/supabase';

export async function signInAdmin(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function currentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (email: string | null) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user.email ?? null);
  });
}

export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return !!data;
}
