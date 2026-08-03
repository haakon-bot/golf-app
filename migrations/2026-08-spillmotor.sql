-- Spillmotoren (SPILLAPP-SPEC.md §3) — tre nye tabeller + lag-støtte i scores
-- Kjøres i Supabase SQL editor. Idempotent der det er trygt (IF NOT EXISTS),
-- men kjør kun én gang — ALTER-delen feiler hvis kolonnene allerede finnes.

-- ============================================================
-- 1. games — ett spill (hoved eller sidespill) knyttet til en runde
-- ============================================================
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id) on delete cascade,
  game_type text not null,          -- 'scramble', 'wolf', 'skins', ...
  is_main boolean not null default false,
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists games_round_id_idx on games(round_id);

-- ============================================================
-- 2. game_teams — lag innenfor ett spill
-- ============================================================
create table if not exists game_teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  name text,
  member_ids uuid[] not null default '{}',
  team_handicap numeric
);

create index if not exists game_teams_game_id_idx on game_teams(game_id);

-- ============================================================
-- 3. game_events — append-only hendelser (mulligan, gilligan, kølle-lodd, ...)
-- ============================================================
create table if not exists game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  hole_number int,
  player_id uuid references profiles(id),
  team_id uuid references game_teams(id),
  event_type text not null,         -- 'drive_used', 'mulligan', 'gilligan_sent', 'club_lottery', ...
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists game_events_game_id_idx on game_events(game_id);
create index if not exists game_events_round_id_idx on game_events(round_id);

-- ============================================================
-- 4. scores — lag-støtte (delt ball-spill scorer på team_id)
-- ============================================================
alter table scores alter column player_id drop not null;
alter table scores add column if not exists team_id uuid references game_teams(id);

alter table scores add constraint scores_player_or_team_check
  check (
    (player_id is not null and team_id is null) or
    (player_id is null and team_id is not null)
  );

-- ============================================================
-- RLS — speiler appens faktiske mønster (bekreftet mot pg_policies):
--   SELECT: true for alle · INSERT: uten check · UPDATE: true
--   DELETE: kun admin (profiles.is_admin) eller eier (rundens created_by)
-- Unntak: game_events er APPEND-ONLY (SPILLAPP-SPEC.md §3.1) → ingen
-- UPDATE, og DELETE kun for admin (opprydding), aldri vanlig eier.
-- Henger sammen med grants-oppryddingen (frist okt 2026), §12.
-- ============================================================

alter table games enable row level security;
alter table game_teams enable row level security;
alter table game_events enable row level security;

-- Hjelpepredikater (inline): admin = profiles.is_admin for auth.uid();
-- eier av et game = created_by på rundens rad.

-- games -------------------------------------------------------
create policy "games select" on games for select using (true);
create policy "games insert" on games for insert with check (true);
create policy "games update" on games for update using (true);
create policy "games delete" on games for delete using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  or exists (select 1 from rounds r where r.id = games.round_id and r.created_by = auth.uid())
);

-- game_teams --------------------------------------------------
create policy "game_teams select" on game_teams for select using (true);
create policy "game_teams insert" on game_teams for insert with check (true);
create policy "game_teams update" on game_teams for update using (true);
create policy "game_teams delete" on game_teams for delete using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  or exists (
    select 1 from games g join rounds r on r.id = g.round_id
    where g.id = game_teams.game_id and r.created_by = auth.uid()
  )
);

-- game_events (append-only) -----------------------------------
create policy "game_events select" on game_events for select using (true);
create policy "game_events insert" on game_events for insert with check (true);
-- bevisst INGEN update-policy → append-only
create policy "game_events delete" on game_events for delete using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
);

-- ============================================================
-- 5. BACKFILL — migrer eksisterende rounds.skins_amount → games-rad
-- Kjøres ÉN gang, ETTER at tabellene over er opprettet. Idempotent:
-- hopper over runder som allerede har en skins-games-rad.
-- rounds.skins_amount beholdes som dvalende kolonne til alt er verifisert,
-- droppes senere som del av grants-/opprydding (SPILLAPP-SPEC.md §12).
-- ============================================================
insert into games (round_id, game_type, is_main, config)
select r.id, 'skins', false, jsonb_build_object('amount', r.skins_amount)
from rounds r
where r.skins_amount is not null
  and not exists (
    select 1 from games g where g.round_id = r.id and g.game_type = 'skins'
  );
