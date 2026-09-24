-- Admin kan ikke redigere ANDRE spilleres HCP/navn under Spillere → Rediger:
-- profiles UPDATE-policy tillater sannsynligvis kun id = auth.uid() (redigere
-- sin EGEN rad), så et admin-kall på en annen spillers profil blir stille
-- filtrert bort av RLS (ingen feil, ingen rader endret). Legger til et
-- eksplisitt admin-unntak, i tillegg til selvredigering.
--
-- Gjenbruker _is_admin() fra 2026-09-tournament-admin-lock.sql. Kjør DEN
-- migrasjonen først hvis den ikke allerede er kjørt. Kjøres i Supabase
-- SQL editor. Idempotent.

drop policy if exists "profiles update" on profiles;
create policy "profiles update" on profiles for update using (
  id = auth.uid() or _is_admin()
);
