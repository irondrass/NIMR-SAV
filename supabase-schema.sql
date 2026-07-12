-- NIMR SAV - Schéma Supabase complet courant
-- A executer dans Supabase > SQL Editor > New query > Run.
-- Cette version garde cloud_backups comme sauvegarde complete et remplit aussi
-- les tables metier visibles dans Table Editor: clients, vehicles, repair_orders, app_settings, etc.

create extension if not exists "pgcrypto";

-- Isolation multi-utilisateurs / multi-ateliers.
-- L'atelier par defaut conserve la compatibilite avec les installations existantes.
create table if not exists public.workshops (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'NIMR SAV',
  created_at timestamptz not null default now()
);

insert into public.workshops (id, name)
values ('00000000-0000-0000-0000-000000000001', 'NIMR SAV')
on conflict (id) do nothing;

create table if not exists public.workshop_members (
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workshop_id, user_id)
);

-- Migration douce : les utilisateurs Supabase deja crees sont rattaches a l'atelier par defaut.
insert into public.workshop_members (workshop_id, user_id, role)
select '00000000-0000-0000-0000-000000000001'::uuid, id, 'admin'
from auth.users
on conflict (workshop_id, user_id) do nothing;

create or replace function public.is_workshop_member(target_workshop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workshop_members wm
    where wm.workshop_id = target_workshop_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function public.storage_object_workshop_id(object_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  first_segment text;
begin
  first_segment := (storage.foldername(object_name))[1];
  if first_segment is null or first_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return first_segment::uuid;
end;
$$;



create table if not exists public.cloud_backups (
  id uuid primary key default gen_random_uuid(),
  backup_key text not null unique,
  app_version text,
  state jsonb not null,
  photos jsonb not null default '[]'::jsonb,
  cases_count integer not null default 0,
  photos_count integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique,
  value jsonb not null default '{}'::jsonb,
  description text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  local_id text,
  full_name text not null,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  local_id text,
  client_id uuid references public.clients(id) on delete set null,
  vin text,
  registration text,
  brand text,
  model text,
  mileage integer,
  color text,
  energy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repair_orders (
  id uuid primary key default gen_random_uuid(),
  local_id text,
  order_number text,
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  status text not null default 'new',
  expert_agreement boolean default false,
  client_agreement boolean default false,
  reception_planned_at timestamptz,
  reception_done_at timestamptz,
  delivery_planned_at timestamptz,
  delivery_done_at timestamptz,
  estimated_amount numeric(12,2),
  customer_balance numeric(12,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Correctif v21.10 : l'ancien script pouvait creer order_number en UNIQUE.
-- En atelier SAV, un ancien import ou une reprise peut contenir un numero OR en double.
-- On garde local_id comme cle de synchronisation et on rend order_number non bloquant.
alter table public.repair_orders drop constraint if exists repair_orders_order_number_key;
drop index if exists public.repair_orders_order_number_key;
create index if not exists repair_orders_order_number_idx on public.repair_orders(order_number);

create table if not exists public.repair_steps (
  id uuid primary key default gen_random_uuid(),
  local_id text,
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  step_key text not null,
  label text not null,
  status text not null default 'todo',
  planned_hours numeric(8,2) default 0,
  actual_hours numeric(8,2) default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.planning_resources (
  id uuid primary key default gen_random_uuid(),
  local_id text,
  name text not null,
  type text not null,
  category text,
  kind text not null default 'internal',
  site text not null default 'internal',
  capacity numeric(8,2) default 1,
  simultaneous_capacity numeric(8,2) default 1,
  daily_capacity_minutes integer,
  calendar jsonb not null default '{}'::jsonb,
  compatible_roles text[] not null default '{}'::text[],
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.planning_slots (
  id uuid primary key default gen_random_uuid(),
  local_id text,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  resource_id uuid references public.planning_resources(id) on delete set null,
  resource_ids uuid[] not null default '{}'::uuid[],
  primary_resource_id uuid references public.planning_resources(id) on delete set null,
  equipment_resource_ids uuid[] not null default '{}'::uuid[],
  task_id text,
  step_key text,
  dependencies text[] not null default '{}'::text[],
  title text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text default 'planned',
  planned_minutes integer not null default 0,
  actual_worked_minutes integer not null default 0,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  vehicle_location text not null default 'internal',
  service_mode text not null default 'internal',
  subcontract_id text,
  temporary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  local_id text,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  step_key text,
  storage_bucket text not null default 'repair-photos',
  storage_path text not null,
  filename text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);



create table if not exists public.repair_claims (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  claim_id uuid references public.repair_claims(id) on delete set null,
  number text,
  title text not null default 'Ordre',
  vehicle_area text,
  type text default 'assurance',
  status text not null default 'draft',
  include_in_planning boolean default true,
  expert_approved boolean default false,
  client_approved boolean default false,
  estimate_number text,
  or_number text,
  amount numeric(12,2),
  source_file jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repair_claim_labor_lines (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  claim_id uuid references public.repair_claims(id) on delete cascade,
  phase text,
  operation text,
  labor_hours numeric(8,2) default 0,
  raw_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repair_supplements (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  claim_id uuid references public.repair_claims(id) on delete set null,
  number text,
  title text not null default 'Réparation complémentaire',
  reason text,
  vehicle_area text,
  status text not null default 'draft',
  expert_approved boolean default false,
  client_approved boolean default false,
  integrated boolean default false,
  integrated_at timestamptz,
  parts jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repair_supplement_lines (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  supplement_id uuid references public.repair_supplements(id) on delete cascade,
  phase text,
  operation text,
  labor_hours numeric(8,2) default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  local_id text,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  action text not null,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

-- Mise a niveau si les tables existaient deja avec un ancien script.
alter table public.clients add column if not exists local_id text;
alter table public.vehicles add column if not exists local_id text;
alter table public.repair_orders add column if not exists local_id text;
alter table public.repair_steps add column if not exists local_id text;
alter table public.planning_resources add column if not exists local_id text;
alter table public.planning_slots add column if not exists local_id text;
alter table public.photos add column if not exists local_id text;
alter table public.repair_claims add column if not exists local_id text;
alter table public.repair_claims add column if not exists include_in_planning boolean default true;
alter table public.repair_claims add column if not exists source_file jsonb;
alter table public.repair_claim_labor_lines add column if not exists local_id text;
alter table public.repair_supplements add column if not exists local_id text;
alter table public.repair_supplements add column if not exists claim_id uuid references public.repair_claims(id) on delete set null;
alter table public.repair_supplement_lines add column if not exists local_id text;
alter table public.audit_logs add column if not exists local_id text;
alter table public.planning_slots add column if not exists updated_at timestamptz not null default now();

alter table public.cloud_backups add column if not exists workshop_id uuid references public.workshops(id);
alter table public.app_settings add column if not exists workshop_id uuid references public.workshops(id);
alter table public.clients add column if not exists workshop_id uuid references public.workshops(id);
alter table public.vehicles add column if not exists workshop_id uuid references public.workshops(id);
alter table public.repair_orders add column if not exists workshop_id uuid references public.workshops(id);
alter table public.repair_steps add column if not exists workshop_id uuid references public.workshops(id);
alter table public.planning_resources add column if not exists workshop_id uuid references public.workshops(id);
alter table public.planning_slots add column if not exists workshop_id uuid references public.workshops(id);
alter table public.photos add column if not exists workshop_id uuid references public.workshops(id);
alter table public.repair_claims add column if not exists workshop_id uuid references public.workshops(id);
alter table public.repair_claim_labor_lines add column if not exists workshop_id uuid references public.workshops(id);
alter table public.repair_supplements add column if not exists workshop_id uuid references public.workshops(id);
alter table public.repair_supplement_lines add column if not exists workshop_id uuid references public.workshops(id);
alter table public.audit_logs add column if not exists workshop_id uuid references public.workshops(id);

alter table public.planning_resources add column if not exists category text;
alter table public.planning_resources add column if not exists kind text not null default 'internal';
alter table public.planning_resources add column if not exists site text not null default 'internal';
alter table public.planning_resources add column if not exists simultaneous_capacity numeric(8,2) default 1;
alter table public.planning_resources add column if not exists daily_capacity_minutes integer;
alter table public.planning_resources add column if not exists calendar jsonb not null default '{}'::jsonb;
alter table public.planning_resources add column if not exists compatible_roles text[] not null default '{}'::text[];

alter table public.planning_slots add column if not exists resource_ids uuid[] not null default '{}'::uuid[];
alter table public.planning_slots add column if not exists primary_resource_id uuid references public.planning_resources(id) on delete set null;
alter table public.planning_slots add column if not exists equipment_resource_ids uuid[] not null default '{}'::uuid[];
alter table public.planning_slots add column if not exists task_id text;
alter table public.planning_slots add column if not exists step_key text;
alter table public.planning_slots add column if not exists dependencies text[] not null default '{}'::text[];
alter table public.planning_slots add column if not exists planned_minutes integer not null default 0;
alter table public.planning_slots add column if not exists actual_worked_minutes integer not null default 0;
alter table public.planning_slots add column if not exists actual_start_at timestamptz;
alter table public.planning_slots add column if not exists actual_end_at timestamptz;
alter table public.planning_slots add column if not exists vehicle_location text not null default 'internal';
alter table public.planning_slots add column if not exists service_mode text not null default 'internal';
alter table public.planning_slots add column if not exists subcontract_id text;
alter table public.planning_slots add column if not exists temporary boolean not null default false;

update public.cloud_backups set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.app_settings set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.clients set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.vehicles set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.repair_orders set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.repair_steps set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.planning_resources set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.planning_slots set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.photos set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.repair_claims set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.repair_claim_labor_lines set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.repair_supplements set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.repair_supplement_lines set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;
update public.audit_logs set workshop_id = '00000000-0000-0000-0000-000000000001' where workshop_id is null;

alter table public.cloud_backups alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.app_settings alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.clients alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.vehicles alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.repair_orders alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.repair_steps alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.planning_resources alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.planning_slots alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.photos alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.repair_claims alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.repair_claim_labor_lines alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.repair_supplements alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.repair_supplement_lines alter column workshop_id set default '00000000-0000-0000-0000-000000000001';
alter table public.audit_logs alter column workshop_id set default '00000000-0000-0000-0000-000000000001';


-- Correctif v21.27 : eviter les doublons crees par les anciennes versions.
-- Le numero OR devient la cle stable de synchronisation quand il existe.
-- Exemple: OR-2026-001 -> case-or:or-2026-001
with ranked_orders as (
  select id,
         row_number() over (
           partition by order_number
           order by updated_at desc nulls last, created_at desc nulls last, id desc
         ) rn
  from public.repair_orders
  where coalesce(trim(order_number), '') <> ''
)
delete from public.repair_orders ro
using ranked_orders r
where ro.id = r.id and r.rn > 1;

update public.repair_orders
set local_id = 'case-or:' || trim(both '-' from lower(regexp_replace(trim(order_number), '[^a-zA-Z0-9]+', '-', 'g')))
where coalesce(trim(order_number), '') <> '';

-- Recalage des clients et vehicules rattaches au dossier conserve.
update public.clients c
set local_id = 'client:' || ro.local_id,
    updated_at = now()
from public.repair_orders ro
where ro.client_id = c.id
  and ro.local_id is not null
  and ro.local_id like 'case-or:%';

update public.vehicles v
set local_id = 'vehicle:' || ro.local_id,
    updated_at = now()
from public.repair_orders ro
where ro.vehicle_id = v.id
  and ro.local_id is not null
  and ro.local_id like 'case-or:%';

-- Nettoyage des clients/vehicules orphelins generes par les essais precedents.
delete from public.clients c
where not exists (select 1 from public.repair_orders ro where ro.client_id = c.id);

delete from public.vehicles v
where not exists (select 1 from public.repair_orders ro where ro.vehicle_id = v.id);

-- Nettoyage et recalage des etapes liees aux dossiers conserves.
with ranked_steps as (
  select id,
         row_number() over (
           partition by repair_order_id, step_key
           order by updated_at desc nulls last, created_at desc nulls last, id desc
         ) rn
  from public.repair_steps
  where repair_order_id is not null and step_key is not null
)
delete from public.repair_steps rs
using ranked_steps r
where rs.id = r.id and r.rn > 1;

update public.repair_steps rs
set local_id = ro.local_id || ':' || rs.step_key,
    updated_at = now()
from public.repair_orders ro
where rs.repair_order_id = ro.id
  and ro.local_id is not null
  and ro.local_id like 'case-or:%';

-- Nettoyage de securite avant creation des index uniques local_id.
-- Si une ancienne sauvegarde a cree des doublons avec le meme local_id, on garde la ligne la plus recente.
with ranked as (select id, row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn from public.clients where local_id is not null) delete from public.clients c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn from public.vehicles where local_id is not null) delete from public.vehicles c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn from public.repair_orders where local_id is not null) delete from public.repair_orders c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn from public.repair_steps where local_id is not null) delete from public.repair_steps c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by created_at desc nulls last, id desc) rn from public.planning_resources where local_id is not null) delete from public.planning_resources c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn from public.planning_slots where local_id is not null) delete from public.planning_slots c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by created_at desc nulls last, id desc) rn from public.photos where local_id is not null) delete from public.photos c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn from public.repair_claims where local_id is not null) delete from public.repair_claims c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn from public.repair_claim_labor_lines where local_id is not null) delete from public.repair_claim_labor_lines c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn from public.repair_supplements where local_id is not null) delete from public.repair_supplements c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn from public.repair_supplement_lines where local_id is not null) delete from public.repair_supplement_lines c using ranked r where c.id=r.id and r.rn>1;
with ranked as (select id, row_number() over (partition by local_id order by created_at desc nulls last, id desc) rn from public.audit_logs where local_id is not null) delete from public.audit_logs c using ranked r where c.id=r.id and r.rn>1;

