-- Baneguide: kort AI-generert strategi-tekst per hull (§ "Baneguide" aug/sep 2026).
-- Additiv kolonne på eksisterende holes-tabell, ingen ny tabell, ingen RLS-endring
-- (UPDATE-policy speiler appens dokumenterte mønster: true for alle, se
-- 2026-08-spillmotor.sql). Kjøres i Supabase SQL editor. Idempotent.

alter table holes add column if not exists guide_text text;
