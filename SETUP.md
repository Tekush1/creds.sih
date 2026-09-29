# Smart India Hackathon Certificate Portal - Setup

## 1. Environment
Copy `.env.example` to `.env.local` and fill in the SIH Supabase project:

```
VITE_SUPABASE_URL=https://ygqnuovftgeodcsdfxwu.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

On Vercel, add the same two variables under Project Settings -> Environment Variables.

## 2. Database
Run `supabase_schema.sql` once in the Supabase SQL Editor (already applied to the `sih` project).
It creates the tables, row-level security, and the functions the site calls
(`roster_lookup_email`, `issue_cert`, `verify_cert`, `import_roster`, `roster_counts`) and seeds one event:
`sih` -> `Smart India Hackathon 2026`, certificate IDs `SIH-2026-XXXXXX` (Participant) and `SIH-2026-GF-XXXXXX` (Grand Finale).

## 3. Admin
Add an admin email, then create the same user in Authentication -> Users:

```sql
insert into public.admins (email) values ('you@example.com') on conflict do nothing;
```

Log in at `/admin/login`.

## 4. Import the roster (CSV)
In `/admin`, pick the event and round, upload the CSV. Uploading replaces that round's roster.
Rounds: `qualifier` = Participant, `finals` = Grand Finale.

## 5. Run
```bash
npm install
npm run dev
```