-- Correctif v21.11: PostgREST/Supabase a besoin d'un index unique NON partiel pour ON CONFLICT(local_id).
-- Les anciens index partiels sont donc supprimes puis recrees en index uniques simples.
drop index if exists public.clients_local_id_uidx;
drop index if exists public.vehicles_local_id_uidx;
drop index if exists public.repair_orders_local_id_uidx;
drop index if exists public.repair_steps_local_id_uidx;
drop index if exists public.planning_resources_local_id_uidx;
drop index if exists public.planning_slots_local_id_uidx;
drop index if exists public.photos_local_id_uidx;
drop index if exists public.audit_logs_local_id_uidx;
drop index if exists public.repair_claims_local_id_uidx;
drop index if exists public.repair_claim_labor_lines_local_id_uidx;
drop index if exists public.repair_supplements_local_id_uidx;
drop index if exists public.repair_supplement_lines_local_id_uidx;

alter table public.cloud_backups drop constraint if exists cloud_backups_backup_key_key;
alter table public.app_settings drop constraint if exists app_settings_setting_key_key;
alter table public.repair_claims drop constraint if exists repair_claims_local_id_key;
alter table public.repair_claim_labor_lines drop constraint if exists repair_claim_labor_lines_local_id_key;
alter table public.repair_supplements drop constraint if exists repair_supplements_local_id_key;
alter table public.repair_supplement_lines drop constraint if exists repair_supplement_lines_local_id_key;

