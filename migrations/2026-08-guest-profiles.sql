-- Gjesteprofiler (SPILLAPP-SPEC.md §2.3) — spillere uten innlogging.
-- «Navn + HCP, ferdig»: en profiles-rad uten auth-bruker.
--
-- Basert på diagnostikk (5. aug 2026): profiles.id har INGEN FK til auth.users
-- (så en generert uuid går fint), RLS er PÅ, username er NOT NULL. Appen
-- genererer id = crypto.randomUUID() og username = 'guest_<hex>'.
--
-- KJØR I SUPABASE SQL EDITOR før koden som oppretter gjester deployes.
-- Idempotent (IF NOT EXISTS / DROP+CREATE POLICY).

-- ============================================================
-- 1. Flagg gjester eksplisitt (trygg RLS + senere «claim to login»).
--    Eksisterende rader får false.
-- ============================================================
alter table profiles add column if not exists is_guest boolean not null default false;

-- ============================================================
-- 2. RLS: la innloggede opprette gjesteprofiler.
--    ADDITIV til evt. eksisterende insert-policy (permissive policyer OR-es),
--    så den vanlige signup-innsettingen (id = auth.uid()) er upåvirket.
--    with check gjør at gjester ALDRI kan opprettes som admin, og alltid er
--    flagget is_guest — ingen privilegie-eskalering via denne policyen.
-- ============================================================
drop policy if exists "profiles guest insert" on profiles;
create policy "profiles guest insert" on profiles
  for insert to authenticated
  with check (is_guest = true and is_admin = false);
