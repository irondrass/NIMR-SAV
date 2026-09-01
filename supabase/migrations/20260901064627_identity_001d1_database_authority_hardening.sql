-- IDENTITY-001D1 — Database Authority Hardening Migration
-- Local migration source only. Do not execute against production until the
-- separate SQL security review and controlled deployment gate are complete.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- SHARE ROW EXCLUSIVE blocks concurrent INSERT/UPDATE/DELETE (ROW EXCLUSIVE)
-- on both authority tables while still allowing ordinary SELECT (ACCESS SHARE).
-- Both tables are locked together, in a fixed order, before any preflight read.
lock table public.workshop_members, public.planning_resources
  in share row exclusive mode;

-- Fail fast. IDENTITY-001D1 never repairs, deletes, reassigns, or promotes data.
do $identity_001d1$
begin
  if exists (
    select 1
    from public.workshop_members as wm
    left join public.planning_resources as pr
      on pr.id = wm.resource_id
    where wm.resource_id is not null
      and pr.id is null
  ) then
    raise exception using
      errcode = '23503',
      message = 'IDENTITY_001D1_ORPHAN_RESOURCE';
  end if;

  if exists (
    select 1
    from public.workshop_members as wm
    join public.planning_resources as pr
      on pr.id = wm.resource_id
    where wm.resource_id is not null
      and wm.workshop_id <> pr.workshop_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'IDENTITY_001D1_CROSS_WORKSHOP_RESOURCE';
  end if;

  if exists (
    select 1
    from public.workshop_members as wm
    where wm.deleted_at is null
      and wm.resource_id is not null
    group by wm.workshop_id, wm.resource_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'IDENTITY_001D1_DUPLICATE_ACTIVE_RESOURCE';
  end if;

  if exists (
    select 1
    from public.workshop_members as wm
    where wm.deleted_at is null
    group by wm.workshop_id
    having count(*) > 0
       and count(*) filter (where wm.role = 'admin_technique') = 0
  ) then
    raise exception using
      errcode = '23514',
      message = 'IDENTITY_001D1_ADMIN_CONTINUITY_BASELINE';
  end if;
end
$identity_001d1$;

-- The helper lives outside exposed application schemas and is not an RPC.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- A non-partial unique parent index is required for the composite FK target.
create unique index if not exists planning_resources_workshop_id_id_uidx
  on public.planning_resources (workshop_id, id);

-- Full child-side index: includes active and historical membership rows.
create index if not exists workshop_members_workshop_id_resource_id_idx
  on public.workshop_members (workshop_id, resource_id);

-- One resource may back only one active membership per workshop. Historical
-- revoked memberships retain resource_id and can coexist outside this predicate.
create unique index if not exists workshop_members_active_workshop_resource_uidx
  on public.workshop_members (workshop_id, resource_id)
  where deleted_at is null
    and resource_id is not null;

-- Supports workshop_members_user_id_fkey cascades and existing user lookups.
create index if not exists workshop_members_user_id_idx
  on public.workshop_members (user_id);

-- PostgreSQL has no ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS. Check the
-- target relation's constraint catalog before installing the same-workshop FK.
do $identity_001d1$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'workshop_members_workshop_resource_fkey'
      and conrelid = 'public.workshop_members'::regclass
  ) then
    alter table public.workshop_members
      add constraint workshop_members_workshop_resource_fkey
      foreign key (workshop_id, resource_id)
      references public.planning_resources (workshop_id, id)
      on update no action
      on delete restrict;
  end if;
end
$identity_001d1$;

-- Restrictive invariant only: prevent removal of the final active technical
-- administrator while its workshop still exists. SECURITY DEFINER is required
-- so trusted server writes and auth.users FK cascades receive the same invariant
-- independent of caller RLS. All relations are schema-qualified and search_path
-- is empty; the function accepts no request-supplied authority and has no SQL RPC
-- management behavior.
create or replace function private.nimr_prevent_last_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $identity_001d1$
declare
  other_active_admin_count bigint;
begin
  if old.deleted_at is not null
     or old.role is distinct from 'admin_technique' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- An UPDATE that leaves the OLD workshop with this same active technical
  -- administrator does not remove continuity and needs no serialization.
  if tg_op = 'UPDATE'
     and new.deleted_at is null
     and new.role = 'admin_technique'
     and new.workshop_id = old.workshop_id then
    return new;
  end if;

  -- Serialize all admin removals for one workshop before counting. Ordinary
  -- membership COUNT checks without this stable parent lock are race-prone.
  perform 1
  from public.workshops as w
  where w.id = old.workshop_id
  for update;

  if not found then
    -- ON DELETE CASCADE from public.workshops reaches the child after the parent
    -- is no longer visible. Permit that lifecycle-owned cascade; a direct child
    -- DELETE while the workshop exists remains protected below.
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select count(*)
    into other_active_admin_count
  from public.workshop_members as wm
  where wm.workshop_id = old.workshop_id
    and wm.user_id <> old.user_id
    and wm.deleted_at is null
    and wm.role = 'admin_technique';

  if other_active_admin_count = 0 then
    raise exception using
      errcode = '23514',
      message = 'NIMR_LAST_ADMIN_FORBIDDEN',
      detail = 'A workshop must retain at least one active admin_technique membership.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$identity_001d1$;

revoke execute on function private.nimr_prevent_last_admin_removal()
  from public, anon, authenticated;

drop trigger if exists nimr_prevent_last_admin_removal
  on public.workshop_members;

create trigger nimr_prevent_last_admin_removal
before update or delete on public.workshop_members
for each row
execute function private.nimr_prevent_last_admin_removal();

comment on function private.nimr_prevent_last_admin_removal() is
  'IDENTITY-001D1 restrictive invariant; permits workshop-owned ON DELETE CASCADE only when the parent row no longer exists.';

-- Browser membership authority becomes read-only. No authenticated mutation
-- policy replaces the three removed policies.
drop policy if exists nimr_workshop_members_insert
  on public.workshop_members;
drop policy if exists nimr_workshop_members_update
  on public.workshop_members;
drop policy if exists nimr_workshop_members_delete
  on public.workshop_members;

-- Preserve the SELECT policy's authorization meaning while placing auth.uid()
-- in an initPlan-compatible scalar subquery.
drop policy if exists nimr_workshop_members_select
  on public.workshop_members;
create policy nimr_workshop_members_select
on public.workshop_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.nimr_is_workshop_member(workshop_id)
);

-- RLS is not the grant layer. authenticated receives exactly table SELECT;
-- anon and service_role privileges are intentionally not changed here.
revoke all privileges
  on table public.workshop_members
  from authenticated;
grant select
  on table public.workshop_members
  to authenticated;

commit;