create unique index if not exists cloud_backups_workshop_backup_key_uidx on public.cloud_backups(workshop_id, backup_key);
create unique index if not exists app_settings_workshop_setting_key_uidx on public.app_settings(workshop_id, setting_key);
create unique index if not exists clients_local_id_uidx on public.clients(workshop_id, local_id);
create unique index if not exists vehicles_local_id_uidx on public.vehicles(workshop_id, local_id);
create unique index if not exists repair_orders_local_id_uidx on public.repair_orders(workshop_id, local_id);
create unique index if not exists repair_steps_local_id_uidx on public.repair_steps(workshop_id, local_id);
create unique index if not exists planning_resources_local_id_uidx on public.planning_resources(workshop_id, local_id);
create unique index if not exists planning_slots_local_id_uidx on public.planning_slots(workshop_id, local_id);
create unique index if not exists photos_local_id_uidx on public.photos(workshop_id, local_id);
create unique index if not exists repair_claims_local_id_uidx on public.repair_claims(workshop_id, local_id);
create unique index if not exists repair_claim_labor_lines_local_id_uidx on public.repair_claim_labor_lines(workshop_id, local_id);
create unique index if not exists repair_supplements_local_id_uidx on public.repair_supplements(workshop_id, local_id);
create unique index if not exists repair_supplement_lines_local_id_uidx on public.repair_supplement_lines(workshop_id, local_id);
create unique index if not exists audit_logs_local_id_uidx on public.audit_logs(workshop_id, local_id);

