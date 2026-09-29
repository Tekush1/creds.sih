-- =============================================================================
-- Creds Portal – Supabase schema
-- Project: ygqnuovftgeodcsdfxwu ("sih")
-- Run this ONCE in the SQL editor of the SIH Supabase project only.
-- Safe to re-run: uses `create ... if not exists` where possible and
-- `create or replace` for functions/policies.
-- =============================================================================

-- ─── EXTENSIONS ───────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- ─── EVENTS ───────────────────────────────────────────────────────────────────
create table if not exists public.events (
  key         text primary key,
  name        text not null,
  cert_prefix text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.events (key, name, cert_prefix) values
  ('sih', 'Smart India Hackathon 2026', 'SIH-2026')
on conflict (key) do update
  set name = excluded.name,
      cert_prefix = excluded.cert_prefix;

-- ─── ROSTERS ──────────────────────────────────────────────────────────────────
create table if not exists public.rosters (
  id            bigserial primary key,
  event_key     text not null references public.events(key) on delete cascade,
  round         text not null check (round in ('qualifier','finals')),
  team_name     text not null,
  rank          int  not null,
  points        int,
  solves        int,
  member_count  int,
  last_solve    timestamptz,
  captain       text,
  imported_at   timestamptz not null default now(),
  unique (event_key, round, team_name)
);

create index if not exists rosters_event_round_rank_idx
  on public.rosters (event_key, round, rank);

create index if not exists rosters_lower_team_idx
  on public.rosters (event_key, round, lower(team_name));

-- ─── ROSTER MEMBERS ───────────────────────────────────────────────────────────
create table if not exists public.roster_members (
  id          bigserial primary key,
  roster_id   bigint not null references public.rosters(id) on delete cascade,
  username    text,
  email       text not null
);

create index if not exists roster_members_roster_idx
  on public.roster_members (roster_id);

create index if not exists roster_members_lower_email_idx
  on public.roster_members (lower(email));

-- ─── ISSUED CERTS ─────────────────────────────────────────────────────────────
create table if not exists public.issued_certs (
  id           text primary key,
  event_key    text not null references public.events(key),
  round        text not null check (round in ('qualifier','finals')),
  team_name    text not null,
  rank         int  not null,
  points       int,
  email        text not null,
  chosen_name  text not null,
  issued_at    timestamptz not null default now()
);

create index if not exists issued_certs_lower_email_idx
  on public.issued_certs (lower(email));

create index if not exists issued_certs_event_round_idx
  on public.issued_certs (event_key, round);

-- One certificate per email, per event and round, for life
create unique index if not exists issued_certs_one_per_email
  on public.issued_certs (event_key, round, lower(trim(email)));

-- ─── ADMINS ───────────────────────────────────────────────────────────────────
create table if not exists public.admins (
  email       text primary key,
  added_at    timestamptz not null default now()
);

-- Add your admin AFTER running this file (replace the address, then run):
--   insert into public.admins (email) values ('you@example.com') on conflict do nothing;
-- The same address must be signed up in Supabase Auth to log in at /admin.

-- ─── HELPERS ──────────────────────────────────────────────────────────────────

-- Is the current authenticated user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Everything is locked down by default; anon can only reach data through RPCs
-- and (for issued_certs) a narrow verify path.

alter table public.events        enable row level security;
alter table public.rosters       enable row level security;
alter table public.roster_members enable row level security;
alter table public.issued_certs  enable row level security;
alter table public.admins        enable row level security;

-- Events: public read (used to render event cards); admins write.
drop policy if exists "events read"    on public.events;
drop policy if exists "events admin write" on public.events;
create policy "events read"         on public.events for select to anon, authenticated using (true);
create policy "events admin write"  on public.events for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Rosters + members: only admins can read/write. Public lookup happens via RPC
-- (SECURITY DEFINER) which returns only the safe fields.
drop policy if exists "rosters admin all"        on public.rosters;
drop policy if exists "roster_members admin all" on public.roster_members;
create policy "rosters admin all"        on public.rosters        for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "roster_members admin all" on public.roster_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Issued certs: anon can SELECT a specific row (for verify) and INSERT (through
-- an RPC that we control), can't UPDATE or DELETE. Admins can read all.
drop policy if exists "issued_certs public read" on public.issued_certs;
drop policy if exists "issued_certs admin write" on public.issued_certs;
-- No public read: anyone could otherwise list every participant's email.
-- The public verifies through verify_cert() (below), one ID at a time.
create policy "issued_certs admin write" on public.issued_certs for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admins list: only admins can see it.
drop policy if exists "admins self read"   on public.admins;
drop policy if exists "admins admin write" on public.admins;
create policy "admins self read"   on public.admins for select to authenticated using (public.is_admin());
create policy "admins admin write" on public.admins for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─── PUBLIC LOOKUP (RPC) ──────────────────────────────────────────────────────
-- Anon can call these two RPCs only. They never expose other teammates' emails.

drop function if exists public.roster_lookup(text, text, text, text);
create or replace function public.roster_lookup(
  p_event text,
  p_round text,
  p_email text,
  p_team  text
)
returns table (
  valid        boolean,
  team_name    text,
  rank         int,
  points       int,
  solves       int,
  member_count int,
  captain      text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_team  text := lower(trim(coalesce(p_team,  '')));
begin
  -- A closed event (events.is_active = false) finds nobody
  if not exists (select 1 from public.events e where e.key = p_event and e.is_active) then
    return query select false, null::text, null::int, null::int, null::int, null::int, null::text;
    return;
  end if;

  if v_email = '' or v_team = '' then
    return query select false, null::text, null::int, null::int, null::int, null::int, null::text;
    return;
  end if;

  return query
  select true, r.team_name, r.rank, r.points, r.solves, r.member_count, null::text
  from public.rosters r
  join public.roster_members m on m.roster_id = r.id
  where r.event_key = p_event
    and r.round     = p_round
    and lower(r.team_name) = v_team
    and lower(m.email)     = v_email
  limit 1;

  if not found then
    return query select false, null::text, null::int, null::int, null::int, null::int, null::text;
  end if;
end;
$$;

grant execute on function public.roster_lookup(text, text, text, text) to anon, authenticated;

-- Email-only lookup: finds the person's team from their email alone, so the
-- claim form asks for nothing but an email and a name. If an email is on
-- more than one team in a round, the best-ranked one is used. Returns the
-- same shape as roster_lookup; issue_cert is unchanged and is handed the
-- team this returns.
create or replace function public.roster_lookup_email(
  p_event text,
  p_round text,
  p_email text
)
returns table (
  valid        boolean,
  team_name    text,
  rank         int,
  points       int,
  solves       int,
  member_count int,
  captain      text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  -- A closed event (events.is_active = false) finds nobody
  if not exists (select 1 from public.events e where e.key = p_event and e.is_active) then
    return query select false, null::text, null::int, null::int, null::int, null::int, null::text;
    return;
  end if;

  if v_email = '' then
    return query select false, null::text, null::int, null::int, null::int, null::int, null::text;
    return;
  end if;

  return query
  select true, r.team_name, r.rank, r.points, r.solves, r.member_count, null::text
  from public.rosters r
  join public.roster_members m on m.roster_id = r.id
  where r.event_key = p_event
    and r.round     = p_round
    and lower(m.email) = v_email
  order by r.rank asc nulls last, r.team_name
  limit 1;

  if not found then
    return query select false, null::text, null::int, null::int, null::int, null::int, null::text;
  end if;
end;
$$;

grant execute on function public.roster_lookup_email(text, text, text) to anon, authenticated;

-- Issue-cert RPC. Validates the (email, team) belongs to the roster and then
-- inserts one row in issued_certs with a random cert id. Returns the row.
-- Chosen name is sanitized to reasonable characters + length.

drop function if exists public.issue_cert(text, text, text, text, text);
create or replace function public.issue_cert(
  p_event       text,
  p_round       text,
  p_email       text,
  p_team        text,
  p_chosen_name text
)
returns table (
  id          text,
  event_key   text,
  round       text,
  team_name   text,
  rank        int,
  points      int,
  email       text,
  chosen_name text,
  issued_at   timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_email     text := lower(trim(coalesce(p_email, '')));
  v_team      text := lower(trim(coalesce(p_team,  '')));
  v_chosen    text := trim(coalesce(p_chosen_name, ''));
  v_prefix    text;
  v_id        text;
  r_row       public.rosters%rowtype;
begin
  -- A closed event (events.is_active = false) issues nothing, not even a
  -- copy of a certificate someone already holds. Verification is separate
  -- and keeps working.
  if not exists (select 1 from public.events e where e.key = p_event and e.is_active) then
    raise exception 'certificates for this event are closed';
  end if;

  if v_email = '' or v_team = '' then
    raise exception 'email and team are required';
  end if;
  if length(v_chosen) < 1 or length(v_chosen) > 80 then
    raise exception 'chosen_name must be 1..80 characters';
  end if;
  if v_chosen !~ '^[[:alnum:] ''.,\-()&/]+$' then
    raise exception 'chosen_name contains invalid characters';
  end if;

  -- The team is found through the email, not the name alone: some teams
  -- have names that differ only in capitals ("Apex" / "apex"), and a lookup
  -- by lower(name) could land on the other one. Exact name first, then any
  -- case-insensitive match that has this email on it.
  select r.* into r_row
  from public.rosters r
  join public.roster_members m on m.roster_id = r.id
  where r.event_key = p_event
    and r.round     = p_round
    and lower(r.team_name) = v_team
    and lower(m.email) = v_email
  order by (r.team_name = trim(p_team)) desc, r.rank asc
  limit 1;

  if not found then
    raise exception 'email is not on the roster for this team';
  end if;

  -- One certificate per person, per event and round. Someone coming back
  -- for their certificate gets the one they already hold: same ID, same
  -- record, however many times they fetch it. The advisory lock makes two
  -- simultaneous claims by the same person queue up instead of racing to
  -- mint two IDs.
  perform pg_advisory_xact_lock(hashtext('issue_cert:' || p_event || ':' || p_round || ':' || v_email));

  select ic.id into v_id
  from public.issued_certs ic
  where ic.event_key = p_event
    and ic.round     = p_round
    and lower(ic.email) = v_email
  order by ic.issued_at asc, ic.id asc
  limit 1;

  if v_id is not null then
    -- The ID is for life; the name on it is theirs to correct. A returning
    -- claim with a different name updates the name on the same certificate.
    -- Also keep team, rank and points in step with the current roster, in
    -- case it was re-imported with corrections since the first claim.
    update public.issued_certs ic
       set chosen_name = v_chosen,
           team_name   = r_row.team_name,
           rank        = r_row.rank,
           points      = r_row.points
     where ic.id = v_id
       and (ic.chosen_name, ic.team_name, ic.rank, ic.points)
           is distinct from (v_chosen, r_row.team_name, r_row.rank, r_row.points);

    return query
    select ic.id, ic.event_key, ic.round, ic.team_name, ic.rank, ic.points, ic.email, ic.chosen_name, ic.issued_at
    from public.issued_certs ic
    where ic.id = v_id;
    return;
  end if;

  select e.cert_prefix into v_prefix from public.events e where e.key = p_event;
  if v_prefix is null then
    raise exception 'unknown event: %', p_event;
  end if;

  loop
    v_id := v_prefix
         || case when p_round = 'finals' then '-GF-' else '-' end
         || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.issued_certs ic where ic.id = v_id);
  end loop;

  insert into public.issued_certs (id, event_key, round, team_name, rank, points, email, chosen_name)
  values (v_id, p_event, p_round, r_row.team_name, r_row.rank, r_row.points, v_email, v_chosen);

  return query
  select ic.id, ic.event_key, ic.round, ic.team_name, ic.rank, ic.points, ic.email, ic.chosen_name, ic.issued_at
  from public.issued_certs ic
  where ic.id = v_id;
end;
$$;

grant execute on function public.issue_cert(text, text, text, text, text) to anon, authenticated;

-- Public verification: one certificate, by its exact ID, with the email
-- masked. The only way the public can read a certificate; the table itself
-- is readable by admins only.
create or replace function public.verify_cert(p_id text)
returns table (
  id          text,
  event_key   text,
  round       text,
  team_name   text,
  rank        int,
  points      int,
  email       text,
  chosen_name text,
  issued_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select ic.id, ic.event_key, ic.round, ic.team_name, ic.rank, ic.points,
         case
           when position('@' in ic.email) > 2 then
             left(ic.email, 2) || '***' || substr(ic.email, position('@' in ic.email))
           else '***' || substr(ic.email, greatest(position('@' in ic.email), 1))
         end,
         ic.chosen_name, ic.issued_at
  from public.issued_certs ic
  where ic.id = upper(trim(coalesce(p_id, '')))
  limit 1;
$$;

grant execute on function public.verify_cert(text) to anon, authenticated;

-- ─── ADMIN CSV IMPORT (RPC) ───────────────────────────────────────────────────
-- Wipes and re-imports an (event, round) roster from a JSON payload the admin
-- panel builds after parsing the CSV client-side. Only admins can call.

drop function if exists public.import_roster(text, text, jsonb);
create or replace function public.import_roster(
  p_event text,
  p_round text,
  p_rows  jsonb  -- [{ rank, team_name, points, solves, member_count, captain, last_solve, members: [{ username, email }] }, ...]
)
returns table (teams_imported int, members_imported int)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r          jsonb;
  m          jsonb;
  v_roster_id bigint;
  v_teams    int := 0;
  v_members  int := 0;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_event is null or p_round is null then
    raise exception 'event and round are required';
  end if;
  if p_round not in ('qualifier','finals') then
    raise exception 'round must be qualifier or finals';
  end if;

  delete from public.rosters where event_key = p_event and round = p_round;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    insert into public.rosters (
      event_key, round, team_name, rank, points, solves, member_count, captain, last_solve
    )
    values (
      p_event,
      p_round,
      trim(r->>'team_name'),
      nullif(r->>'rank', '')::int,
      nullif(r->>'points', '')::int,
      nullif(r->>'solves', '')::int,
      nullif(r->>'member_count', '')::int,
      nullif(r->>'captain', ''),
      nullif(r->>'last_solve', '')::timestamptz
    )
    returning id into v_roster_id;

    v_teams := v_teams + 1;

    for m in select * from jsonb_array_elements(coalesce(r->'members', '[]'::jsonb))
    loop
      if trim(coalesce(m->>'email','')) = '' then
        continue;
      end if;
      insert into public.roster_members (roster_id, username, email)
      values (v_roster_id, nullif(m->>'username',''), lower(trim(m->>'email')));
      v_members := v_members + 1;
    end loop;
  end loop;

  teams_imported   := v_teams;
  members_imported := v_members;
  return next;
end;
$$;

revoke execute on function public.import_roster(text, text, jsonb) from public, anon;
grant execute on function public.import_roster(text, text, jsonb) to authenticated;

-- ─── ADMIN LIST HELPERS ───────────────────────────────────────────────────────

-- Simple counts used by the admin dashboard.
drop function if exists public.roster_counts(text);
create or replace function public.roster_counts(p_event text)
returns table (round text, teams int, members int)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.round,
    count(distinct r.id)::int as teams,
    count(m.id)::int          as members
  from public.rosters r
  left join public.roster_members m on m.roster_id = r.id
  where r.event_key = p_event
  group by r.round
  order by r.round;
$$;

revoke execute on function public.roster_counts(text) from public, anon;
grant execute on function public.roster_counts(text) to authenticated;

-- ─── DONE ─────────────────────────────────────────────────────────────────────
-- Post-install: add your admin email (see the ADMINS section), sign that user
-- up in Supabase Auth (Authentication -> Users -> Add user), then log in at /admin.
