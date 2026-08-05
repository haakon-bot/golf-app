-- Scramble / lag-scoring (SPILLAPP-SPEC.md §5.1) — increment 1.
-- Forutsetter at 2026-08-spillmotor.sql allerede er kjørt (games, game_teams,
-- game_events, scores.team_id + one-of-check finnes fra før).
--
-- KJØR I SUPABASE SQL EDITOR FØR DEPLOY av koden som scorer på lag.
-- Idempotent (IF NOT EXISTS).

-- ============================================================
-- Unik indeks for lag-scores, så adjustTeamScore kan upserte med
-- onConflict = (round_id, team_id, hole_number).
--
-- Bevisst IKKE partiell (ingen WHERE team_id is not null): PostgREST/
-- supabase-js sin onConflict kan ikke inferere en partiell indeks. En full
-- indeks er trygg fordi spillerscores har team_id = NULL, og NULL regnes som
-- distinkt i unike indekser (spillerrader kolliderer aldri her; de dekkes
-- fortsatt av sin egen (round_id, player_id, hole_number)-constraint).
-- ============================================================
create unique index if not exists scores_round_team_hole_uniq
  on scores (round_id, team_id, hole_number);