alter table public.workshops enable row level security;
alter table public.workshop_members enable row level security;
alter table public.cloud_backups enable row level security;
alter table public.app_settings enable row level security;
alter table public.clients enable row level security;
alter table public.vehicles enable row level security;
alter table public.repair_orders enable row level security;
alter table public.repair_steps enable row level security;
alter table public.planning_resources enable row level security;
alter table public.planning_slots enable row level security;
alter table public.photos enable row level security;
alter table public.repair_claims enable row level security;
alter table public.repair_claim_labor_lines enable row level security;
alter table public.repair_supplements enable row level security;
alter table public.repair_supplement_lines enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "workshops select member" on public.workshops;
drop policy if exists "workshop_members select own" on public.workshop_members;
drop policy if exists "workshop_members manage admin" on public.workshop_members;

create policy "workshops select member"
on public.workshops for select to authenticated
using (public.is_workshop_member(id));

create policy "workshop_members select own"
on public.workshop_members for select to authenticated
using (user_id = auth.uid() or public.is_workshop_member(workshop_id));

do $$
declare
  t text;
  p text;
begin
  foreach t in array array['cloud_backups','app_settings','clients','vehicles','repair_orders','repair_steps','planning_resources','planning_slots','photos','repair_claims','repair_claim_labor_lines','repair_supplements','repair_supplement_lines']
  loop
    execute format('drop policy if exists %I on public.%I', t || ' select authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || ' insert authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || ' update authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || ' delete authenticated', t);

    p := t || ' select authenticated';
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workshop_member(workshop_id))', p, t);

    p := t || ' insert authenticated';
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_workshop_member(workshop_id))', p, t);

    p := t || ' update authenticated';
    execute format('create policy %I on public.%I for update to authenticated using (public.is_workshop_member(workshop_id)) with check (public.is_workshop_member(workshop_id))', p, t);

    p := t || ' delete authenticated';
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_workshop_member(workshop_id))', p, t);
  end loop;
