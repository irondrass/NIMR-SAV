-- KHA-48 / MEDIA-UPLOAD-001
-- Dedicated covering indexes for the new media foreign keys.

create index if not exists photos_vehicle_fk_idx
  on public.photos (vehicle_id);

create index if not exists photos_claim_fk_idx
  on public.photos (claim_id);

create index if not exists photos_repair_step_fk_idx
  on public.photos (repair_step_id);
