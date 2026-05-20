-- NIMR Carrosserie v21.83
-- Correctif cible pour l'erreur Supabase:
-- Could not find the table 'public.repair_claims' in the schema cache
--
-- A executer dans Supabase > SQL Editor > New query > Run.
-- Si vous voulez repartir proprement, vous pouvez executer supabase-schema.sql complet a la place.

create extension if not exists "pgcrypto";

create table if not exists public.repair_claims (
  id uuid primary key default gen_random_uuid(),
  local_id text unique,
  repair_order_id uuid references public.repair_orders(id) on delete cascade,
  claim_id uuid references public.repair_claims(id) on delete set null,
  number text,
  title text not null default 'Sinistre',
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

alter table public.repair_claims add column if not exists local_id text;
alter table public.repair_claims add column if not exists repair_order_id uuid references public.repair_orders(id) on delete cascade;
alter table public.repair_claims add column if not exists claim_id uuid references public.repair_claims(id) on delete set null;
alter table public.repair_claims add column if not exists number text;
alter table public.repair_claims add column if not exists title text not null default 'Sinistre';
alter table public.repair_claims add column if not exists vehicle_area text;
alter table public.repair_claims add column if not exists type text default 'assurance';
alter table public.repair_claims add column if not exists status text not null default 'draft';
alter table public.repair_claims add column if not exists include_in_planning boolean default true;
alter table public.repair_claims add column if not exists expert_approved boolean default false;
alter table public.repair_claims add column if not exists client_approved boolean default false;
alter table public.repair_claims add column if not exists estimate_number text;
alter table public.repair_claims add column if not exists or_number text;
alter table public.repair_claims add column if not exists amount numeric(12,2);
alter table public.repair_claims add column if not exists source_file jsonb;
alter table public.repair_claims add column if not exists created_at timestamptz not null default now();
alter table public.repair_claims add column if not exists updated_at timestamptz not null default now();

alter table public.repair_claim_labor_lines add column if not exists local_id text;
alter table public.repair_claim_labor_lines add column if not exists claim_id uuid references public.repair_claims(id) on delete cascade;
alter table public.repair_claim_labor_lines add column if not exists phase text;
alter table public.repair_claim_labor_lines add column if not exists operation text;
alter table public.repair_claim_labor_lines add column if not exists labor_hours numeric(8,2) default 0;
alter table public.repair_claim_labor_lines add column if not exists raw_text text;
alter table public.repair_claim_labor_lines add column if not exists created_at timestamptz not null default now();
alter table public.repair_claim_labor_lines add column if not exists updated_at timestamptz not null default now();

-- Enlever les doublons avant creation des index uniques.
with ranked as (
  select id,
         row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn
  from public.repair_claims
  where local_id is not null
)
delete from public.repair_claims c using ranked r where c.id = r.id and r.rn > 1;

with ranked as (
  select id,
         row_number() over (partition by local_id order by updated_at desc nulls last, created_at desc nulls last, id desc) rn
  from public.repair_claim_labor_lines
  where local_id is not null
)
delete from public.repair_claim_labor_lines c using ranked r where c.id = r.id and r.rn > 1;

drop index if exists public.repair_claims_local_id_uidx;
drop index if exists public.repair_claim_labor_lines_local_id_uidx;
create unique index if not exists repair_claims_local_id_uidx on public.repair_claims(local_id);
create unique index if not exists repair_claim_labor_lines_local_id_uidx on public.repair_claim_labor_lines(local_id);

alter table public.repair_claims enable row level security;
alter table public.repair_claim_labor_lines enable row level security;

do $$
declare
  t text;
  p text;
begin
  foreach t in array array['repair_claims','repair_claim_labor_lines']
  loop
    p := t || ' select authenticated';
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=p) then
      execute format('create policy %I on public.%I for select to authenticated using (true)', p, t);
    end if;

    p := t || ' insert authenticated';
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=p) then
      execute format('create policy %I on public.%I for insert to authenticated with check (true)', p, t);
    end if;

    p := t || ' update authenticated';
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=p) then
      execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', p, t);
    end if;

    p := t || ' delete authenticated';
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=p) then
      execute format('create policy %I on public.%I for delete to authenticated using (true)', p, t);
    end if;
  end loop;
end $$;

-- Important: apres execution, revenez dans l'application et cliquez sur
-- Atelier > Sauvegarde > Controle sauvegarde automatique > Controler maintenant.

-- Force PostgREST/Supabase API schema cache refresh after new tables.
NOTIFY pgrst, 'reload schema';