end $$;

-- audit_logs reste strictement append-only : lecture et insertion uniquement.
drop policy if exists "audit_logs select authenticated" on public.audit_logs;
drop policy if exists "audit_logs insert authenticated" on public.audit_logs;
drop policy if exists "audit_logs update authenticated" on public.audit_logs;
drop policy if exists "audit_logs delete authenticated" on public.audit_logs;

create policy "audit_logs select authenticated"
on public.audit_logs for select to authenticated
using (public.is_workshop_member(workshop_id));

create policy "audit_logs insert authenticated"
on public.audit_logs for insert to authenticated
with check (public.is_workshop_member(workshop_id));

revoke all privileges on table public.audit_logs from authenticated;
revoke all privileges on table public.audit_logs from anon;
grant select, insert on table public.audit_logs to authenticated;

-- Bucket photos: a creer aussi dans Storage si besoin.
-- Securite v23.1.5: les objets doivent etre stockes sous
-- <workshop_id>/<case_id>/<photo_id-or-file>. Aucun acces global authenticated.
insert into storage.buckets (id, name, public)
values ('repair-photos', 'repair-photos', false)
on conflict (id) do nothing;

drop policy if exists "repair photos read authenticated" on storage.objects;
drop policy if exists "repair photos insert authenticated" on storage.objects;
drop policy if exists "repair photos update authenticated" on storage.objects;
drop policy if exists "repair photos delete authenticated" on storage.objects;
drop policy if exists "repair photos select workshop member" on storage.objects;
drop policy if exists "repair photos insert workshop member" on storage.objects;
drop policy if exists "repair photos update workshop member" on storage.objects;
drop policy if exists "repair photos delete workshop member" on storage.objects;

create policy "repair photos select workshop member"
on storage.objects for select to authenticated
using (
  bucket_id = 'repair-photos'
  and public.is_workshop_member(public.storage_object_workshop_id(name))
);

create policy "repair photos insert workshop member"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'repair-photos'
  and public.is_workshop_member(public.storage_object_workshop_id(name))
);

create policy "repair photos update workshop member"
on storage.objects for update to authenticated
using (
  bucket_id = 'repair-photos'
  and public.is_workshop_member(public.storage_object_workshop_id(name))
)
with check (
  bucket_id = 'repair-photos'
  and public.is_workshop_member(public.storage_object_workshop_id(name))
);

create policy "repair photos delete workshop member"
on storage.objects for delete to authenticated
using (
  bucket_id = 'repair-photos'
  and public.is_workshop_member(public.storage_object_workshop_id(name))
);

-- Force PostgREST/Supabase API schema cache refresh after new tables.
alter table public.cloud_backups replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table public.cloud_backups;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end $$;

NOTIFY pgrst, 'reload schema';
