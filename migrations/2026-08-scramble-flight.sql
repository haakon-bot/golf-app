-- Multi-flight scramble (SPILLAPP-SPEC.md §2.7 G1b) — ETT LAG = ÉN FLIGHT.
-- Forutsetter at 2026-08-spillmotor.sql + 2026-08-scramble.sql er kjørt.
--
-- KJØR I SUPABASE SQL EDITOR FØR DEPLOY av G1b-koden.
-- Idempotent (IF NOT EXISTS).
--
-- ============================================================
-- game_teams.flight_id: eksplisitt, autoritativ kobling lag → flight.
-- Appen skal VITE hvilket lag som er i hvilken flight (ikke utlede fra
-- medlemsoverlapp), så deling/gjeste-join på ulike telefoner ruter riktig
-- og live kan gruppere lagene på tvers av flightene.
--
-- Nullable: gamle single-flight-scramble-runder har ingen kobling og
-- forblir urørt (ingen historikk-migrering, jf. G1b pkt 5). ON DELETE SET
-- NULL så en slettet flight ikke etterlater en dinglende referanse.
-- ============================================================
alter table game_teams
  add column if not exists flight_id uuid references flights(id) on delete set null;

create index if not exists game_teams_flight_id_idx on game_teams (flight_id);
