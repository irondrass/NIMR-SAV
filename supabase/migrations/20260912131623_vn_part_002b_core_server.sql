-- Migration: vn_part_002b_core_server
-- VN-PART Phase 2: Database Schema, Immutability Audit, Authoritative RPC and Donor State View.
-- Strict non-invasive migration: preserves existing tables, policies, and role definitions.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create schema if not exists nimr_internal;
revoke all on schema nimr_internal from public, anon;
grant usage on schema nimr_internal to authenticated, service_role;

-- 1. Table: public.vn_part_removals
create table if not exists public.vn_part_removals (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  created_by_role text not null,
  updated_at timestamptz not null default clock_timestamp(),
  version bigint not null default 1 check (version > 0),
  beneficiary_model text not null check (trim(beneficiary_model) <> ''),
  beneficiary_vin text,
  beneficiary_or text,
  part_reference text,
  part_designation text not null check (trim(part_designation) <> ''),
  quantity integer not null default 1 check (quantity > 0),
  reason text not null check (trim(reason) <> ''),
  urgency text,
  comments text,
  expected_replacement_date date,
  donor_model text,
  donor_vin text,
  donor_location text,
  removed_at timestamptz,
  removed_by uuid,
  replacement_available_at timestamptz,
  replacement_available_by uuid,
  store_ack_at timestamptz,
  store_ack_by uuid,
  restored_at timestamptz,
  restored_by uuid,
  closed_at timestamptz,
  status text not null default 'EN_ATTENTE_VALIDATIONS' check (
    status in (
      'EN_ATTENTE_VALIDATIONS',
      'REFUSE',
      'AUTORISE_A_PRELEVER',
      'PRELEVE_EN_ATTENTE_PIECE',
      'PIECE_DISPONIBLE',
      'RESTITUE_AU_VN',
      'CLOTURE',
      'ANNULE'
    )
  ),
  constraint vn_part_beneficiary_donor_vin_check check (
    beneficiary_vin is null
    or donor_vin is null
    or trim(beneficiary_vin) = ''
    or trim(donor_vin) = ''
    or upper(trim(beneficiary_vin)) <> upper(trim(donor_vin))
  )
);

create index if not exists idx_vn_part_removals_workshop_status on public.vn_part_removals (workshop_id, status);
create index if not exists idx_vn_part_removals_donor on public.vn_part_removals (workshop_id, donor_vin) where donor_vin is not null;
create index if not exists idx_vn_part_removals_created_at on public.vn_part_removals (workshop_id, created_at desc);

-- 2. Table: public.vn_part_approvals
create table if not exists public.vn_part_approvals (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null,
  removal_id uuid not null references public.vn_part_removals(id) on delete restrict,
  approval_role text not null check (approval_role in ('directeur', 'directeur_pieces', 'responsable_qualite_parc_vn')),
  decision text not null check (decision in ('APPROVED', 'REFUSED')),
  decided_at timestamptz not null default clock_timestamp(),
  decided_by uuid not null,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  constraint vn_part_approvals_unique_role unique (removal_id, approval_role)
);

create index if not exists idx_vn_part_approvals_removal on public.vn_part_approvals (removal_id);
create index if not exists idx_vn_part_approvals_workshop on public.vn_part_approvals (workshop_id);

