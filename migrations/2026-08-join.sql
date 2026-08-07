-- Multi-flight-konkurranse: del + bli med (SPILLAPP-SPEC §2.7, G3).
-- KJØR I SUPABASE SQL EDITOR. Additiv + idempotent (nullbare kolonner + indeks).
-- Ingen ny RLS: rounds og flight_players har allerede UPDATE-tilgang (appen
-- oppdaterer dem alt — tee-bytte, status, handicap).

-- Kort join-kode på runden (arrangøren deler den i gruppechat).
alter table rounds add column if not exists join_code text;
create unique index if not exists rounds_join_code_uniq on rounds(join_code) where join_code is not null;

-- Når en spiller «velger seg selv» i bli-med-flyten settes claimed_at →
-- navnet gråes ut for andre (mot dobbeltvalg). NULL = ikke tatt ennå.
alter table flight_players add column if not exists claimed_at timestamptz;
