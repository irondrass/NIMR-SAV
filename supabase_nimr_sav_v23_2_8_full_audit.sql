-- NIMR SAV v23.2.8-full-audit
-- Migration Supabase autonome, idempotente et non destructive.
--
-- Principes :
--   * aucune suppression de ligne métier ;
--   * version optimiste et horodatage serveur sur chaque table synchronisée ;
--   * isolation stricte par workshop_id et rôle canonique ;
--   * idempotence durable des opérations ;
--   * réservation planning atomique par RPC, avec verrou transactionnel et
--     contrainte d'exclusion pour les ressources exclusives ;
--   * publication Realtime limitée aux tables contenant workshop_id. Le client
--     doit en plus utiliser le filtre workshop_id=eq.<uuid> sur chaque écoute.
--
-- Avant production : exporter la base, exécuter d'abord sur un projet de test,
-- puis contrôler les diagnostics et les policies. Cette migration s'arrête au
-- lieu de supprimer des doublons si un index unique composite ne peut pas être
-- construit.

begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 1. Socle atelier et tables métier (création douce si le schéma est absent)
-- ---------------------------------------------------------------------------

create table if not exists public.workshops (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'NIMR SAV',
  schema_version text not null default '23.2.8-full-audit',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.workshops add column if not exists schema_version text not null default '23.2.8-full-audit';
alter table public.workshops add column if not exists updated_at timestamptz not null default clock_timestamp();

insert into public.workshops (id, name, schema_version)
values ('00000000-0000-0000-0000-000000000001', 'NIMR SAV', '23.2.8-full-audit')
on conflict (id) do update
set schema_version = excluded.schema_version,
    updated_at = clock_timestamp();

create table if not exists public.workshop_members (
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'lecture_seule',
  resource_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (workshop_id, user_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  full_name text not null,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  client_id uuid references public.clients(id) on delete set null,
  vin text,
  registration text,
  brand text,
  model text,
  mileage integer,
  color text,
  energy text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.repair_orders (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  order_number text,
  estimate_number text,
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  status text not null default 'chief_validation_pending',
  repair_planned_start_at timestamptz,
  repair_actual_start_at timestamptz,
  initial_estimated_delivery_at timestamptz,
  revised_estimated_delivery_at timestamptz,
  planned_duration_minutes integer not null default 0,
  actual_duration_minutes integer not null default 0,
  planning_version bigint not null default 0,
  next_action text,
  closed_at timestamptz,
  archived_at timestamptz,
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.planning_resources (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  name text not null,
  type text not null default 'resource',
  category text,
  kind text not null default 'internal',
  site text not null default 'internal',
  capacity numeric(10,2) not null default 1,
  simultaneous_capacity numeric(10,2) not null default 1,
  daily_capacity_minutes integer,
  calendar jsonb not null default '{}'::jsonb,
  compatible_roles text[] not null default '{}'::text[],
  transfer_out_minutes integer not null default 0,
  transfer_return_minutes integer not null default 0,
  standard_lead_time_minutes integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.repair_steps (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  repair_order_id uuid not null references public.repair_orders(id) on delete cascade,
  step_key text not null,
  label text not null,
  trade text,
  status text not null default 'todo',
  planned_hours numeric(10,2) not null default 0,
  actual_hours numeric(10,2) not null default 0,
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  technician_resource_id uuid references public.planning_resources(id) on delete set null,
  resource_ids uuid[] not null default '{}'::uuid[],
  zone_resource_id uuid references public.planning_resources(id) on delete set null,
  subcontractor_resource_id uuid references public.planning_resources(id) on delete set null,
  source_labor_line_ids text[] not null default '{}'::text[],
  blocked_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.planning_slots (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
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
  status text not null default 'planned',
  planned_minutes integer not null default 0,
  actual_worked_minutes integer not null default 0,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  vehicle_location text not null default 'internal',
  vehicle_exclusive boolean not null default false,
  service_mode text not null default 'internal',
  subcontract_id text,
  capacity_units numeric(10,2) not null default 1,
  resource_units jsonb not null default '{}'::jsonb,
  operation_id uuid,
  idempotency_key text,
  temporary boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.repair_claims (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  number text,
  title text not null default 'Ordre',
  status text not null default 'draft',
  include_in_planning boolean not null default true,
  estimate_number text,
  or_number text,
  source_file jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.repair_claim_labor_lines (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  claim_id uuid references public.repair_claims(id) on delete cascade,
  source_line_id text,
  source_line_index integer,
  source_reference text,
  phase text,
  operation text,
  labor_hours numeric(10,2) not null default 0,
  raw_text text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.repair_supplements (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  claim_id uuid references public.repair_claims(id) on delete set null,
  number text,
  title text not null default 'Réparation complémentaire',
  reason text,
  status text not null default 'draft',
  integrated boolean not null default false,
  integrated_at timestamptz,
  parts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.repair_supplement_lines (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  supplement_id uuid references public.repair_supplements(id) on delete cascade,
  phase text,
  operation text,
  labor_hours numeric(10,2) not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  step_key text,
  storage_bucket text not null default 'repair-photos',
  storage_path text not null,
  filename text,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  setting_key text not null,
  value jsonb not null default '{}'::jsonb,
  description text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.cloud_backups (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  backup_key text not null,
  app_version text,
  state jsonb not null default '{}'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  cases_count integer not null default 0,
  photos_count integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id),
  local_id text,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  action text not null,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

-- Journal serveur des clés rejouables. Il complète l'outbox IndexedDB : une
-- même idempotency_key ne peut être appliquée qu'une fois par atelier.
create table if not exists public.sync_operations (
  operation_id uuid primary key,
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  idempotency_key text not null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  expected_version bigint,
  user_id uuid,
  status text not null default 'processing',
  retry_count integer not null default 0,
  last_error text,
  result jsonb,
  acknowledged_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint sync_operations_status_check
    check (status in ('processing', 'applied', 'conflict', 'failed')),
  constraint sync_operations_workshop_idempotency_key_key
    unique (workshop_id, idempotency_key)
);

create table if not exists public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  operation_id uuid,
  entity_type text not null,
  entity_id uuid,
  conflict_code text not null,
  expected_version bigint,
  actual_version bigint,
  local_payload jsonb,
  server_payload jsonb,
  status text not null default 'open',
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint sync_conflicts_status_check
    check (status in ('open', 'resolved', 'ignored')),
  constraint sync_conflicts_workshop_operation_key
    unique (workshop_id, operation_id)
);

-- Une ligne par sujet réellement occupé par un créneau. Les ressources de
-- capacité 1 et les véhicules exclusifs sont aussi protégés par EXCLUDE ; les
-- capacités > 1 sont contrôlées dans le RPC sous verrou transactionnel.
create table if not exists public.planning_slot_allocations (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  slot_id uuid not null references public.planning_slots(id) on delete cascade,
  subject_type text not null,
  subject_id text not null,
  slot_range tstzrange not null,
  capacity_units numeric(10,2) not null default 1,
  exclusive boolean not null default true,
  location text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  constraint planning_slot_allocations_subject_check
    check (subject_type in ('resource', 'vehicle')),
  constraint planning_slot_allocations_capacity_check
    check (capacity_units > 0),
  constraint planning_slot_allocations_range_check
    check (not isempty(slot_range))
);

create table if not exists public.nimr_schema_migrations (
  version text primary key,
  description text not null,
  applied_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- 2. Mise à niveau idempotente des installations existantes
-- ---------------------------------------------------------------------------

alter table public.workshops add column if not exists version bigint not null default 1;
alter table public.workshops add column if not exists created_by uuid;
alter table public.workshops add column if not exists updated_by uuid;
alter table public.workshops add column if not exists deleted_at timestamptz;
alter table public.workshops add column if not exists sync_source text not null default 'legacy';
alter table public.workshop_members add column if not exists resource_id uuid;

alter table public.repair_orders add column if not exists estimate_number text;
alter table public.repair_orders add column if not exists expert_agreement boolean not null default false;
alter table public.repair_orders add column if not exists client_agreement boolean not null default false;
alter table public.repair_orders add column if not exists reception_planned_at timestamptz;
alter table public.repair_orders add column if not exists reception_done_at timestamptz;
alter table public.repair_orders add column if not exists delivery_planned_at timestamptz;
alter table public.repair_orders add column if not exists delivery_done_at timestamptz;
alter table public.repair_orders add column if not exists estimated_amount numeric(12,2);
alter table public.repair_orders add column if not exists customer_balance numeric(12,2);
alter table public.repair_orders add column if not exists repair_planned_start_at timestamptz;
alter table public.repair_orders add column if not exists repair_actual_start_at timestamptz;
alter table public.repair_orders add column if not exists initial_estimated_delivery_at timestamptz;
alter table public.repair_orders add column if not exists revised_estimated_delivery_at timestamptz;
alter table public.repair_orders add column if not exists planned_duration_minutes integer not null default 0;
alter table public.repair_orders add column if not exists actual_duration_minutes integer not null default 0;
alter table public.repair_orders add column if not exists planning_version bigint not null default 0;
alter table public.repair_orders add column if not exists next_action text;
alter table public.repair_orders add column if not exists closed_at timestamptz;
alter table public.repair_orders add column if not exists archived_at timestamptz;

alter table public.repair_steps add column if not exists trade text;
alter table public.repair_steps add column if not exists planned_start_at timestamptz;
alter table public.repair_steps add column if not exists planned_end_at timestamptz;
alter table public.repair_steps add column if not exists started_at timestamptz;
alter table public.repair_steps add column if not exists completed_at timestamptz;
alter table public.repair_steps add column if not exists actual_start_at timestamptz;
alter table public.repair_steps add column if not exists actual_end_at timestamptz;
alter table public.repair_steps add column if not exists technician_resource_id uuid references public.planning_resources(id) on delete set null;
alter table public.repair_steps add column if not exists resource_ids uuid[] not null default '{}'::uuid[];
alter table public.repair_steps add column if not exists zone_resource_id uuid references public.planning_resources(id) on delete set null;
alter table public.repair_steps add column if not exists subcontractor_resource_id uuid references public.planning_resources(id) on delete set null;
alter table public.repair_steps add column if not exists source_labor_line_ids text[] not null default '{}'::text[];
alter table public.repair_steps add column if not exists blocked_reason text;

alter table public.planning_resources add column if not exists category text;
alter table public.planning_resources add column if not exists kind text not null default 'internal';
alter table public.planning_resources add column if not exists site text not null default 'internal';
alter table public.planning_resources add column if not exists capacity numeric(10,2) not null default 1;
alter table public.planning_resources add column if not exists simultaneous_capacity numeric(10,2) not null default 1;
alter table public.planning_resources add column if not exists daily_capacity_minutes integer;
alter table public.planning_resources add column if not exists calendar jsonb not null default '{}'::jsonb;
alter table public.planning_resources add column if not exists compatible_roles text[] not null default '{}'::text[];
alter table public.planning_resources add column if not exists transfer_out_minutes integer not null default 0;
alter table public.planning_resources add column if not exists transfer_return_minutes integer not null default 0;
alter table public.planning_resources add column if not exists standard_lead_time_minutes integer not null default 0;

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
alter table public.planning_slots add column if not exists vehicle_exclusive boolean not null default false;
alter table public.planning_slots add column if not exists service_mode text not null default 'internal';
alter table public.planning_slots add column if not exists subcontract_id text;
alter table public.planning_slots add column if not exists capacity_units numeric(10,2) not null default 1;
alter table public.planning_slots add column if not exists resource_units jsonb not null default '{}'::jsonb;
alter table public.planning_slots add column if not exists operation_id uuid;
alter table public.planning_slots add column if not exists idempotency_key text;
alter table public.planning_slots add column if not exists temporary boolean not null default false;

alter table public.repair_claim_labor_lines add column if not exists source_line_id text;
alter table public.repair_claim_labor_lines add column if not exists source_line_index integer;
alter table public.repair_claim_labor_lines add column if not exists source_reference text;

alter table public.repair_claims add column if not exists vehicle_area text;
alter table public.repair_claims add column if not exists type text not null default 'assurance';
alter table public.repair_claims add column if not exists expert_approved boolean not null default false;
alter table public.repair_claims add column if not exists client_approved boolean not null default false;
alter table public.repair_claims add column if not exists amount numeric(12,2);

alter table public.repair_supplements add column if not exists vehicle_area text;
alter table public.repair_supplements add column if not exists expert_approved boolean not null default false;
alter table public.repair_supplements add column if not exists client_approved boolean not null default false;

-- Toutes les tables exposées reçoivent la même métadonnée de concurrence.
do $nimr$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workshop_members', 'clients', 'vehicles', 'repair_orders', 'repair_steps',
    'planning_resources', 'planning_slots', 'repair_claims',
    'repair_claim_labor_lines', 'repair_supplements',
    'repair_supplement_lines', 'photos', 'app_settings', 'cloud_backups',
    'audit_logs', 'sync_operations', 'sync_conflicts',
    'planning_slot_allocations'
  ]
  loop
    execute format('alter table public.%I add column if not exists version bigint not null default 1', table_name);
    execute format('alter table public.%I add column if not exists created_at timestamptz not null default clock_timestamp()', table_name);
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default clock_timestamp()', table_name);
    execute format('alter table public.%I add column if not exists created_by uuid', table_name);
    execute format('alter table public.%I add column if not exists updated_by uuid', table_name);
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', table_name);
    execute format('alter table public.%I add column if not exists sync_source text not null default ''legacy''', table_name);
  end loop;
end
$nimr$;

-- Les anciennes tables pouvaient ne pas avoir workshop_id. Aucune ligne n'est
-- supprimée : les lignes historiques non rattachées vont dans l'atelier legacy.
do $nimr$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients', 'vehicles', 'repair_orders', 'repair_steps', 'planning_resources',
    'planning_slots', 'repair_claims', 'repair_claim_labor_lines',
    'repair_supplements', 'repair_supplement_lines', 'photos', 'app_settings',
    'cloud_backups', 'audit_logs'
  ]
  loop
    execute format('alter table public.%I add column if not exists workshop_id uuid', table_name);
    execute format(
      'update public.%I set workshop_id = %L::uuid where workshop_id is null',
      table_name,
      '00000000-0000-0000-0000-000000000001'
    );
    execute format(
      'alter table public.%I alter column workshop_id set default %L::uuid',
      table_name,
      '00000000-0000-0000-0000-000000000001'
    );
    execute format('alter table public.%I alter column workshop_id set not null', table_name);
  end loop;
end
$nimr$;

-- Les anciennes contraintes globales empêchaient la réutilisation d'un local_id
-- dans deux ateliers. Elles sont remplacées par des index composites, sans
-- toucher aux lignes.
alter table public.cloud_backups drop constraint if exists cloud_backups_backup_key_key;
alter table public.app_settings drop constraint if exists app_settings_setting_key_key;
alter table public.repair_claims drop constraint if exists repair_claims_local_id_key;
alter table public.repair_claim_labor_lines drop constraint if exists repair_claim_labor_lines_local_id_key;
alter table public.repair_supplements drop constraint if exists repair_supplements_local_id_key;
alter table public.repair_supplement_lines drop constraint if exists repair_supplement_lines_local_id_key;

drop index if exists public.cloud_backups_workshop_backup_key_uidx;
drop index if exists public.app_settings_workshop_setting_key_uidx;
drop index if exists public.clients_local_id_uidx;
drop index if exists public.vehicles_local_id_uidx;
drop index if exists public.repair_orders_local_id_uidx;
drop index if exists public.repair_steps_local_id_uidx;
drop index if exists public.planning_resources_local_id_uidx;
drop index if exists public.planning_slots_local_id_uidx;
drop index if exists public.repair_claims_local_id_uidx;
drop index if exists public.repair_claim_labor_lines_local_id_uidx;
drop index if exists public.repair_supplements_local_id_uidx;
drop index if exists public.repair_supplement_lines_local_id_uidx;
drop index if exists public.photos_local_id_uidx;
drop index if exists public.audit_logs_local_id_uidx;

-- CREATE UNIQUE INDEX échoue de manière sûre si des doublons composites sont
-- présents. Aucun DELETE automatique n'est volontairement effectué ici.
create unique index cloud_backups_workshop_backup_key_uidx
  on public.cloud_backups(workshop_id, backup_key);
create unique index app_settings_workshop_setting_key_uidx
  on public.app_settings(workshop_id, setting_key);
create unique index clients_local_id_uidx
  on public.clients(workshop_id, local_id);
create unique index vehicles_local_id_uidx
  on public.vehicles(workshop_id, local_id);
create unique index repair_orders_local_id_uidx
  on public.repair_orders(workshop_id, local_id);
create unique index repair_steps_local_id_uidx
  on public.repair_steps(workshop_id, local_id);
create unique index planning_resources_local_id_uidx
  on public.planning_resources(workshop_id, local_id);
create unique index planning_slots_local_id_uidx
  on public.planning_slots(workshop_id, local_id);
create unique index repair_claims_local_id_uidx
  on public.repair_claims(workshop_id, local_id);
create unique index repair_claim_labor_lines_local_id_uidx
  on public.repair_claim_labor_lines(workshop_id, local_id);
create unique index repair_supplements_local_id_uidx
  on public.repair_supplements(workshop_id, local_id);
create unique index repair_supplement_lines_local_id_uidx
  on public.repair_supplement_lines(workshop_id, local_id);
create unique index photos_local_id_uidx
  on public.photos(workshop_id, local_id);
create unique index audit_logs_local_id_uidx
  on public.audit_logs(workshop_id, local_id);

create index if not exists repair_orders_workshop_updated_idx
  on public.repair_orders(workshop_id, updated_at, id);
create index if not exists repair_steps_workshop_updated_idx
  on public.repair_steps(workshop_id, updated_at, id);
create index if not exists planning_resources_workshop_updated_idx
  on public.planning_resources(workshop_id, updated_at, id);
create index if not exists planning_slots_workshop_time_idx
  on public.planning_slots(workshop_id, start_at, end_at)
  where deleted_at is null;
create index if not exists planning_slots_repair_order_idx
  on public.planning_slots(workshop_id, repair_order_id)
  where deleted_at is null;
create index if not exists planning_slot_allocations_subject_idx
  on public.planning_slot_allocations(workshop_id, subject_type, subject_id)
  where deleted_at is null;
create index if not exists sync_operations_workshop_status_idx
  on public.sync_operations(workshop_id, status, created_at);
create index if not exists sync_conflicts_workshop_status_idx
  on public.sync_conflicts(workshop_id, status, created_at);

do $nimr$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'planning_slots_valid_range_check'
      and conrelid = 'public.planning_slots'::regclass
  ) then
    alter table public.planning_slots
      add constraint planning_slots_valid_range_check
      check (end_at > start_at) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'planning_allocations_no_exclusive_overlap'
      and conrelid = 'public.planning_slot_allocations'::regclass
  ) then
    alter table public.planning_slot_allocations
      add constraint planning_allocations_no_exclusive_overlap
      exclude using gist (
        workshop_id with =,
        subject_type with =,
        subject_id with =,
        slot_range with &&
      )
      where (deleted_at is null and exclusive);
  end if;
end
$nimr$;

-- ---------------------------------------------------------------------------
-- 3. Version, auteur et date serveur
-- ---------------------------------------------------------------------------

create or replace function public.nimr_set_versioned_metadata()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $nimr$
begin
  if tg_op = 'INSERT' then
    new.version := greatest(coalesce(new.version, 1), 1);
    new.created_at := coalesce(new.created_at, clock_timestamp());
    new.updated_at := clock_timestamp();
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.updated_by := coalesce(auth.uid(), new.updated_by, new.created_by);
  else
    new.version := coalesce(old.version, 0) + 1;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := clock_timestamp();
    new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
  end if;

  if auth.uid() is not null then
    new.sync_source := 'browser';
  else
    new.sync_source := coalesce(nullif(new.sync_source, ''), 'server');
  end if;
  return new;
end
$nimr$;

create or replace function public.nimr_keep_workshop_scope()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $nimr$
begin
  if new.workshop_id is distinct from old.workshop_id then
    raise exception 'workshop_id is immutable'
      using errcode = '42501';
  end if;
  return new;
end
$nimr$;

drop trigger if exists nimr_20_versioned_metadata on public.workshops;
create trigger nimr_20_versioned_metadata
before insert or update on public.workshops
for each row execute function public.nimr_set_versioned_metadata();

do $nimr$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workshop_members', 'clients', 'vehicles', 'repair_orders', 'repair_steps',
    'planning_resources', 'planning_slots', 'repair_claims',
    'repair_claim_labor_lines', 'repair_supplements',
    'repair_supplement_lines', 'photos', 'app_settings', 'cloud_backups',
    'audit_logs', 'sync_operations', 'sync_conflicts',
    'planning_slot_allocations'
  ]
  loop
    execute format('drop trigger if exists nimr_10_workshop_scope on public.%I', table_name);
    execute format(
      'create trigger nimr_10_workshop_scope before update on public.%I '
      'for each row execute function public.nimr_keep_workshop_scope()',
      table_name
    );
    execute format('drop trigger if exists nimr_20_versioned_metadata on public.%I', table_name);
    execute format(
      'create trigger nimr_20_versioned_metadata before insert or update on public.%I '
      'for each row execute function public.nimr_set_versioned_metadata()',
      table_name
    );
  end loop;
end
$nimr$;

-- ---------------------------------------------------------------------------
-- 4. Rôles canoniques et RLS par atelier
-- ---------------------------------------------------------------------------

create or replace function public.nimr_canonical_role(input_role text)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $nimr$
  select case regexp_replace(lower(trim(coalesce(input_role, ''))), '[^a-z0-9]+', '_', 'g')
    when 'admin' then 'admin_technique'
    when 'admin_technique' then 'admin_technique'
    when 'directeur' then 'directeur'
    when 'directeur_sav' then 'directeur'
    when 'chef_atelier' then 'chef_atelier'
    when 'reception' then 'reception'
    when 'receptionnaire' then 'reception'
    when 'technicien' then 'technicien'
    when 'technician' then 'technicien'
    when 'lecture_seule' then 'lecture_seule'
    when 'readonly' then 'lecture_seule'
    when 'member' then 'lecture_seule'
    when 'qualite' then 'lecture_seule'
    else null
  end
$nimr$;

-- Normalisation non destructive des seuls alias connus.
update public.workshop_members
set role = public.nimr_canonical_role(role),
    updated_at = clock_timestamp()
where public.nimr_canonical_role(role) is not null
  and role is distinct from public.nimr_canonical_role(role);

alter table public.workshop_members
  drop constraint if exists workshop_members_role_canonical_check;
alter table public.workshop_members
  add constraint workshop_members_role_canonical_check
  check (role in (
    'admin_technique', 'directeur', 'chef_atelier',
    'reception', 'technicien', 'lecture_seule'
  )) not valid;

do $nimr$
begin
  if not exists (
    select 1 from public.workshop_members
    where role not in (
      'admin_technique', 'directeur', 'chef_atelier',
      'reception', 'technicien', 'lecture_seule'
    )
  ) then
    alter table public.workshop_members
      validate constraint workshop_members_role_canonical_check;
  end if;
end
$nimr$;

create or replace function public.nimr_current_workshop_role(target_workshop_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $nimr$
  select public.nimr_canonical_role(wm.role)
  from public.workshop_members wm
  where wm.workshop_id = target_workshop_id
    and wm.user_id = auth.uid()
    and wm.deleted_at is null
  limit 1
$nimr$;

create or replace function public.nimr_is_workshop_member(target_workshop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $nimr$
  select public.nimr_current_workshop_role(target_workshop_id) is not null
$nimr$;

create or replace function public.nimr_has_workshop_role(
  target_workshop_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $nimr$
  select public.nimr_current_workshop_role(target_workshop_id) = any(allowed_roles)
$nimr$;

create or replace function public.nimr_current_resource_id(target_workshop_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $nimr$
  select wm.resource_id
  from public.workshop_members wm
  where wm.workshop_id = target_workshop_id
    and wm.user_id = auth.uid()
    and wm.deleted_at is null
  limit 1
$nimr$;

revoke all on function public.nimr_current_workshop_role(uuid) from public;
revoke all on function public.nimr_is_workshop_member(uuid) from public;
revoke all on function public.nimr_has_workshop_role(uuid, text[]) from public;
revoke all on function public.nimr_current_resource_id(uuid) from public;
grant execute on function public.nimr_current_workshop_role(uuid) to authenticated;
grant execute on function public.nimr_is_workshop_member(uuid) to authenticated;
grant execute on function public.nimr_has_workshop_role(uuid, text[]) to authenticated;
grant execute on function public.nimr_current_resource_id(uuid) to authenticated;

alter table public.workshops enable row level security;
alter table public.workshop_members enable row level security;
alter table public.clients enable row level security;
alter table public.vehicles enable row level security;
alter table public.repair_orders enable row level security;
alter table public.repair_steps enable row level security;
alter table public.planning_resources enable row level security;
alter table public.planning_slots enable row level security;
alter table public.repair_claims enable row level security;
alter table public.repair_claim_labor_lines enable row level security;
alter table public.repair_supplements enable row level security;
alter table public.repair_supplement_lines enable row level security;
alter table public.photos enable row level security;
alter table public.app_settings enable row level security;
alter table public.cloud_backups enable row level security;
alter table public.audit_logs enable row level security;
alter table public.sync_operations enable row level security;
alter table public.sync_conflicts enable row level security;
alter table public.planning_slot_allocations enable row level security;
alter table public.nimr_schema_migrations enable row level security;

-- Supprime toutes les anciennes policies publiques sur ces tables afin qu'une
-- policy historique "tout membre = CRUD" ne survive pas à la migration.
do $nimr$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'workshops', 'workshop_members', 'clients', 'vehicles', 'repair_orders',
        'repair_steps', 'planning_resources', 'planning_slots', 'repair_claims',
        'repair_claim_labor_lines', 'repair_supplements',
        'repair_supplement_lines', 'photos', 'app_settings', 'cloud_backups',
        'audit_logs', 'sync_operations', 'sync_conflicts',
        'planning_slot_allocations', 'nimr_schema_migrations'
      ])
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$nimr$;

create policy nimr_workshops_select
on public.workshops for select to authenticated
using (public.nimr_is_workshop_member(id));

create policy nimr_workshops_update
on public.workshops for update to authenticated
using (public.nimr_has_workshop_role(id, array['admin_technique', 'directeur']))
with check (public.nimr_has_workshop_role(id, array['admin_technique', 'directeur']));

create policy nimr_workshop_members_select
on public.workshop_members for select to authenticated
using (user_id = auth.uid() or public.nimr_is_workshop_member(workshop_id));

create policy nimr_workshop_members_insert
on public.workshop_members for insert to authenticated
with check (public.nimr_has_workshop_role(workshop_id, array['admin_technique', 'directeur']));

create policy nimr_workshop_members_update
on public.workshop_members for update to authenticated
using (public.nimr_has_workshop_role(workshop_id, array['admin_technique', 'directeur']))
with check (public.nimr_has_workshop_role(workshop_id, array['admin_technique', 'directeur']));

create policy nimr_workshop_members_delete
on public.workshop_members for delete to authenticated
using (public.nimr_has_workshop_role(workshop_id, array['admin_technique', 'directeur']));

-- Lecture : tout membre autorisé voit les données de son atelier.
do $nimr$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients', 'vehicles', 'repair_orders', 'repair_steps', 'planning_resources',
    'planning_slots', 'repair_claims', 'repair_claim_labor_lines',
    'repair_supplements', 'repair_supplement_lines', 'photos', 'app_settings',
    'cloud_backups', 'audit_logs', 'sync_operations', 'sync_conflicts',
    'planning_slot_allocations'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (public.nimr_is_workshop_member(workshop_id))',
      'nimr_' || table_name || '_select',
      table_name
    );
  end loop;
end
$nimr$;

-- Réception et encadrement : dossiers, clients, véhicules et lignes MO.
do $nimr$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients', 'vehicles', 'repair_orders', 'repair_claims',
    'repair_claim_labor_lines', 'repair_supplements',
    'repair_supplement_lines'
  ]
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated '
      'with check (public.nimr_has_workshop_role(workshop_id, '
      'array[''admin_technique'', ''directeur'', ''chef_atelier'', ''reception'']))',
      'nimr_' || table_name || '_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using (public.nimr_has_workshop_role(workshop_id, '
      'array[''admin_technique'', ''directeur'', ''chef_atelier'', ''reception''])) '
      'with check (public.nimr_has_workshop_role(workshop_id, '
      'array[''admin_technique'', ''directeur'', ''chef_atelier'', ''reception'']))',
      'nimr_' || table_name || '_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated '
      'using (public.nimr_has_workshop_role(workshop_id, '
      'array[''admin_technique'', ''directeur'', ''chef_atelier'']))',
      'nimr_' || table_name || '_delete', table_name
    );
  end loop;
end
$nimr$;

-- Chef Atelier : étapes et ressources. Le technicien ne peut mettre à jour que
-- l'étape affectée à sa ressource Supabase.
create policy nimr_repair_steps_insert
on public.repair_steps for insert to authenticated
with check (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier']
));

create policy nimr_repair_steps_update
on public.repair_steps for update to authenticated
using (
  public.nimr_has_workshop_role(
    workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier']
  )
  or (
    public.nimr_current_workshop_role(workshop_id) = 'technicien'
    and public.nimr_current_resource_id(workshop_id) is not null
    and (
      technician_resource_id = public.nimr_current_resource_id(workshop_id)
      or public.nimr_current_resource_id(workshop_id) = any(resource_ids)
    )
  )
)
with check (
  public.nimr_has_workshop_role(
    workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier']
  )
  or (
    public.nimr_current_workshop_role(workshop_id) = 'technicien'
    and public.nimr_current_resource_id(workshop_id) is not null
    and (
      technician_resource_id = public.nimr_current_resource_id(workshop_id)
      or public.nimr_current_resource_id(workshop_id) = any(resource_ids)
    )
  )
);

create policy nimr_repair_steps_delete
on public.repair_steps for delete to authenticated
using (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier']
));

create policy nimr_planning_resources_insert
on public.planning_resources for insert to authenticated
with check (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier']
));
create policy nimr_planning_resources_update
on public.planning_resources for update to authenticated
using (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier']
))
with check (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier']
));
create policy nimr_planning_resources_delete
on public.planning_resources for delete to authenticated
using (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier']
));

