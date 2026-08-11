-- ─────────────────────────────────────────────────────────────
-- FRISK START (aug 2026): slett ALLE runder frem til nå + importerte
-- Ren spillapp: fra nå av teller kun runder som faktisk spilles i appen.
--
-- ADVARSEL: Dette er IRREVERSIBELT. Kjør i Supabase SQL editor.
--
-- SLETTER: alle runder og alt som hører til (scores, flighter,
--          flight_players, spill, lag, hendelser) + hele den utgåtte
--          score_differentials-tabellen (gamle Golfbox-importer).
-- BEHOLDER: baner (courses), tee-sett, hull, spillerprofiler.
-- ─────────────────────────────────────────────────────────────

begin;

-- Barn først (FK-rekkefølge; scores kan peke på game_teams via team_id).
delete from scores;
delete from game_events;
delete from game_teams;
delete from games;
delete from flight_players;
delete from flights;

-- Selve rundene.
delete from rounds;

-- Importerte runder: feature fjernet — dropp tabellen helt.
drop table if exists score_differentials cascade;

commit;
