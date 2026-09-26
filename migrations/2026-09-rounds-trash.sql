-- Papirkurv for runder (sept 2026) — etter at Tramores-runden ble slettet
-- permanent ved en feil og prosjektet (free plan) ikke har backup.
--
-- Regler (håndheves HER, ikke bare i appen):
--   · Kun admin kan flytte en runde til papirkurven (sette deleted_at)
--     og gjenopprette den (nullstille deleted_at).
--   · Kun admin kan slette en runde permanent, og bare når den allerede
--     ligger i papirkurven.
--   · Andre admins får et varsel (notifications) når en runde legges i
--     papirkurven.
-- Reglene gjelder kun kall via appen/API (rollene anon/authenticated).
-- SQL Editor (postgres) er ikke begrenset, så manuell opprydding fortsatt går.
--
-- KJØR I SUPABASE SQL EDITOR FØR DEPLOY.
-- Idempotent.

alter table rounds add column if not exists deleted_at timestamptz;
alter table rounds add column if not exists deleted_by uuid references profiles(id) on delete set null;
create index if not exists rounds_deleted_at_idx on rounds (deleted_at);

-- ── Kun admin kan legge i / ta ut av papirkurven ──
create or replace function _rounds_trash_guard() returns trigger as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.deleted_at is distinct from old.deleted_at
     and not _is_admin() then
    raise exception 'Kun admin kan flytte runder til eller fra papirkurven';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists rounds_trash_guard on rounds;
create trigger rounds_trash_guard before update on rounds
  for each row execute function _rounds_trash_guard();

-- ── Permanent sletting: kun admin, og kun fra papirkurven ──
create or replace function _rounds_delete_guard() returns trigger as $$
begin
  if current_user in ('anon', 'authenticated') then
    if not _is_admin() then
      raise exception 'Kun admin kan slette runder permanent';
    end if;
    if old.deleted_at is null then
      raise exception 'Runden må ligge i papirkurven før den kan slettes permanent';
    end if;
  end if;
  return old;
end;
$$ language plpgsql;

drop trigger if exists rounds_delete_guard on rounds;
create trigger rounds_delete_guard before delete on rounds
  for each row execute function _rounds_delete_guard();

-- ── Varsel til (andre) admins når en runde legges i papirkurven ──
create or replace function _rounds_trash_notify() returns trigger as $$
declare
  course_name text;
  actor_name text;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    select name into course_name from courses where id = new.course_id;
    select display_name into actor_name from profiles where id = coalesce(new.deleted_by, auth.uid());
    insert into notifications (player_id, message)
      select p.id,
             format('🗑 %s flyttet runden %s (%s) til papirkurven',
                    coalesce(actor_name, 'Noen'), coalesce(course_name, 'ukjent bane'), new.date)
      from profiles p
      where p.is_admin = true
        and p.id is distinct from coalesce(new.deleted_by, auth.uid());
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists rounds_trash_notify on rounds;
create trigger rounds_trash_notify after update on rounds
  for each row execute function _rounds_trash_notify();

-- ── RPC-er appen kaller (sjekker admin selv; én transaksjon hver) ──
-- security definer: uavhengig av RLS-policyene på rounds/scores, så en admin
-- alltid kan rydde — og ingen andre kan.
create or replace function trash_round(rid uuid) returns void as $$
begin
  if not _is_admin() then raise exception 'Kun admin kan flytte runder til papirkurven'; end if;
  update rounds set deleted_at = now(), deleted_by = auth.uid() where id = rid and deleted_at is null;
  if not found then raise exception 'Fant ikke runden (eller den ligger allerede i papirkurven)'; end if;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function restore_round(rid uuid) returns void as $$
begin
  if not _is_admin() then raise exception 'Kun admin kan gjenopprette runder'; end if;
  update rounds set deleted_at = null, deleted_by = null where id = rid and deleted_at is not null;
  if not found then raise exception 'Fant ikke runden i papirkurven'; end if;
end;
$$ language plpgsql security definer set search_path = public;

-- Permanent: alt som hører til runden, i FK-rekkefølge, i én transaksjon.
create or replace function purge_round(rid uuid) returns void as $$
begin
  if not _is_admin() then raise exception 'Kun admin kan slette runder permanent'; end if;
  if not exists (select 1 from rounds where id = rid and deleted_at is not null) then
    raise exception 'Runden må ligge i papirkurven før den kan slettes permanent';
  end if;
  delete from scores where round_id = rid;
  delete from game_events where round_id = rid;
  delete from game_teams where game_id in (select id from games where round_id = rid);
  delete from games where round_id = rid;
  delete from flight_players where flight_id in (select id from flights where round_id = rid);
  delete from flights where round_id = rid;
  delete from rounds where id = rid;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function trash_round(uuid), restore_round(uuid), purge_round(uuid) from public, anon;
grant execute on function trash_round(uuid), restore_round(uuid), purge_round(uuid) to authenticated;