-- planning_slots et planning_slot_allocations n'ont volontairement aucune
-- policy INSERT/UPDATE/DELETE : toute réservation passe par le RPC atomique.

create policy nimr_photos_insert
on public.photos for insert to authenticated
with check (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier', 'reception', 'technicien']
));
create policy nimr_photos_update
on public.photos for update to authenticated
using (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier', 'reception']
))
with check (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier', 'reception']
));
create policy nimr_photos_delete
on public.photos for delete to authenticated
using (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier']
));

do $nimr$
declare
  table_name text;
begin
  foreach table_name in array array['app_settings', 'cloud_backups']
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated '
      'with check (public.nimr_has_workshop_role(workshop_id, '
      'array[''admin_technique'', ''directeur'']))',
      'nimr_' || table_name || '_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using (public.nimr_has_workshop_role(workshop_id, '
      'array[''admin_technique'', ''directeur''])) '
      'with check (public.nimr_has_workshop_role(workshop_id, '
      'array[''admin_technique'', ''directeur'']))',
      'nimr_' || table_name || '_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated '
      'using (public.nimr_has_workshop_role(workshop_id, '
      'array[''admin_technique'', ''directeur'']))',
      'nimr_' || table_name || '_delete', table_name
    );
  end loop;
end
$nimr$;

