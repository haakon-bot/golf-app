-- Gjeste-skriving u/login (SPILLAPP-SPEC §2.7 G4 / S1-avklaring).
-- Diagnostikk (10. aug 2026) viste: scores INSERT/UPDATE + flight_players INSERT
-- er allerede {public} (anon kan score + bli lagt til). To hull:
--   1) flight_players har INGEN update-policy → claimed_at (claim-gråing) OG
--      edit-modus-HCP (wizardSave) feiler for ALLE. Latent bug.
--   2) 'profiles guest insert' var 'to authenticated' → ren gjest (anon) kunne
--      ikke lage gjesteprofil.
-- Vennegjeng-modell: UI-gating holder; server-side per-flight-håndheving (ekte
-- S1) er fortsatt utsatt. KJØR I SUPABASE SQL EDITOR. Idempotent.

-- 1) UPDATE på flight_players (claim + HCP-redigering).
drop policy if exists "flight_players update" on flight_players;
create policy "flight_players update" on flight_players
  for update using (true) with check (true);

-- 2) Gjest (anon) kan opprette gjesteprofil (aldri admin, alltid is_guest).
drop policy if exists "profiles guest insert" on profiles;
create policy "profiles guest insert" on profiles
  for insert to public with check (is_guest = true and is_admin = false);
