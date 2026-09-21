-- Turnering: binder flere RUNDER til én sammenlagt konkurranse over en periode
-- (f.eks. en golftur). Ren tillegging — ingen endring i spillmotoren, ingen nytt
-- game-*.js. Individuell stableford-sum regnes fra eksisterende scores/player_id-
-- rader per runde (lagspill/scramble bidrar automatisk 0, siden de scorer på
-- team_id og ikke har egne player_id-rader). Lag-vinner og sidekonkurranse
-- (nærmest pin / lengst drive) er egne, separate kåringer — slås ALDRI sammen
-- med poengsummen.
--
-- KJØR I SUPABASE SQL EDITOR FØR DEPLOY.
-- Idempotent (IF NOT EXISTS).

-- ============================================================
-- 1. tournaments — én rad per turnering (f.eks. "Golftur Spania sept 2026")
-- ============================================================
create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. rounds.tournament_id — nullable kobling, speiler flight_id-mønsteret.
-- Gamle/andre runder er urørt (null = ikke del av noen turnering).
-- ============================================================
alter table rounds
  add column if not exists tournament_id uuid references tournaments(id) on delete set null;

create index if not exists rounds_tournament_id_idx on rounds (tournament_id);

-- ============================================================
-- 3. tournament_awards — sidekonkurranse (nærmest pin / lengst drive).
-- Append-only hendelseslogg, samme mønster som game_events: teller ALDRI inn
-- i poengsummen, kun en egen tally/liste på turneringssiden.
-- ============================================================
create table if not exists tournament_awards (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_id uuid references rounds(id) on delete set null,
  hole_number int,
  award_type text not null check (award_type in ('closest_pin', 'longest_drive')),
  player_id uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists tournament_awards_tournament_id_idx on tournament_awards (tournament_id);

-- ============================================================
-- RLS — speiler mønsteret fra 2026-08-spillmotor.sql (permissivt for
-- vennegjengen nå, S1 server-side håndheving besluttes når flyten er ekte).
-- ============================================================
alter table tournaments enable row level security;
alter table tournament_awards enable row level security;

create policy "tournaments select" on tournaments for select using (true);
create policy "tournaments insert" on tournaments for insert with check (true);
create policy "tournaments update" on tournaments for update using (true);
create policy "tournaments delete" on tournaments for delete using (
  exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  or created_by = auth.uid()
);

-- tournament_awards (append-only, som game_events) ------------
create policy "tournament_awards select" on tournament_awards for select using (true);
create policy "tournament_awards insert" on tournament_awards for insert with check (true);
-- bevisst INGEN update-policy → append-only, korriger med slett + ny rad
create policy "tournament_awards delete" on tournament_awards for delete using (true);
