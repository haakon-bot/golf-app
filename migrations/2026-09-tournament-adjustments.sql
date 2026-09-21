-- Sikkerhetsventil: manuell poeng-justering i turneringsoversikten. Uavhengig
-- av all annen beregning (Stableford-sum, sidekonkurranse) — for å rette opp
-- hvis noe går galt med registrering/poeng underveis på turen, uten å måtte
-- forstå eller endre score-data i det hele tatt.
--
-- KJØR I SUPABASE SQL EDITOR FØR DEPLOY.
-- Idempotent (IF NOT EXISTS).

create table if not exists tournament_adjustments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  player_id uuid not null references profiles(id),
  points numeric not null,          -- kan være negativ (trekk fra)
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists tournament_adjustments_tournament_id_idx on tournament_adjustments (tournament_id);

alter table tournament_adjustments enable row level security;

-- Bevisst helt permissivt (select/insert/update/delete = true) — dette ER
-- rette-opp-mekanismen, å begrense den ville motvirke poenget med den.
create policy "tournament_adjustments select" on tournament_adjustments for select using (true);
create policy "tournament_adjustments insert" on tournament_adjustments for insert with check (true);
create policy "tournament_adjustments update" on tournament_adjustments for update using (true);
create policy "tournament_adjustments delete" on tournament_adjustments for delete using (true);
