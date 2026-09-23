-- Strammer inn turnering-redigering til admin (aug/sep 2026-avklaring):
-- "Alle kan starte en turnering. Bare admin kan redigere inne i en turnering."
-- Runder er BEVISST utelatt — alle skal fortsatt kunne starte og redigere
-- runder som før, ingen endring der.
--
-- tournaments INSERT (opprette ny) forblir åpent for alle — kun UPDATE og
-- DELETE strammes inn. tournament_awards/tournament_adjustments (alt som
-- skjer "inne i" en turnering: navn, premier, poengjustering) strammes inn
-- på insert/update/delete, SELECT forblir åpent for alle (alle skal kunne se).
-- Kjøres i Supabase SQL editor. Idempotent (DROP+CREATE POLICY).

create or replace function _is_admin() returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and is_admin = true)
$$ language sql stable;

-- tournaments ---------------------------------------------------
drop policy if exists "tournaments update" on tournaments;
create policy "tournaments update" on tournaments for update using (_is_admin());

drop policy if exists "tournaments delete" on tournaments;
create policy "tournaments delete" on tournaments for delete using (_is_admin());

-- tournament_awards -----------------------------------------------
drop policy if exists "tournament_awards insert" on tournament_awards;
create policy "tournament_awards insert" on tournament_awards for insert with check (_is_admin());

drop policy if exists "tournament_awards delete" on tournament_awards;
create policy "tournament_awards delete" on tournament_awards for delete using (_is_admin());

-- tournament_adjustments --------------------------------------------
drop policy if exists "tournament_adjustments insert" on tournament_adjustments;
create policy "tournament_adjustments insert" on tournament_adjustments for insert with check (_is_admin());

drop policy if exists "tournament_adjustments update" on tournament_adjustments;
create policy "tournament_adjustments update" on tournament_adjustments for update using (_is_admin());

drop policy if exists "tournament_adjustments delete" on tournament_adjustments;
create policy "tournament_adjustments delete" on tournament_adjustments for delete using (_is_admin());