-- 3. Table: public.vn_part_audit_events
create table if not exists public.vn_part_audit_events (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null,
  removal_id uuid not null references public.vn_part_removals(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid not null,
  actor_role text not null,
  action text not null check (
    action in (
      'CREATE_REQUEST',
      'APPROVE',
      'REFUSE',
      'CANCEL',
      'REVISE_ETA',
      'REVISE_DONOR',
      'AUTHORIZE',
      'CONFIRM_REMOVAL',
      'STORE_ACK',
      'MARK_REPLACEMENT_AVAILABLE',
      'CONFIRM_RESTITUTION',
      'CLOSE'
    )
  ),
  old_status text,
  new_status text not null,
  reason text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_vn_part_audit_removal on public.vn_part_audit_events (removal_id, created_at);
create index if not exists idx_vn_part_audit_workshop on public.vn_part_audit_events (workshop_id, created_at desc);

-- 4. Audit Immutability Trigger
create or replace function nimr_internal.vn_part_prevent_audit_mutation()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
begin
  raise exception 'Les événements d''audit VN-PART sont strictement immuables.' using errcode = '42501';
end;
$fn$;

drop trigger if exists trg_vn_part_audit_immutable on public.vn_part_audit_events;
create trigger trg_vn_part_audit_immutable
before update or delete on public.vn_part_audit_events
for each row execute function nimr_internal.vn_part_prevent_audit_mutation();

-- 5. Donor State View: public.vn_part_donor_state_v1
create or replace view public.vn_part_donor_state_v1
with (security_invoker = true)
as
select
  r.workshop_id,
  r.donor_model,
  r.donor_vin,
  max(r.donor_location) as donor_location,
  count(*) filter (
    where r.removed_at is not null
      and r.restored_at is null
  ) as active_removals_remaining,
  count(*) filter (
    where r.removed_at is not null
      and r.restored_at is null
  ) as parts_not_returned,
  count(*) filter (
    where r.removed_at is not null
      and r.restored_at is null
      and r.replacement_available_at is null
  ) as waiting_replacement_count,
  count(*) filter (
    where r.removed_at is not null
      and r.restored_at is null
      and r.replacement_available_at is not null
  ) as available_to_restore_count,
  min(r.removed_at) filter (
    where r.removed_at is not null
      and r.restored_at is null
  ) as oldest_opened_at,
  min(r.expected_replacement_date) filter (
    where r.removed_at is not null
      and r.restored_at is null
      and r.replacement_available_at is null
  ) as expected_replacement_date,
  count(*) filter (
    where r.removed_at is not null
      and r.restored_at is null
      and r.replacement_available_at is null
      and r.expected_replacement_date is not null
      and r.expected_replacement_date < current_date
  ) as overdue_count,
  (
    count(*) filter (
      where r.removed_at is not null
        and r.restored_at is null
    ) > 0
    and
    count(*) filter (
      where r.removed_at is not null
        and r.restored_at is null
        and r.replacement_available_at is null
    ) = 0
  ) as can_be_restored_today,
  (
    count(*) filter (
      where r.removed_at is not null
    ) > 0
    and
    count(*) filter (
      where r.removed_at is not null
        and r.restored_at is null
    ) = 0
  ) as is_fully_restored
from public.vn_part_removals r
where r.donor_vin is not null and trim(r.donor_vin) <> ''
group by r.workshop_id, r.donor_model, r.donor_vin;

-- 6. Row Level Security
alter table public.vn_part_removals enable row level security;
alter table public.vn_part_approvals enable row level security;
alter table public.vn_part_audit_events enable row level security;

drop policy if exists vn_part_removals_read_policy on public.vn_part_removals;
create policy vn_part_removals_read_policy on public.vn_part_removals
for select using (
  public.nimr_has_workshop_role(workshop_id, array[
    'admin_technique', 'directeur', 'chef_atelier', 'lecture_seule',
    'directeur_pieces', 'responsable_magasin', 'responsable_garantie_support',
    'responsable_qualite_parc_vn'
  ])
);

drop policy if exists vn_part_approvals_read_policy on public.vn_part_approvals;
create policy vn_part_approvals_read_policy on public.vn_part_approvals
for select using (
  public.nimr_has_workshop_role(workshop_id, array[
    'admin_technique', 'directeur', 'chef_atelier', 'lecture_seule',
    'directeur_pieces', 'responsable_magasin', 'responsable_garantie_support',
    'responsable_qualite_parc_vn'
  ])
);

drop policy if exists vn_part_audit_events_read_policy on public.vn_part_audit_events;
create policy vn_part_audit_events_read_policy on public.vn_part_audit_events
for select using (
  public.nimr_has_workshop_role(workshop_id, array[
    'admin_technique', 'directeur', 'chef_atelier', 'lecture_seule',
    'directeur_pieces', 'responsable_magasin', 'responsable_garantie_support',
    'responsable_qualite_parc_vn'
  ])
);

-- Deny all direct client INSERT/UPDATE/DELETE explicitly
revoke insert, update, delete on public.vn_part_removals from public, anon, authenticated;
revoke insert, update, delete on public.vn_part_approvals from public, anon, authenticated;
revoke insert, update, delete on public.vn_part_audit_events from public, anon, authenticated;

grant select on public.vn_part_removals to authenticated;
grant select on public.vn_part_approvals to authenticated;
grant select on public.vn_part_audit_events to authenticated;
grant select on public.vn_part_donor_state_v1 to authenticated;

-- 7. Authoritative Mutation Function in nimr_internal
create or replace function nimr_internal.nimr_apply_vn_part_action_v1(
  p_workshop_id uuid,
  p_removal_id uuid,
  p_expected_version bigint,
  p_action text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $rpc$
declare
  v_caller_id uuid;
  v_caller_role text;
  v_action text;
  v_row public.vn_part_removals%rowtype;
  v_updated_row public.vn_part_removals%rowtype;
  v_new_id uuid;
  v_approvals_count int;
  v_reason text;
  v_eta date;
  v_donor_model text;
  v_donor_vin text;
  v_donor_location text;
  v_qty int;
  v_ben_model text;
  v_part_desig text;
  v_urgency text;
  v_comments text;
  v_part_ref text;
  v_ben_vin text;
  v_ben_or text;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    return jsonb_build_object('success', false, 'ok', false, 'code', 'UNAUTHENTICATED', 'message', 'Jeton d''authentification requis.');
  end if;

  v_caller_role := public.nimr_current_workshop_role(p_workshop_id);
  if v_caller_role is null then
    return jsonb_build_object('success', false, 'ok', false, 'code', 'UNAUTHORIZED_WORKSHOP_MEMBER', 'message', 'Accès atelier refusé.');
  end if;

  v_action := upper(trim(coalesce(p_action, '')));

  -- Action 1: CREATE_REQUEST
  if v_action = 'CREATE_REQUEST' then
    if v_caller_role not in ('chef_atelier', 'responsable_garantie_support') then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'FORBIDDEN_INITIATOR_ROLE', 'message', 'Seul le chef d''atelier ou le responsable garantie / support peut initier un prélèvement VN.');
    end if;

    v_ben_model := trim(coalesce(p_payload->>'beneficiary_model', ''));
    v_part_desig := trim(coalesce(p_payload->>'part_designation', ''));
    v_reason := trim(coalesce(p_payload->>'reason', ''));
    v_qty := coalesce((p_payload->>'quantity')::int, 1);
    v_ben_vin := nullif(trim(coalesce(p_payload->>'beneficiary_vin', '')), '');
    v_ben_or := nullif(trim(coalesce(p_payload->>'beneficiary_or', '')), '');
    v_part_ref := nullif(trim(coalesce(p_payload->>'part_reference', '')), '');
    v_urgency := nullif(trim(coalesce(p_payload->>'urgency', '')), '');
    v_comments := nullif(trim(coalesce(p_payload->>'comments', '')), '');

    if v_ben_model = '' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'BENEFICIARY_MODEL_REQUIRED', 'message', 'Le modèle du véhicule bénéficiaire est obligatoire.');
    end if;
    if v_part_desig = '' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'PART_DESIGNATION_REQUIRED', 'message', 'La désignation de la pièce est obligatoire.');
    end if;
    if v_reason = '' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'REASON_REQUIRED', 'message', 'Le motif du prélèvement est obligatoire.');
    end if;
    if v_qty <= 0 then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'INVALID_QUANTITY', 'message', 'La quantité doit être supérieure à zéro.');
    end if;

    insert into public.vn_part_removals (
      workshop_id,
      created_by,
      created_by_role,
      version,
      beneficiary_model,
      beneficiary_vin,
      beneficiary_or,
      part_reference,
      part_designation,
      quantity,
      reason,
      urgency,
      comments,
      status
    ) values (
      p_workshop_id,
      v_caller_id,
      v_caller_role,
      1,
      v_ben_model,
      v_ben_vin,
      v_ben_or,
      v_part_ref,
      v_part_desig,
      v_qty,
      v_reason,
      v_urgency,
      v_comments,
      'EN_ATTENTE_VALIDATIONS'
    ) returning * into v_updated_row;

    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_updated_row.id,
      v_caller_id,
      v_caller_role,
      'CREATE_REQUEST',
      null,
      'EN_ATTENTE_VALIDATIONS',
      v_reason,
      null,
      to_jsonb(v_updated_row),
      p_payload
    );

    return jsonb_build_object(
      'success', true,
      'ok', true,
      'action', 'CREATE_REQUEST',
      'removal_id', v_updated_row.id,
      'version', v_updated_row.version,
      'status', v_updated_row.status,
      'record', to_jsonb(v_updated_row)
    );
  end if;

  -- All following actions require p_removal_id and CAS check on p_expected_version
  if p_removal_id is null then
    return jsonb_build_object('success', false, 'ok', false, 'code', 'REMOVAL_ID_REQUIRED', 'message', 'L''identifiant du dossier de prélèvement est requis.');
  end if;

  if p_expected_version is null then
    return jsonb_build_object('success', false, 'ok', false, 'code', 'EXPECTED_VERSION_REQUIRED', 'message', 'La version attendue est requise pour le contrôle de concurrence.');
  end if;

  -- Lock target row for update
  select * into v_row from public.vn_part_removals
    where id = p_removal_id and workshop_id = p_workshop_id
    for update;

  if v_row.id is null then
    return jsonb_build_object('success', false, 'ok', false, 'code', 'REMOVAL_NOT_FOUND', 'message', 'Dossier de prélèvement introuvable.');
  end if;

  -- CAS Concurrency check
  if v_row.version <> p_expected_version then
    return jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'VERSION_CONFLICT',
      'message', 'La version du dossier a changé. Veuillez actualiser avant de recommencer.',
      'expected_version', p_expected_version,
      'current_version', v_row.version
    );
  end if;

  -- Action 2: APPROVE
  if v_action = 'APPROVE' then
    if v_caller_role not in ('directeur', 'directeur_pieces', 'responsable_qualite_parc_vn') then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'FORBIDDEN_APPROVER_ROLE', 'message', 'Rôle non autorisé pour l''approbation d''un prélèvement VN.');
    end if;

    if v_row.status <> 'EN_ATTENTE_VALIDATIONS' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'INVALID_STATUS_FOR_APPROVAL', 'message', 'Le dossier n''est plus en attente de validations.');
    end if;

    if v_row.created_by = v_caller_id then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'CANNOT_APPROVE_OWN_REQUEST', 'message', 'L''initiateur de la demande ne peut pas approuver son propre prélèvement.');
    end if;

    if exists (select 1 from public.vn_part_approvals where removal_id = v_row.id and approval_role = v_caller_role) then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'ALREADY_DECIDED', 'message', 'Ce rôle a déjà statué sur cette demande.');
    end if;

    if v_caller_role = 'directeur_pieces' then
      v_eta := nullif(trim(coalesce(p_payload->>'expected_replacement_date', '')), '')::date;
      if v_eta is null then
        return jsonb_build_object('success', false, 'ok', false, 'code', 'ETA_REQUIRED', 'message', 'La date d''arrivée prévue de la pièce de remplacement est obligatoire.');
      end if;
      update public.vn_part_removals set expected_replacement_date = v_eta where id = v_row.id;
      v_row.expected_replacement_date := v_eta;
    elsif v_caller_role = 'responsable_qualite_parc_vn' then
      v_donor_model := trim(coalesce(p_payload->>'donor_model', ''));
      v_donor_vin := trim(coalesce(p_payload->>'donor_vin', ''));
      v_donor_location := nullif(trim(coalesce(p_payload->>'donor_location', '')), '');

      if v_donor_model = '' or v_donor_vin = '' then
        return jsonb_build_object('success', false, 'ok', false, 'code', 'DONOR_DATA_REQUIRED', 'message', 'Le modèle et le VIN du véhicule donneur sont obligatoires.');
      end if;

      if coalesce(v_row.beneficiary_vin, '') <> '' and upper(trim(v_row.beneficiary_vin)) = upper(v_donor_vin) then
        return jsonb_build_object('success', false, 'ok', false, 'code', 'BENEFICIARY_DONOR_VIN_COLLISION', 'message', 'Le véhicule donneur ne peut pas être identique au véhicule bénéficiaire.');
      end if;

      update public.vn_part_removals set
        donor_model = v_donor_model,
        donor_vin = v_donor_vin,
        donor_location = coalesce(v_donor_location, donor_location)
      where id = v_row.id;
      v_row.donor_model := v_donor_model;
      v_row.donor_vin := v_donor_vin;
      if v_donor_location is not null then v_row.donor_location := v_donor_location; end if;
    end if;

    insert into public.vn_part_approvals (
      workshop_id,
      removal_id,
      approval_role,
      decision,
      decided_at,
      decided_by,
      reason,
      payload
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_role,
      'APPROVED',
      clock_timestamp(),
      v_caller_id,
      nullif(trim(coalesce(p_payload->>'reason', '')), ''),
      p_payload
    );

    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_id,
      v_caller_role,
      'APPROVE',
      v_row.status,
      v_row.status,
      nullif(trim(coalesce(p_payload->>'reason', '')), ''),
      to_jsonb(v_row),
      to_jsonb(v_row),
      p_payload
    );

    -- Check if all 3 approvals are obtained
    select count(*) into v_approvals_count
      from public.vn_part_approvals
      where removal_id = v_row.id and decision = 'APPROVED';

    if v_approvals_count = 3 then
      update public.vn_part_removals set
        status = 'AUTORISE_A_PRELEVER',
        version = v_row.version + 1,
        updated_at = clock_timestamp()
      where id = v_row.id
      returning * into v_updated_row;

      insert into public.vn_part_audit_events (
        workshop_id,
        removal_id,
        actor_user_id,
        actor_role,
        action,
        old_status,
        new_status,
        reason,
        before_state,
        after_state,
        metadata
      ) values (
        p_workshop_id,
        v_row.id,
        v_caller_id,
        v_caller_role,
        'AUTHORIZE',
        'EN_ATTENTE_VALIDATIONS',
        'AUTORISE_A_PRELEVER',
        'Les 3 approbations requises (Directeur, Directeur Pièces, Responsable Qualité / Chef de Parc VN) sont enregistrées.',
        to_jsonb(v_row),
        to_jsonb(v_updated_row),
        jsonb_build_object('total_approvals', 3)
      );
    else
      update public.vn_part_removals set
        version = v_row.version + 1,
        updated_at = clock_timestamp()
      where id = v_row.id
      returning * into v_updated_row;
    end if;

    return jsonb_build_object(
      'success', true,
      'ok', true,
      'action', 'APPROVE',
      'removal_id', v_updated_row.id,
      'version', v_updated_row.version,
      'status', v_updated_row.status,
      'record', to_jsonb(v_updated_row)
    );

  -- Action 3: REFUSE
  elsif v_action = 'REFUSE' then
    if v_caller_role not in ('directeur', 'directeur_pieces', 'responsable_qualite_parc_vn') then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'FORBIDDEN_APPROVER_ROLE', 'message', 'Rôle non autorisé pour statuer sur un prélèvement VN.');
    end if;

    if v_row.status <> 'EN_ATTENTE_VALIDATIONS' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'INVALID_STATUS_FOR_REFUSAL', 'message', 'Le refus n''est autorisé qu''en attente de validations.');
    end if;

    v_reason := trim(coalesce(p_payload->>'reason', ''));
    if v_reason = '' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'REASON_REQUIRED', 'message', 'Le motif de refus est obligatoire.');
    end if;

    insert into public.vn_part_approvals (
      workshop_id,
      removal_id,
      approval_role,
      decision,
      decided_at,
      decided_by,
      reason,
      payload
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_role,
      'REFUSED',
      clock_timestamp(),
      v_caller_id,
      v_reason,
      p_payload
    );

    update public.vn_part_removals set
      status = 'REFUSE',
      version = v_row.version + 1,
      updated_at = clock_timestamp()
    where id = v_row.id
    returning * into v_updated_row;

    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_id,
      v_caller_role,
      'REFUSE',
      v_row.status,
      'REFUSE',
      v_reason,
      to_jsonb(v_row),
      to_jsonb(v_updated_row),
      p_payload
    );

    return jsonb_build_object(
      'success', true,
      'ok', true,
      'action', 'REFUSE',
      'removal_id', v_updated_row.id,
      'version', v_updated_row.version,
      'status', v_updated_row.status,
      'record', to_jsonb(v_updated_row)
    );

  -- Action 4: CANCEL
  elsif v_action = 'CANCEL' then
    if v_row.status not in ('EN_ATTENTE_VALIDATIONS', 'AUTORISE_A_PRELEVER') then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'CANNOT_CANCEL_AFTER_REMOVAL', 'message', 'L''annulation est impossible après le prélèvement physique.');
    end if;

    if v_row.created_by <> v_caller_id and v_caller_role <> 'directeur' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'FORBIDDEN_CANCELLATION', 'message', 'Seul l''initiateur de la demande ou la direction peut annuler la demande.');
    end if;

    v_reason := trim(coalesce(p_payload->>'reason', ''));
    if v_reason = '' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'REASON_REQUIRED', 'message', 'Le motif d''annulation est obligatoire.');
    end if;

    update public.vn_part_removals set
      status = 'ANNULE',
      version = v_row.version + 1,
      updated_at = clock_timestamp()
    where id = v_row.id
    returning * into v_updated_row;

    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_id,
      v_caller_role,
      'CANCEL',
      v_row.status,
      'ANNULE',
      v_reason,
      to_jsonb(v_row),
      to_jsonb(v_updated_row),
      p_payload
    );

    return jsonb_build_object(
      'success', true,
      'ok', true,
      'action', 'CANCEL',
      'removal_id', v_updated_row.id,
      'version', v_updated_row.version,
      'status', v_updated_row.status,
      'record', to_jsonb(v_updated_row)
    );

  -- Action 5: REVISE_ETA
  elsif v_action = 'REVISE_ETA' then
    if v_caller_role <> 'directeur_pieces' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'FORBIDDEN_REVISE_ETA', 'message', 'Seul le directeur pièces peut réviser la date prévue de remplacement.');
    end if;

    if v_row.status in ('CLOTURE', 'ANNULE', 'REFUSE') then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'CANNOT_REVISE_TERMINAL', 'message', 'Impossible de réviser un dossier clos, annulé ou refusé.');
    end if;

    v_eta := nullif(trim(coalesce(p_payload->>'expected_replacement_date', '')), '')::date;
    if v_eta is null then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'ETA_REQUIRED', 'message', 'La nouvelle date de remplacement prévue est obligatoire.');
    end if;

    update public.vn_part_removals set
      expected_replacement_date = v_eta,
      version = v_row.version + 1,
      updated_at = clock_timestamp()
    where id = v_row.id
    returning * into v_updated_row;

    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_id,
      v_caller_role,
      'REVISE_ETA',
      v_row.status,
      v_updated_row.status,
      nullif(trim(coalesce(p_payload->>'reason', '')), ''),
      jsonb_build_object('expected_replacement_date', v_row.expected_replacement_date),
      jsonb_build_object('expected_replacement_date', v_updated_row.expected_replacement_date),
      p_payload
    );

    return jsonb_build_object(
      'success', true,
      'ok', true,
      'action', 'REVISE_ETA',
      'removal_id', v_updated_row.id,
      'version', v_updated_row.version,
      'status', v_updated_row.status,
      'record', to_jsonb(v_updated_row)
    );

  -- Action 6: REVISE_DONOR
  elsif v_action = 'REVISE_DONOR' then
    if v_caller_role <> 'responsable_qualite_parc_vn' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'FORBIDDEN_REVISE_DONOR', 'message', 'Seul le responsable qualité / chef de parc VN peut modifier le véhicule donneur.');
    end if;

    if v_row.status not in ('EN_ATTENTE_VALIDATIONS', 'AUTORISE_A_PRELEVER') then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'CANNOT_REVISE_DONOR_AFTER_REMOVAL', 'message', 'Le véhicule donneur ne peut plus être modifié après le prélèvement.');
    end if;

    v_donor_model := trim(coalesce(p_payload->>'donor_model', ''));
    v_donor_vin := trim(coalesce(p_payload->>'donor_vin', ''));
    v_donor_location := nullif(trim(coalesce(p_payload->>'donor_location', '')), '');

    if v_donor_model = '' or v_donor_vin = '' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'DONOR_DATA_REQUIRED', 'message', 'Le modèle et le VIN du véhicule donneur sont obligatoires.');
    end if;

    if coalesce(v_row.beneficiary_vin, '') <> '' and upper(trim(v_row.beneficiary_vin)) = upper(v_donor_vin) then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'BENEFICIARY_DONOR_VIN_COLLISION', 'message', 'Le véhicule donneur ne peut pas être identique au véhicule bénéficiaire.');
    end if;

    update public.vn_part_removals set
      donor_model = v_donor_model,
      donor_vin = v_donor_vin,
      donor_location = coalesce(v_donor_location, donor_location),
      version = v_row.version + 1,
      updated_at = clock_timestamp()
    where id = v_row.id
    returning * into v_updated_row;

    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_id,
      v_caller_role,
      'REVISE_DONOR',
      v_row.status,
      v_updated_row.status,
      nullif(trim(coalesce(p_payload->>'reason', '')), ''),
      jsonb_build_object('donor_model', v_row.donor_model, 'donor_vin', v_row.donor_vin, 'donor_location', v_row.donor_location),
      jsonb_build_object('donor_model', v_updated_row.donor_model, 'donor_vin', v_updated_row.donor_vin, 'donor_location', v_updated_row.donor_location),
      p_payload
    );

    return jsonb_build_object(
      'success', true,
      'ok', true,
      'action', 'REVISE_DONOR',
      'removal_id', v_updated_row.id,
      'version', v_updated_row.version,
      'status', v_updated_row.status,
      'record', to_jsonb(v_updated_row)
    );

  -- Action 7: CONFIRM_REMOVAL
  elsif v_action = 'CONFIRM_REMOVAL' then
    if v_caller_role <> 'chef_atelier' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'FORBIDDEN_REMOVAL_CONFIRMATION', 'message', 'Seul le chef d''atelier peut confirmer le prélèvement physique.');
    end if;

    if v_row.status <> 'AUTORISE_A_PRELEVER' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'INVALID_STATUS_FOR_REMOVAL', 'message', 'Le prélèvement physique nécessite le statut AUTORISE_A_PRELEVER.');
    end if;

    update public.vn_part_removals set
      status = 'PRELEVE_EN_ATTENTE_PIECE',
      removed_at = clock_timestamp(),
      removed_by = v_caller_id,
      version = v_row.version + 1,
      updated_at = clock_timestamp()
    where id = v_row.id
    returning * into v_updated_row;

    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_id,
      v_caller_role,
      'CONFIRM_REMOVAL',
      v_row.status,
      'PRELEVE_EN_ATTENTE_PIECE',
      nullif(trim(coalesce(p_payload->>'reason', '')), ''),
      to_jsonb(v_row),
      to_jsonb(v_updated_row),
      p_payload
    );

    return jsonb_build_object(
      'success', true,
      'ok', true,
      'action', 'CONFIRM_REMOVAL',
      'removal_id', v_updated_row.id,
      'version', v_updated_row.version,
      'status', v_updated_row.status,
      'record', to_jsonb(v_updated_row)
    );

  -- Action 8: STORE_ACK
  elsif v_action = 'STORE_ACK' then
    if v_caller_role <> 'responsable_magasin' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'FORBIDDEN_STORE_ACK', 'message', 'Seul le responsable magasin peut enregistrer la prise en compte magasin.');
    end if;

    if v_row.status not in ('PRELEVE_EN_ATTENTE_PIECE', 'AUTORISE_A_PRELEVER') then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'INVALID_STATUS_FOR_STORE_ACK', 'message', 'La prise en compte magasin est invalide dans l''état actuel du dossier.');
    end if;

    update public.vn_part_removals set
      store_ack_at = clock_timestamp(),
      store_ack_by = v_caller_id,
      version = v_row.version + 1,
      updated_at = clock_timestamp()
    where id = v_row.id
    returning * into v_updated_row;

    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_id,
      v_caller_role,
      'STORE_ACK',
      v_row.status,
      v_updated_row.status,
      nullif(trim(coalesce(p_payload->>'reason', '')), ''),
      to_jsonb(v_row),
      to_jsonb(v_updated_row),
      p_payload
    );

    return jsonb_build_object(
      'success', true,
      'ok', true,
      'action', 'STORE_ACK',
      'removal_id', v_updated_row.id,
      'version', v_updated_row.version,
      'status', v_updated_row.status,
      'record', to_jsonb(v_updated_row)
    );

  -- Action 9: MARK_REPLACEMENT_AVAILABLE
  elsif v_action = 'MARK_REPLACEMENT_AVAILABLE' then
    if v_caller_role not in ('responsable_magasin', 'directeur_pieces') then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'FORBIDDEN_AVAILABILITY_ROLE', 'message', 'Seul le responsable magasin ou le directeur pièces peut déclarer la pièce reçue.');
    end if;

    if v_row.status <> 'PRELEVE_EN_ATTENTE_PIECE' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'INVALID_STATUS_FOR_AVAILABILITY', 'message', 'La mise à disposition nécessite que la pièce ait été prélevée (PRELEVE_EN_ATTENTE_PIECE).');
    end if;

    update public.vn_part_removals set
      status = 'PIECE_DISPONIBLE',
      replacement_available_at = clock_timestamp(),
      replacement_available_by = v_caller_id,
      version = v_row.version + 1,
      updated_at = clock_timestamp()
    where id = v_row.id
    returning * into v_updated_row;

    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_id,
      v_caller_role,
      'MARK_REPLACEMENT_AVAILABLE',
      v_row.status,
      'PIECE_DISPONIBLE',
      nullif(trim(coalesce(p_payload->>'reason', '')), ''),
      to_jsonb(v_row),
      to_jsonb(v_updated_row),
      p_payload
    );

    return jsonb_build_object(
      'success', true,
      'ok', true,
      'action', 'MARK_REPLACEMENT_AVAILABLE',
      'removal_id', v_updated_row.id,
      'version', v_updated_row.version,
      'status', v_updated_row.status,
      'record', to_jsonb(v_updated_row)
    );

  -- Action 10: CONFIRM_RESTITUTION
  elsif v_action = 'CONFIRM_RESTITUTION' then
    if v_caller_role <> 'chef_atelier' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'FORBIDDEN_RESTITUTION_ROLE', 'message', 'Seul le chef d''atelier peut confirmer la restitution physique.');
    end if;

    if v_row.status <> 'PIECE_DISPONIBLE' then
      return jsonb_build_object('success', false, 'ok', false, 'code', 'INVALID_STATUS_FOR_RESTITUTION', 'message', 'La restitution nécessite que la pièce de remplacement soit déclarée disponible (PIECE_DISPONIBLE).');
    end if;

    update public.vn_part_removals set
      status = 'CLOTURE',
      restored_at = clock_timestamp(),
      restored_by = v_caller_id,
      closed_at = clock_timestamp(),
      version = v_row.version + 1,
      updated_at = clock_timestamp()
    where id = v_row.id
    returning * into v_updated_row;

    -- Dual immutable audit evidence: transition to RESTITUE_AU_VN then CLOTURE
    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_id,
      v_caller_role,
      'CONFIRM_RESTITUTION',
      'PIECE_DISPONIBLE',
      'RESTITUE_AU_VN',
      nullif(trim(coalesce(p_payload->>'reason', '')), ''),
      to_jsonb(v_row),
      to_jsonb(v_updated_row),
      p_payload
    );

    insert into public.vn_part_audit_events (
      workshop_id,
      removal_id,
      actor_user_id,
      actor_role,
      action,
      old_status,
      new_status,
      reason,
      before_state,
      after_state,
      metadata
    ) values (
      p_workshop_id,
      v_row.id,
      v_caller_id,
      v_caller_role,
      'CLOSE',
      'RESTITUE_AU_VN',
      'CLOTURE',
      'Clôture automatique après confirmation de restitution au véhicule donneur.',
      to_jsonb(v_updated_row),
      to_jsonb(v_updated_row),
      jsonb_build_object('atomic_close', true)
    );

    return jsonb_build_object(
      'success', true,
      'ok', true,
      'action', 'CONFIRM_RESTITUTION',
      'removal_id', v_updated_row.id,
      'version', v_updated_row.version,
      'status', v_updated_row.status,
      'record', to_jsonb(v_updated_row)
    );

  else
    return jsonb_build_object('success', false, 'ok', false, 'code', 'UNKNOWN_ACTION', 'message', 'Action inconnue : ' || coalesce(v_action, 'null'));
  end if;
end;
$rpc$;

revoke all on function nimr_internal.nimr_apply_vn_part_action_v1(uuid, uuid, bigint, text, jsonb) from public, anon;
grant execute on function nimr_internal.nimr_apply_vn_part_action_v1(uuid, uuid, bigint, text, jsonb) to authenticated, service_role;

-- 8. Public Security Invoker Wrapper
create or replace function public.nimr_apply_vn_part_action_v1(
  p_workshop_id uuid,
  p_removal_id uuid,
  p_expected_version bigint,
  p_action text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb language sql security invoker set search_path = pg_catalog, public
as $fn$
  select nimr_internal.nimr_apply_vn_part_action_v1(p_workshop_id, p_removal_id, p_expected_version, p_action, p_payload);
$fn$;

revoke all on function public.nimr_apply_vn_part_action_v1(uuid, uuid, bigint, text, jsonb) from public, anon;
grant execute on function public.nimr_apply_vn_part_action_v1(uuid, uuid, bigint, text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
