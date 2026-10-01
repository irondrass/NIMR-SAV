-- KHA-76 P1A — agency-scope identity foundation.
-- Additive only: no agent account activation, no existing claim assignment, no PROD cutover.
-- agent_agence remains OUTSIDE workshop_members to avoid broad legacy workshop RLS exposure.

alter table public.repair_claims
  add column if not exists agency_id text;

do $nimr$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.repair_claims'::regclass
      and conname = 'repair_claims_agency_id_format_check'
  ) then
    alter table public.repair_claims
      add constraint repair_claims_agency_id_format_check
      check (
        agency_id is null
        or (
          pg_catalog.length(pg_catalog.btrim(agency_id)) between 1 and 128
          and agency_id = pg_catalog.btrim(agency_id)
        )
      ) not valid;
  end if;
end
$nimr$;

do $nimr$
begin
  if not exists (
    select 1 from public.repair_claims
    where agency_id is not null
      and (
        pg_catalog.length(pg_catalog.btrim(agency_id)) not between 1 and 128
        or agency_id is distinct from pg_catalog.btrim(agency_id)
      )
  ) then
    alter table public.repair_claims
      validate constraint repair_claims_agency_id_format_check;
  end if;
end
$nimr$;

create index if not exists repair_claims_workshop_agency_active_idx
  on public.repair_claims (workshop_id, agency_id)
  where agency_id is not null
    and deleted_at is null
    and type = 'garantie';

create table if not exists public.warranty_agency_members (
  workshop_id uuid not null,
  agency_id text not null,
  user_id uuid not null,
  capability text not null default 'agent_agence',
  active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  version bigint not null default 1,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  sync_source text not null default 'warranty_network',
  primary key (workshop_id, agency_id, user_id),
  constraint warranty_agency_members_workshop_id_fkey
    foreign key (workshop_id) references public.workshops(id) on delete cascade,
  constraint warranty_agency_members_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint warranty_agency_members_capability_check
    check (capability = 'agent_agence'),
  constraint warranty_agency_members_agency_id_format_check
    check (
      pg_catalog.length(pg_catalog.btrim(agency_id)) between 1 and 128
      and agency_id = pg_catalog.btrim(agency_id)
    )
);

create index if not exists warranty_agency_members_user_active_idx
  on public.warranty_agency_members (user_id, workshop_id, agency_id)
  where active = true and deleted_at is null;

create index if not exists warranty_agency_members_workshop_agency_active_idx
  on public.warranty_agency_members (workshop_id, agency_id, user_id)
  where active = true and deleted_at is null;

alter table public.warranty_agency_members enable row level security;

create or replace function nimr_internal.nimr_is_warranty_agency_member(
  target_workshop_id uuid,
  target_agency_id text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, nimr_internal
as $nimr$
  select
    (select auth.uid()) is not null
    and target_workshop_id is not null
    and nullif(pg_catalog.btrim(target_agency_id), '') is not null
    and exists (
      select 1
      from public.warranty_agency_members wam
      where wam.workshop_id = target_workshop_id
        and wam.agency_id = pg_catalog.btrim(target_agency_id)
        and wam.user_id = (select auth.uid())
        and wam.capability = 'agent_agence'
        and wam.active = true
        and wam.deleted_at is null
    )
$nimr$;

revoke all on function nimr_internal.nimr_is_warranty_agency_member(uuid, text)
  from public, anon, authenticated;
grant execute on function nimr_internal.nimr_is_warranty_agency_member(uuid, text)
  to authenticated;

drop policy if exists warranty_agency_members_self_select
  on public.warranty_agency_members;
create policy warranty_agency_members_self_select
  on public.warranty_agency_members
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and active = true
    and deleted_at is null
  );

drop policy if exists warranty_agency_members_internal_select
  on public.warranty_agency_members;
create policy warranty_agency_members_internal_select
  on public.warranty_agency_members
  for select
  to authenticated
  using (
    nimr_internal.nimr_has_workshop_role(
      workshop_id,
      array['admin_technique','directeur','responsable_garantie_support']
    )
  );

revoke all privileges on table public.warranty_agency_members
  from public, anon, authenticated;
grant select on table public.warranty_agency_members
  to authenticated;

drop policy if exists warranty_agency_repair_claims_select
  on public.repair_claims;
create policy warranty_agency_repair_claims_select
  on public.repair_claims
  for select
  to authenticated
  using (
    type = 'garantie'
    and agency_id is not null
    and nimr_internal.nimr_is_warranty_agency_member(workshop_id, agency_id)
  );

-- P0c.3 authority boundary intentionally remains unchanged:
-- authenticated keeps SELECT on repair_claims but no direct INSERT/UPDATE/DELETE.