-- Le journal d'audit est append-only pour les utilisateurs authentifiés.
create policy nimr_audit_logs_insert
on public.audit_logs for insert to authenticated
with check (public.nimr_is_workshop_member(workshop_id));

-- L'outbox serveur accepte les opérations des rôles métier, mais seul le RPC
-- possède le droit de les acquitter/modifier.
create policy nimr_sync_operations_insert
on public.sync_operations for insert to authenticated
with check (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier', 'reception', 'technicien']
));

create policy nimr_sync_conflicts_update
on public.sync_conflicts for update to authenticated
using (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier']
))
with check (public.nimr_has_workshop_role(
  workshop_id,
  array['admin_technique', 'directeur', 'chef_atelier']
));

create policy nimr_schema_migrations_select
on public.nimr_schema_migrations for select to authenticated
using (true);

-- Privilèges explicites : anon ne reçoit aucun accès aux tables métier.
do $nimr$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workshops', 'workshop_members', 'clients', 'vehicles', 'repair_orders',
    'repair_steps', 'planning_resources', 'planning_slots', 'repair_claims',
    'repair_claim_labor_lines', 'repair_supplements',
    'repair_supplement_lines', 'photos', 'app_settings', 'cloud_backups',
    'audit_logs', 'sync_operations', 'sync_conflicts',
    'planning_slot_allocations', 'nimr_schema_migrations'
  ]
  loop
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;

  foreach table_name in array array[
    'workshops', 'workshop_members', 'clients', 'vehicles', 'repair_orders',
    'repair_steps', 'planning_resources', 'repair_claims',
    'repair_claim_labor_lines', 'repair_supplements',
    'repair_supplement_lines', 'photos', 'app_settings', 'cloud_backups',
    'audit_logs', 'sync_operations', 'sync_conflicts'
  ]
  loop
    execute format('grant insert, update, delete on table public.%I to authenticated', table_name);
  end loop;
