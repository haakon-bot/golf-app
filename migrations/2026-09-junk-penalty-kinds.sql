-- Utvider sidekonkurranse-typene med to "straffevarianter" (game-junk.js):
-- farthest_pin (lengst fra pin) og shortest_drive (kortest drive), i tillegg
-- til de eksisterende closest_pin/longest_drive. game_events.payload er jsonb
-- og trenger ingen endring, men tournament_awards.award_type har en CHECK-
-- constraint som må utvides for å holde tritt (tabellen er ikke i bruk av
-- appen ennå, men konstraint-driften er verdt å unngå). Kjøres i Supabase
-- SQL editor. Idempotent.

alter table tournament_awards drop constraint if exists tournament_awards_award_type_check;
alter table tournament_awards add constraint tournament_awards_award_type_check
  check (award_type in ('closest_pin', 'longest_drive', 'farthest_pin', 'shortest_drive'));
