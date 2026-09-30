-- KHA-48 / MEDIA-UPLOAD-001
-- Additive media metadata model. No legacy column is removed or renamed.

alter table public.photos
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists claim_id uuid references public.repair_claims(id) on delete set null,
  add column if not exists repair_step_id uuid references public.repair_steps(id) on delete set null,
  add column if not exists source_task_id text,
  add column if not exists media_type text not null default 'photo',
  add column if not exists business_context text,
  add column if not exists evidence_kind text,
  add column if not exists drive_file_id text,
  add column if not exists drive_folder_id text,
  add column if not exists checksum_sha256 text,
  add column if not exists caption text,
  add column if not exists upload_status text not null default 'pending',
  add column if not exists uploaded_by uuid,
  add column if not exists uploaded_at timestamptz,
  add column if not exists last_upload_error text,
  add column if not exists upload_attempts integer not null default 0;

alter table public.photos
  drop constraint if exists photos_media_type_check,
  add constraint photos_media_type_check
    check (media_type in ('photo', 'video')) not valid,
  drop constraint if exists photos_business_context_check,
  add constraint photos_business_context_check
    check (business_context is null or business_context in ('reception','diagnostic','repair','qc','warranty','delivery')) not valid;

alter table public.photos
  drop constraint if exists photos_evidence_kind_check,
  add constraint photos_evidence_kind_check
    check (evidence_kind is null or evidence_kind in ('general','odometer','registration','vin','exterior_damage','interior','causal_part','other')) not valid,
  drop constraint if exists photos_upload_status_check,
  add constraint photos_upload_status_check
    check (upload_status in ('pending','uploading','uploaded','failed')) not valid,
  drop constraint if exists photos_upload_attempts_check,
  add constraint photos_upload_attempts_check
    check (upload_attempts >= 0) not valid,
  drop constraint if exists photos_uploaded_drive_check,
  add constraint photos_uploaded_drive_check
    check (upload_status <> 'uploaded' or nullif(btrim(drive_file_id), '') is not null) not valid;

create index if not exists photos_vehicle_idx
  on public.photos (workshop_id, vehicle_id)
  where deleted_at is null and vehicle_id is not null;

create index if not exists photos_claim_idx
  on public.photos (workshop_id, claim_id)
  where deleted_at is null and claim_id is not null;

create index if not exists photos_upload_queue_idx
  on public.photos (workshop_id, upload_status, updated_at)
  where deleted_at is null and upload_status in ('pending','uploading','failed');

create index if not exists photos_checksum_idx
  on public.photos (workshop_id, checksum_sha256)
  where deleted_at is null and checksum_sha256 is not null;

create unique index if not exists photos_drive_file_unique
  on public.photos (workshop_id, drive_file_id)
  where deleted_at is null and drive_file_id is not null and btrim(drive_file_id) <> '';

alter table public.photos validate constraint photos_media_type_check;
alter table public.photos validate constraint photos_business_context_check;
alter table public.photos validate constraint photos_evidence_kind_check;
alter table public.photos validate constraint photos_upload_status_check;
alter table public.photos validate constraint photos_upload_attempts_check;
alter table public.photos validate constraint photos_uploaded_drive_check;

comment on column public.photos.storage_path is
  'Legacy compatibility/informational path only. Drive authority is drive_file_id.';
comment on column public.photos.drive_file_id is
  'Physical Google Drive file authority for uploaded media.';
comment on column public.photos.upload_status is
  'MEDIA-UPLOAD-001 lifecycle: pending, uploading, uploaded, failed.';
