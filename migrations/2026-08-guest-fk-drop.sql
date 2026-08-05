-- Gjesteprofiler, del 2 (SPILLAPP-SPEC.md §2.3): løsne profiles.id fra auth.users.
--
-- Diagnostikk (5. aug 2026) viste FK:
--   profiles_id_fkey: FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
-- Den blokkerer gjesteprofiler (uuid uten auth-bruker). Beslutning: dropp FK-en.
-- ON DELETE CASCADE er ikke nødvendig her (auth-brukere slettes nesten aldri;
-- en foreldreløs profilrad er uproblematisk). Sammen med is_guest-kolonnen +
-- RLS insert-policy (2026-08-guest-profiles.sql) gjør dette at gjester kan opprettes.
--
-- ENDRER INGEN RADER — fjerner kun constraint. Primærnøkkelen (profiles_pkey)
-- beholdes, så profiles.id er fortsatt PK/unik/NOT NULL. Idempotent.
-- KJØR I SUPABASE SQL EDITOR.

alter table profiles drop constraint if exists profiles_id_fkey;

-- Verifiser at PK fortsatt finnes (skal returnere profiles_pkey: PRIMARY KEY (id)):
select conname, pg_get_constraintdef(oid) as definition
from   pg_constraint
where  conrelid = 'public.profiles'::regclass and contype = 'p';