end
$nimr$;

-- ---------------------------------------------------------------------------
-- 5. RPC de réservation atomique
-- ---------------------------------------------------------------------------

create or replace function public.nimr_try_uuid(input_value text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public
as $nimr$
begin
  return nullif(trim(input_value), '')::uuid;
exception when invalid_text_representation then
  return null;
end
$nimr$;

create or replace function public.nimr_try_bigint(input_value text)
returns bigint
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public
as $nimr$
begin
  return nullif(trim(input_value), '')::bigint;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end
$nimr$;

create or replace function public.nimr_try_numeric(input_value text)
returns numeric
language plpgsql
immutable
security invoker
set search_path = pg_catalog, public
as $nimr$
begin
  return nullif(trim(input_value), '')::numeric;
exception when invalid_text_representation or numeric_value_out_of_range then
  return null;
end
$nimr$;

create or replace function public.nimr_try_timestamptz(input_value text)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $nimr$
begin
  return nullif(trim(input_value), '')::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then
  return null;
end
$nimr$;

create or replace function public.nimr_reserve_planning_slots(
  p_workshop_id uuid,
  p_operation_id uuid,
  p_idempotency_key text,
  p_slots jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $nimr$
declare
  operation_row public.sync_operations%rowtype;
  existing_operation public.sync_operations%rowtype;
  slot_payload jsonb;
  lock_row record;
  resource_id_value uuid;
  resource_ids_value uuid[];
  equipment_ids_value uuid[];
  slot_id_value uuid;
  repair_order_id_value uuid;
  vehicle_id_value uuid;
  primary_resource_id_value uuid;
  start_value timestamptz;
  end_value timestamptz;
  expected_version_value bigint;
  current_version_value bigint;
  new_version_value bigint;
  local_id_value text;
  location_value text;
  service_mode_value text;
  status_value text;
  resource_capacity numeric;
  resource_units_value numeric;
  used_capacity numeric;
  is_vehicle_exclusive boolean;
  conflict_result jsonb;
  final_result jsonb;
  reserved_slots jsonb := '[]'::jsonb;
  payload_hash_value text;
  error_message text;
begin
  if auth.uid() is null then
    raise exception 'Authentification Supabase requise.' using errcode = '42501';
  end if;
  if not public.nimr_has_workshop_role(
    p_workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier']
  ) then
    raise exception 'Rôle non autorisé à réserver le planning de cet atelier.'
      using errcode = '42501';
  end if;
  if p_operation_id is null or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'operationId et idempotencyKey sont obligatoires.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    raise exception 'La réservation doit contenir au moins un créneau.'
      using errcode = '22023';
  end if;

  -- pg_catalog.md5 est disponible quel que soit le schéma choisi par Supabase
  -- pour l'extension pgcrypto ; ce hash sert uniquement à détecter un rejeu
  -- avec un payload différent, pas à authentifier des données.
  payload_hash_value := pg_catalog.md5(p_slots::text);

  insert into public.sync_operations (
    operation_id, workshop_id, idempotency_key, entity_type, entity_id,
    action, payload, payload_hash, expected_version, user_id, status
  ) values (
    p_operation_id, p_workshop_id, trim(p_idempotency_key), 'planning_slots', null,
    'reserve', p_slots, payload_hash_value, null, auth.uid(), 'processing'
  )
  on conflict (workshop_id, idempotency_key) do nothing
  returning * into operation_row;

  if not found then
    select * into existing_operation
    from public.sync_operations
    where workshop_id = p_workshop_id
      and idempotency_key = trim(p_idempotency_key);

    if existing_operation.payload_hash is distinct from payload_hash_value then
      return jsonb_build_object(
        'ok', false,
        'status', 'conflict',
        'code', 'idempotency_payload_mismatch',
        'operationId', existing_operation.operation_id,
        'message', 'Cette idempotencyKey existe déjà avec un contenu différent.'
      );
    end if;
    return coalesce(
      existing_operation.result,
      jsonb_build_object(
        'ok', existing_operation.status = 'applied',
        'status', existing_operation.status,
        'operationId', existing_operation.operation_id,
        'idempotentReplay', true
      )
    ) || jsonb_build_object('idempotentReplay', true);
  end if;

  -- Ordre stable des verrous pour éviter les interblocages entre deux postes.
  for lock_row in
    select distinct lock_key
    from (
      select 'resource:' || resource_token.value as lock_key
      from jsonb_array_elements(p_slots) as slot_item(value)
      cross join lateral jsonb_array_elements_text(
        case
          when jsonb_typeof(slot_item.value -> 'resourceIds') = 'array'
            then slot_item.value -> 'resourceIds'
          else '[]'::jsonb
        end
      ) as resource_token(value)
      where public.nimr_try_uuid(resource_token.value) is not null

      union all

      select 'vehicle:' || repair_order.vehicle_id::text as lock_key
      from jsonb_array_elements(p_slots) as slot_item(value)
      join public.repair_orders repair_order
        on repair_order.id = public.nimr_try_uuid(
          coalesce(slot_item.value ->> 'repairOrderId', slot_item.value ->> 'repair_order_id')
        )
       and repair_order.workshop_id = p_workshop_id
       and repair_order.deleted_at is null
      where repair_order.vehicle_id is not null
    ) lock_candidates
    order by lock_key
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(p_workshop_id::text || ':' || lock_row.lock_key, 0)
    );
  end loop;

  begin
    for slot_payload in select value from jsonb_array_elements(p_slots)
    loop
      start_value := public.nimr_try_timestamptz(
        coalesce(slot_payload ->> 'startAt', slot_payload ->> 'start_at', slot_payload ->> 'start')
      );
      end_value := public.nimr_try_timestamptz(
        coalesce(slot_payload ->> 'endAt', slot_payload ->> 'end_at', slot_payload ->> 'end')
      );
      repair_order_id_value := public.nimr_try_uuid(
        coalesce(slot_payload ->> 'repairOrderId', slot_payload ->> 'repair_order_id')
      );
      slot_id_value := coalesce(
        public.nimr_try_uuid(coalesce(slot_payload ->> 'id', slot_payload ->> 'slotId')),
        gen_random_uuid()
      );
      expected_version_value := public.nimr_try_bigint(
        coalesce(slot_payload ->> 'expectedVersion', slot_payload ->> 'expected_version')
      );
      local_id_value := coalesce(
        nullif(slot_payload ->> 'localId', ''),
        nullif(slot_payload ->> 'local_id', ''),
        slot_id_value::text
      );
      location_value := lower(coalesce(nullif(slot_payload ->> 'vehicleLocation', ''), 'internal'));
      service_mode_value := lower(coalesce(nullif(slot_payload ->> 'serviceMode', ''), 'internal'));
      status_value := coalesce(nullif(slot_payload ->> 'status', ''), 'planned');
      is_vehicle_exclusive := lower(coalesce(slot_payload ->> 'vehicleExclusive', 'false')) = 'true'
        or location_value in ('external', 'transport');

      if start_value is null or end_value is null or end_value <= start_value then
        conflict_result := jsonb_build_object(
          'ok', false, 'status', 'conflict', 'code', 'invalid_slot',
          'slotId', slot_id_value,
          'message', 'Le créneau doit avoir un début et une fin valides.'
        );
        raise exception 'NIMR_RESERVATION_CONFLICT:%', conflict_result::text
          using errcode = 'P0001';
      end if;

      select repair_order.vehicle_id into vehicle_id_value
      from public.repair_orders repair_order
      where repair_order.id = repair_order_id_value
        and repair_order.workshop_id = p_workshop_id
        and repair_order.deleted_at is null
      for share;
      if not found then
        conflict_result := jsonb_build_object(
          'ok', false, 'status', 'conflict', 'code', 'repair_order_not_found',
          'slotId', slot_id_value,
          'message', 'Le dossier à réserver est introuvable dans cet atelier.'
        );
        raise exception 'NIMR_RESERVATION_CONFLICT:%', conflict_result::text
          using errcode = 'P0001';
      end if;

      select coalesce(array_agg(distinct parsed_id order by parsed_id), '{}'::uuid[])
      into resource_ids_value
      from (
        select public.nimr_try_uuid(resource_token.value) as parsed_id
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(slot_payload -> 'resourceIds') = 'array'
              then slot_payload -> 'resourceIds'
            else '[]'::jsonb
          end
        ) as resource_token(value)
      ) parsed_resources
      where parsed_id is not null;

      if cardinality(resource_ids_value) = 0 then
        conflict_result := jsonb_build_object(
          'ok', false, 'status', 'conflict', 'code', 'missing_resource',
          'slotId', slot_id_value,
          'message', 'Au moins une ressource est obligatoire.'
        );
        raise exception 'NIMR_RESERVATION_CONFLICT:%', conflict_result::text
          using errcode = 'P0001';
      end if;

      select coalesce(array_agg(distinct parsed_id order by parsed_id), '{}'::uuid[])
      into equipment_ids_value
      from (
        select public.nimr_try_uuid(resource_token.value) as parsed_id
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(slot_payload -> 'equipmentResourceIds') = 'array'
              then slot_payload -> 'equipmentResourceIds'
            else '[]'::jsonb
          end
        ) as resource_token(value)
      ) parsed_equipment
      where parsed_id is not null;

      primary_resource_id_value := coalesce(
        public.nimr_try_uuid(slot_payload ->> 'primaryResourceId'),
        resource_ids_value[1]
      );

      select planning_slot.version into current_version_value
      from public.planning_slots planning_slot
      where planning_slot.id = slot_id_value
        and planning_slot.workshop_id = p_workshop_id
      for update;

      if found then
        if expected_version_value is null or current_version_value <> expected_version_value then
          conflict_result := jsonb_build_object(
            'ok', false, 'status', 'conflict', 'code', 'optimistic_version_conflict',
            'slotId', slot_id_value,
            'expectedVersion', expected_version_value,
            'actualVersion', current_version_value,
            'message', 'Le planning a été modifié sur un autre poste.'
          );
          raise exception 'NIMR_RESERVATION_CONFLICT:%', conflict_result::text
            using errcode = 'P0001';
        end if;

        update public.planning_slot_allocations
        set deleted_at = clock_timestamp(),
            updated_by = auth.uid()
        where workshop_id = p_workshop_id
          and slot_id = slot_id_value
          and deleted_at is null;

        update public.planning_slots
        set local_id = local_id_value,
            repair_order_id = repair_order_id_value,
            resource_id = resource_ids_value[1],
            resource_ids = resource_ids_value,
            primary_resource_id = primary_resource_id_value,
            equipment_resource_ids = equipment_ids_value,
            task_id = coalesce(slot_payload ->> 'taskId', slot_payload ->> 'task_id'),
            step_key = coalesce(slot_payload ->> 'stepKey', slot_payload ->> 'step_key'),
            title = slot_payload ->> 'title',
            start_at = start_value,
            end_at = end_value,
            status = status_value,
            planned_minutes = greatest(0, coalesce(public.nimr_try_bigint(slot_payload ->> 'plannedMinutes'), 0))::integer,
            vehicle_location = location_value,
            vehicle_exclusive = is_vehicle_exclusive,
            service_mode = service_mode_value,
            subcontract_id = coalesce(slot_payload ->> 'subcontractId', slot_payload ->> 'subcontract_id'),
            capacity_units = greatest(1, coalesce(public.nimr_try_numeric(slot_payload ->> 'capacityUnits'), 1)),
            resource_units = coalesce(slot_payload -> 'resourceUnits', '{}'::jsonb),
            operation_id = p_operation_id,
            idempotency_key = trim(p_idempotency_key),
            temporary = false,
            deleted_at = null
        where id = slot_id_value
          and workshop_id = p_workshop_id
          and version = expected_version_value
        returning version into new_version_value;
      else
        if expected_version_value is not null and expected_version_value <> 0 then
          conflict_result := jsonb_build_object(
            'ok', false, 'status', 'conflict', 'code', 'slot_not_found',
            'slotId', slot_id_value,
            'expectedVersion', expected_version_value,
            'message', 'Le créneau attendu n’existe plus sur le serveur.'
          );
          raise exception 'NIMR_RESERVATION_CONFLICT:%', conflict_result::text
            using errcode = 'P0001';
        end if;

        insert into public.planning_slots (
          id, workshop_id, local_id, repair_order_id, resource_id, resource_ids,
          primary_resource_id, equipment_resource_ids, task_id, step_key, title,
          start_at, end_at, status, planned_minutes, vehicle_location,
          vehicle_exclusive, service_mode, subcontract_id, capacity_units,
          resource_units, operation_id, idempotency_key, temporary, sync_source
        ) values (
          slot_id_value, p_workshop_id, local_id_value, repair_order_id_value,
          resource_ids_value[1], resource_ids_value, primary_resource_id_value,
          equipment_ids_value,
          coalesce(slot_payload ->> 'taskId', slot_payload ->> 'task_id'),
          coalesce(slot_payload ->> 'stepKey', slot_payload ->> 'step_key'),
          slot_payload ->> 'title', start_value, end_value, status_value,
          greatest(0, coalesce(public.nimr_try_bigint(slot_payload ->> 'plannedMinutes'), 0))::integer,
          location_value, is_vehicle_exclusive, service_mode_value,
          coalesce(slot_payload ->> 'subcontractId', slot_payload ->> 'subcontract_id'),
          greatest(1, coalesce(public.nimr_try_numeric(slot_payload ->> 'capacityUnits'), 1)),
          coalesce(slot_payload -> 'resourceUnits', '{}'::jsonb),
          p_operation_id, trim(p_idempotency_key), false, 'rpc_reservation'
        )
        returning version into new_version_value;
      end if;

      foreach resource_id_value in array resource_ids_value
      loop
        select greatest(
          1,
          coalesce(resource.simultaneous_capacity, resource.capacity, 1)
        )
        into resource_capacity
        from public.planning_resources resource
        where resource.id = resource_id_value
          and resource.workshop_id = p_workshop_id
          and resource.active
          and resource.deleted_at is null
        for share;

        if not found then
          conflict_result := jsonb_build_object(
            'ok', false, 'status', 'conflict', 'code', 'resource_unavailable',
            'slotId', slot_id_value,
            'resourceId', resource_id_value,
            'message', 'La ressource est absente ou inactive.'
          );
          raise exception 'NIMR_RESERVATION_CONFLICT:%', conflict_result::text
            using errcode = 'P0001';
        end if;

        resource_units_value := greatest(
          1,
          coalesce(
            public.nimr_try_numeric((slot_payload -> 'resourceUnits') ->> resource_id_value::text),
            public.nimr_try_numeric(slot_payload ->> 'capacityUnits'),
            1
          )
        );

        select coalesce(sum(allocation.capacity_units), 0)
        into used_capacity
        from public.planning_slot_allocations allocation
        where allocation.workshop_id = p_workshop_id
          and allocation.subject_type = 'resource'
          and allocation.subject_id = resource_id_value::text
          and allocation.deleted_at is null
          and allocation.slot_range && tstzrange(start_value, end_value, '[)');

        if used_capacity + resource_units_value > resource_capacity then
          conflict_result := jsonb_build_object(
            'ok', false, 'status', 'conflict', 'code', 'resource_capacity_conflict',
            'slotId', slot_id_value,
            'resourceId', resource_id_value,
            'capacity', resource_capacity,
            'alreadyReserved', used_capacity,
            'requested', resource_units_value,
            'message', 'La capacité de la ressource est déjà occupée sur ce créneau.'
          );
          raise exception 'NIMR_RESERVATION_CONFLICT:%', conflict_result::text
            using errcode = 'P0001';
        end if;

        insert into public.planning_slot_allocations (
          workshop_id, slot_id, subject_type, subject_id, slot_range,
          capacity_units, exclusive, location, sync_source
        ) values (
          p_workshop_id, slot_id_value, 'resource', resource_id_value::text,
          tstzrange(start_value, end_value, '[)'), resource_units_value,
          resource_capacity <= 1, null, 'rpc_reservation'
        );
      end loop;

      if vehicle_id_value is not null then
        if exists (
          select 1
          from public.planning_slot_allocations allocation
          where allocation.workshop_id = p_workshop_id
            and allocation.subject_type = 'vehicle'
            and allocation.subject_id = vehicle_id_value::text
            and allocation.deleted_at is null
            and allocation.slot_range && tstzrange(start_value, end_value, '[)')
            and (
              is_vehicle_exclusive
              or allocation.exclusive
              or coalesce(allocation.location, 'internal') <> location_value
            )
        ) then
          conflict_result := jsonb_build_object(
            'ok', false, 'status', 'conflict', 'code', 'vehicle_double_booking',
            'slotId', slot_id_value,
            'vehicleId', vehicle_id_value,
            'message', 'Le véhicule est déjà réservé dans un emplacement incompatible.'
          );
          raise exception 'NIMR_RESERVATION_CONFLICT:%', conflict_result::text
            using errcode = 'P0001';
        end if;

        insert into public.planning_slot_allocations (
          workshop_id, slot_id, subject_type, subject_id, slot_range,
          capacity_units, exclusive, location, sync_source
        ) values (
          p_workshop_id, slot_id_value, 'vehicle', vehicle_id_value::text,
          tstzrange(start_value, end_value, '[)'), 1,
          is_vehicle_exclusive, location_value, 'rpc_reservation'
        );
      end if;

      reserved_slots := reserved_slots || jsonb_build_array(jsonb_build_object(
        'id', slot_id_value,
        'localId', local_id_value,
        'version', new_version_value,
        'startAt', start_value,
        'endAt', end_value,
        'resourceIds', to_jsonb(resource_ids_value)
      ));
    end loop;
  exception
    when exclusion_violation or unique_violation then
      conflict_result := jsonb_build_object(
        'ok', false,
        'status', 'conflict',
        'code', 'atomic_overlap_conflict',
        'message', 'Un autre poste a réservé ce créneau simultanément.'
      );
    when raise_exception then
      error_message := sqlerrm;
      if position('NIMR_RESERVATION_CONFLICT:' in error_message) = 1 then
        conflict_result := substring(
          error_message from length('NIMR_RESERVATION_CONFLICT:') + 1
        )::jsonb;
      else
        raise;
      end if;
  end;

  if conflict_result is not null then
    final_result := conflict_result || jsonb_build_object(
      'operationId', p_operation_id,
      'idempotencyKey', trim(p_idempotency_key)
    );

    update public.sync_operations
    set status = 'conflict',
        result = final_result,
        last_error = coalesce(conflict_result ->> 'message', conflict_result ->> 'code'),
        acknowledged_at = clock_timestamp()
    where operation_id = p_operation_id
      and workshop_id = p_workshop_id;

    insert into public.sync_conflicts (
      workshop_id, operation_id, entity_type, entity_id, conflict_code,
      expected_version, actual_version, local_payload, server_payload,
      status, sync_source
    ) values (
      p_workshop_id, p_operation_id, 'planning_slots',
      public.nimr_try_uuid(conflict_result ->> 'slotId'),
      coalesce(conflict_result ->> 'code', 'planning_conflict'),
      public.nimr_try_bigint(conflict_result ->> 'expectedVersion'),
      public.nimr_try_bigint(conflict_result ->> 'actualVersion'),
      p_slots, conflict_result, 'open', 'rpc_reservation'
    )
    on conflict (workshop_id, operation_id) do update
    set conflict_code = excluded.conflict_code,
        expected_version = excluded.expected_version,
        actual_version = excluded.actual_version,
        local_payload = excluded.local_payload,
        server_payload = excluded.server_payload,
        status = 'open',
        resolution = null,
        resolved_at = null,
        resolved_by = null;

    return final_result;
  end if;

  final_result := jsonb_build_object(
    'ok', true,
    'status', 'applied',
    'operationId', p_operation_id,
    'idempotencyKey', trim(p_idempotency_key),
    'slots', reserved_slots,
    'serverAcknowledgedAt', clock_timestamp()
  );

  update public.sync_operations
  set status = 'applied',
      result = final_result,
      last_error = null,
      acknowledged_at = clock_timestamp()
  where operation_id = p_operation_id
    and workshop_id = p_workshop_id;

  return final_result;
