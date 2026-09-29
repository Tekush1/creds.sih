import { supabase } from '../lib/supabase';
import type { IssuedCert } from '../types';

// Public verification goes through the verify_cert database function: one
// certificate, by its exact ID, with the email already masked. The table
// itself is readable by admins only, so nobody can list everyone's emails.
// Ids are minted uppercase; the function upper-cases and trims the input and
// compares exactly (never a pattern match).
//
// Until supabase_private_certs.sql has run the function does not exist, and
// this falls back to the old exact-match read, so the page keeps working in
// either order.
export async function verifyCert(certId: string): Promise<IssuedCert | null> {
  const id = certId.trim().toUpperCase();
  if (!id) return null;
  const { data, error } = await supabase.rpc('verify_cert', { p_id: id });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return (row as IssuedCert | undefined) ?? null;
  }
  const missing = error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '');
  if (!missing) { console.error('verifyCert', error.message); return null; }
  const legacy = await supabase.from('issued_certs').select('*').eq('id', id).maybeSingle();
  if (legacy.error) { console.error('verifyCert', legacy.error.message); return null; }
  return (legacy.data as IssuedCert | null) ?? null;
}

export async function listRecentCerts(limit = 50): Promise<IssuedCert[]> {
  const { data, error } = await supabase
    .from('issued_certs')
    .select('*')
    .order('issued_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('listRecentCerts', error.message); return []; }
  return (data ?? []) as IssuedCert[];
}
