-- KHA-76 / P0c.2a
-- Same-workshop structural foreign keys for legacy core/media relations.
-- Additive only: no data rewrite, no RLS/GRANT change, no warranty-network table.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create unique index if not exists clients_workshop_id_id_uidx
  on public.clients (workshop_id, id);
create unique index if not exists vehicles_workshop_id_id_uidx
  on public.vehicles (workshop_id, id);
create unique index if not exists repair_orders_workshop_id_id_uidx
  on public.repair_orders (workshop_id, id);
create unique index if not exists repair_claims_workshop_id_id_uidx
  on public.repair_claims (workshop_id, id);
create unique index if not exists repair_supplements_workshop_id_id_uidx
  on public.repair_supplements (workshop_id, id);
create unique index if not exists repair_steps_workshop_id_id_uidx
  on public.repair_steps (workshop_id, id);

create index if not exists vehicles_workshop_client_scope_idx
  on public.vehicles (workshop_id, client_id);
create index if not exists repair_orders_workshop_vehicle_scope_idx
  on public.repair_orders (workshop_id, vehicle_id);
create index if not exists repair_orders_workshop_client_scope_idx
  on public.repair_orders (workshop_id, client_id);
create index if not exists repair_steps_workshop_order_scope_idx
  on public.repair_steps (workshop_id, repair_order_id);
create index if not exists repair_steps_workshop_technician_scope_idx
  on public.repair_steps (workshop_id, technician_resource_id);
create index if not exists repair_steps_workshop_zone_scope_idx
  on public.repair_steps (workshop_id, zone_resource_id);
create index if not exists repair_steps_workshop_subcontractor_scope_idx
  on public.repair_steps (workshop_id, subcontractor_resource_id);
create index if not exists repair_claims_workshop_order_scope_idx
  on public.repair_claims (workshop_id, repair_order_id);
create index if not exists repair_claim_labor_lines_workshop_claim_scope_idx
  on public.repair_claim_labor_lines (workshop_id, claim_id);
create index if not exists repair_supplements_workshop_order_scope_idx
  on public.repair_supplements (workshop_id, repair_order_id);
create index if not exists repair_supplements_workshop_claim_scope_idx
  on public.repair_supplements (workshop_id, claim_id);
create index if not exists repair_supplement_lines_workshop_supplement_scope_idx
  on public.repair_supplement_lines (workshop_id, supplement_id);
create index if not exists photos_workshop_order_scope_idx
  on public.photos (workshop_id, repair_order_id);
create index if not exists photos_workshop_vehicle_scope_idx
  on public.photos (workshop_id, vehicle_id);
create index if not exists photos_workshop_claim_scope_idx
  on public.photos (workshop_id, claim_id);
create index if not exists photos_workshop_step_scope_idx
  on public.photos (workshop_id, repair_step_id);
alter table public.vehicles
  add constraint vehicles_workshop_client_fkey
  foreign key (workshop_id, client_id)
  references public.clients (workshop_id, id)
  on delete set null (client_id)
  not valid;

alter table public.repair_orders
  add constraint repair_orders_workshop_vehicle_fkey
  foreign key (workshop_id, vehicle_id)
  references public.vehicles (workshop_id, id)
  on delete set null (vehicle_id)
  not valid;

alter table public.repair_orders
  add constraint repair_orders_workshop_client_fkey
  foreign key (workshop_id, client_id)
  references public.clients (workshop_id, id)
  on delete set null (client_id)
  not valid;

alter table public.repair_steps
  add constraint repair_steps_workshop_order_fkey
  foreign key (workshop_id, repair_order_id)
  references public.repair_orders (workshop_id, id)
  on delete cascade
  not valid;

alter table public.repair_steps
  add constraint repair_steps_workshop_technician_fkey
  foreign key (workshop_id, technician_resource_id)
  references public.planning_resources (workshop_id, id)
  on delete set null (technician_resource_id)
  not valid;

alter table public.repair_steps
  add constraint repair_steps_workshop_zone_fkey
  foreign key (workshop_id, zone_resource_id)
  references public.planning_resources (workshop_id, id)
  on delete set null (zone_resource_id)
  not valid;

alter table public.repair_steps
  add constraint repair_steps_workshop_subcontractor_fkey
  foreign key (workshop_id, subcontractor_resource_id)
  references public.planning_resources (workshop_id, id)
  on delete set null (subcontractor_resource_id)
  not valid;
alter table public.repair_claims
  add constraint repair_claims_workshop_order_fkey
  foreign key (workshop_id, repair_order_id)
  references public.repair_orders (workshop_id, id)
  on delete cascade
  not valid;

alter table public.repair_claim_labor_lines
  add constraint repair_claim_labor_lines_workshop_claim_fkey
  foreign key (workshop_id, claim_id)
  references public.repair_claims (workshop_id, id)
  on delete cascade
  not valid;

alter table public.repair_supplements
  add constraint repair_supplements_workshop_order_fkey
  foreign key (workshop_id, repair_order_id)
  references public.repair_orders (workshop_id, id)
  on delete cascade
  not valid;

alter table public.repair_supplements
  add constraint repair_supplements_workshop_claim_fkey
  foreign key (workshop_id, claim_id)
  references public.repair_claims (workshop_id, id)
  on delete set null (claim_id)
  not valid;

alter table public.repair_supplement_lines
  add constraint repair_supplement_lines_workshop_supplement_fkey
  foreign key (workshop_id, supplement_id)
  references public.repair_supplements (workshop_id, id)
  on delete cascade
  not valid;

alter table public.photos
  add constraint photos_workshop_order_fkey
  foreign key (workshop_id, repair_order_id)
  references public.repair_orders (workshop_id, id)
  on delete cascade
  not valid;

alter table public.photos
  add constraint photos_workshop_vehicle_fkey
  foreign key (workshop_id, vehicle_id)
  references public.vehicles (workshop_id, id)
  on delete set null (vehicle_id)
  not valid;

alter table public.photos
  add constraint photos_workshop_claim_fkey
  foreign key (workshop_id, claim_id)
  references public.repair_claims (workshop_id, id)
  on delete set null (claim_id)
  not valid;

alter table public.photos
  add constraint photos_workshop_step_fkey
  foreign key (workshop_id, repair_step_id)
  references public.repair_steps (workshop_id, id)
  on delete set null (repair_step_id)
  not valid;
alter table public.vehicles validate constraint vehicles_workshop_client_fkey;
alter table public.repair_orders validate constraint repair_orders_workshop_vehicle_fkey;
alter table public.repair_orders validate constraint repair_orders_workshop_client_fkey;
alter table public.repair_steps validate constraint repair_steps_workshop_order_fkey;
alter table public.repair_steps validate constraint repair_steps_workshop_technician_fkey;
alter table public.repair_steps validate constraint repair_steps_workshop_zone_fkey;
alter table public.repair_steps validate constraint repair_steps_workshop_subcontractor_fkey;
alter table public.repair_claims validate constraint repair_claims_workshop_order_fkey;
alter table public.repair_claim_labor_lines validate constraint repair_claim_labor_lines_workshop_claim_fkey;
alter table public.repair_supplements validate constraint repair_supplements_workshop_order_fkey;
alter table public.repair_supplements validate constraint repair_supplements_workshop_claim_fkey;
alter table public.repair_supplement_lines validate constraint repair_supplement_lines_workshop_supplement_fkey;
alter table public.photos validate constraint photos_workshop_order_fkey;
alter table public.photos validate constraint photos_workshop_vehicle_fkey;
alter table public.photos validate constraint photos_workshop_claim_fkey;
alter table public.photos validate constraint photos_workshop_step_fkey;