end
$nimr$;

revoke all on function public.nimr_reserve_planning_slots(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.nimr_reserve_planning_slots(uuid, uuid, text, jsonb)
  to authenticated;

comment on function public.nimr_reserve_planning_slots(uuid, uuid, text, jsonb) is
  'Réserve atomiquement un lot de créneaux NIMR SAV. Rejeu idempotent, version optimiste, verrouillage par ressource/véhicule et conflit explicite.';

-- UUID stable dérivé de la clé d'idempotence. Le même retry conserve ainsi le
-- même operationId même si le navigateur n'envoie que l'idempotencyKey.
create or replace function public.nimr_idempotency_operation_id(
  p_workshop_id uuid,
  p_idempotency_key text
)
returns uuid
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $nimr$
  select (
    substr(md5(p_workshop_id::text || ':' || coalesce(p_idempotency_key, '')), 1, 8)
    || '-' || substr(md5(p_workshop_id::text || ':' || coalesce(p_idempotency_key, '')), 9, 4)
    || '-' || substr(md5(p_workshop_id::text || ':' || coalesce(p_idempotency_key, '')), 13, 4)
    || '-' || substr(md5(p_workshop_id::text || ':' || coalesce(p_idempotency_key, '')), 17, 4)
    || '-' || substr(md5(p_workshop_id::text || ':' || coalesce(p_idempotency_key, '')), 21, 12)
  )::uuid
$nimr$;

-- Contrat utilisé par le frontend v23.2.8. p_case_id accepte l'UUID serveur,
-- local_id ou order_number. p_bookings accepte directement un tableau, ou un
-- objet { bookings: [...] }. Chaque resourceIds doit contenir les UUID Supabase
-- de planning_resources. Le planningVersion retourné devient l'expectedVersion
-- du prochain changement de planning de ce dossier.
create or replace function public.nimr_reserve_planning_atomic(
  p_workshop_id uuid,
  p_case_id text,
  p_expected_version bigint,
  p_idempotency_key text,
  p_bookings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $nimr$
declare
  repair_order_row public.repair_orders%rowtype;
  existing_operation public.sync_operations%rowtype;
  booking_payload jsonb;
  booking_array jsonb;
  enriched_bookings jsonb := '[]'::jsonb;
  operation_id_value uuid;
  payload_hash_value text;
  current_planning_version bigint;
  next_planning_version bigint;
  rpc_result jsonb;
  conflict_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentification Supabase requise.' using errcode = '42501';
  end if;
  if not public.nimr_has_workshop_role(
    p_workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier']
  ) then
    raise exception 'Rôle non autorisé à réserver le planning de cet atelier.'
      using errcode = '42501';
  end if;
  if nullif(trim(p_case_id), '') is null
    or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'caseId et idempotencyKey sont obligatoires.'
      using errcode = '22023';
  end if;

  booking_array := case
    when jsonb_typeof(p_bookings) = 'array' then p_bookings
    when jsonb_typeof(p_bookings -> 'bookings') = 'array' then p_bookings -> 'bookings'
    else '[]'::jsonb
  end;
  if jsonb_array_length(booking_array) = 0 then
    raise exception 'p_bookings doit contenir au moins une réservation.'
      using errcode = '22023';
  end if;

  select candidate.* into repair_order_row
  from public.repair_orders candidate
  where candidate.workshop_id = p_workshop_id
    and candidate.deleted_at is null
    and (
      candidate.id = public.nimr_try_uuid(p_case_id)
      or candidate.local_id = p_case_id
      or candidate.order_number = p_case_id
    )
  order by case
    when candidate.id = public.nimr_try_uuid(p_case_id) then 0
    when candidate.local_id = p_case_id then 1
    else 2
  end,
  candidate.updated_at desc,
  candidate.id
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'acknowledged', false,
      'status', 'conflict',
      'code', 'repair_order_not_found',
      'caseId', p_case_id,
      'message', 'Le dossier est introuvable dans cet atelier.'
    );
  end if;

  for booking_payload in select value from jsonb_array_elements(booking_array)
  loop
    enriched_bookings := enriched_bookings || jsonb_build_array(
      booking_payload || jsonb_build_object('repairOrderId', repair_order_row.id)
    );
  end loop;

  operation_id_value := public.nimr_idempotency_operation_id(
    p_workshop_id,
    trim(p_idempotency_key)
  );
  payload_hash_value := pg_catalog.md5(enriched_bookings::text);

  -- Le retry d'une opération déjà acquittée précède le contrôle de version :
  -- il doit retourner le même ACK même si planning_version a déjà avancé.
  select * into existing_operation
  from public.sync_operations
  where workshop_id = p_workshop_id
    and idempotency_key = trim(p_idempotency_key);

  if found then
    if existing_operation.payload_hash is distinct from payload_hash_value then
      return jsonb_build_object(
        'ok', false,
        'acknowledged', true,
        'status', 'conflict',
        'code', 'idempotency_payload_mismatch',
        'operationId', existing_operation.operation_id,
        'message', 'Cette idempotencyKey existe déjà avec un contenu différent.'
      );
    end if;
    return coalesce(
      existing_operation.result,
      jsonb_build_object(
        'ok', existing_operation.status = 'applied',
        'acknowledged', existing_operation.status in ('applied', 'conflict'),
        'status', existing_operation.status,
        'operationId', existing_operation.operation_id
      )
    ) || jsonb_build_object('idempotentReplay', true);
  end if;

  -- Verrou dossier : deux modifications du même planning ne peuvent pas valider
  -- simultanément la même planning_version.
  select planning_version into current_planning_version
  from public.repair_orders
  where id = repair_order_row.id
    and workshop_id = p_workshop_id
    and deleted_at is null
  for update;

  if current_planning_version is distinct from coalesce(p_expected_version, 0) then
    conflict_result := jsonb_build_object(
      'ok', false,
      'acknowledged', true,
      'status', 'conflict',
      'code', 'optimistic_version_conflict',
      'operationId', operation_id_value,
      'caseId', p_case_id,
      'expectedVersion', p_expected_version,
      'actualVersion', current_planning_version,
      'planningVersion', current_planning_version,
      'message', 'Le planning du dossier a été modifié sur un autre poste.'
    );

    insert into public.sync_operations (
      operation_id, workshop_id, idempotency_key, entity_type, entity_id,
      action, payload, payload_hash, expected_version, user_id, status,
      last_error, result, acknowledged_at
    ) values (
      operation_id_value, p_workshop_id, trim(p_idempotency_key),
      'repair_order_planning', repair_order_row.id, 'reserve',
      enriched_bookings, payload_hash_value, p_expected_version, auth.uid(),
      'conflict', conflict_result ->> 'message', conflict_result,
      clock_timestamp()
    )
    on conflict (workshop_id, idempotency_key) do nothing;

    insert into public.sync_conflicts (
      workshop_id, operation_id, entity_type, entity_id, conflict_code,
      expected_version, actual_version, local_payload, server_payload,
      status, sync_source
    ) values (
      p_workshop_id, operation_id_value, 'repair_order_planning',
      repair_order_row.id, 'optimistic_version_conflict', p_expected_version,
      current_planning_version, enriched_bookings,
      jsonb_build_object('planningVersion', current_planning_version),
      'open', 'rpc_reservation'
    )
    on conflict (workshop_id, operation_id) do update
    set expected_version = excluded.expected_version,
        actual_version = excluded.actual_version,
        local_payload = excluded.local_payload,
        server_payload = excluded.server_payload,
        status = 'open';

    return conflict_result;
  end if;

  rpc_result := public.nimr_reserve_planning_slots(
    p_workshop_id,
    operation_id_value,
    trim(p_idempotency_key),
    enriched_bookings
  );

  if coalesce((rpc_result ->> 'ok')::boolean, false) is not true then
    return rpc_result || jsonb_build_object(
      'acknowledged', true,
      'planningVersion', current_planning_version,
      'caseId', p_case_id
    );
  end if;

  update public.repair_orders
  set planning_version = planning_version + 1
  where id = repair_order_row.id
    and workshop_id = p_workshop_id
    and planning_version = current_planning_version
  returning planning_version into next_planning_version;

  if not found then
    -- Le verrou FOR UPDATE rend ce cas exceptionnel ; lever une erreur annule
    -- aussi toutes les réservations réalisées dans la transaction courante.
    raise exception 'La version planning a changé pendant la réservation.'
      using errcode = '40001';
  end if;

  rpc_result := rpc_result || jsonb_build_object(
    'acknowledged', true,
    'caseId', p_case_id,
    'repairOrderId', repair_order_row.id,
    'planningVersion', next_planning_version
  );

  update public.sync_operations
  set entity_type = 'repair_order_planning',
      entity_id = repair_order_row.id,
      expected_version = p_expected_version,
      result = rpc_result,
      acknowledged_at = clock_timestamp()
  where workshop_id = p_workshop_id
    and idempotency_key = trim(p_idempotency_key);

  return rpc_result;
end
$nimr$;

revoke all on function public.nimr_reserve_planning_atomic(uuid, text, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.nimr_reserve_planning_atomic(uuid, text, bigint, text, jsonb)
  to authenticated;

comment on function public.nimr_reserve_planning_atomic(uuid, text, bigint, text, jsonb) is
  'Contrat frontend v23.2.8 : réserve un lot par caseId et planningVersion, retourne un ACK JSON idempotent.';

-- ---------------------------------------------------------------------------
-- 6. Realtime atelier
-- ---------------------------------------------------------------------------

do $nimr$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workshop_members', 'clients', 'vehicles', 'repair_orders', 'repair_steps',
    'planning_resources', 'planning_slots', 'repair_claims',
    'repair_claim_labor_lines', 'repair_supplements',
    'repair_supplement_lines', 'app_settings', 'sync_operations',
    'sync_conflicts'
  ]
  loop
    execute format('alter table public.%I replica identity full', table_name);

    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$nimr$;

insert into public.nimr_schema_migrations (version, description)
values (
  '23.2.8-full-audit',
  'Version optimiste, RLS par rôle, idempotence, conflits, réservation atomique et Realtime atelier.'
)
on conflict (version) do update
set description = excluded.description;

update public.workshops
set schema_version = '23.2.8-full-audit',
    updated_at = clock_timestamp();

notify pgrst, 'reload schema';

commit;
