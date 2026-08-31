-- ===========================================================================
-- NIMR SAV — SEC-002: Server/Client Role Parity & Minimal-Privilege QC RPC
-- Target Release: v23.3.15
-- Additive, idempotent, non-destructive migration.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Alignement des rôles canoniques serveur avec le frontend (7 rôles)
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
    when 'controle_qualite' then 'controle_qualite'
    when 'controleur_qualite' then 'controle_qualite'
    when 'quality_controller' then 'controle_qualite'
    when 'qualite' then 'controle_qualite'
    when 'lecture_seule' then 'lecture_seule'
    when 'readonly' then 'lecture_seule'
    when 'member' then 'lecture_seule'
    else null
  end
$nimr$;

-- ---------------------------------------------------------------------------
-- 2. Recréation de la contrainte canonique workshop_members (7 rôles)
-- ---------------------------------------------------------------------------

alter table public.workshop_members
  drop constraint if exists workshop_members_role_canonical_check;

alter table public.workshop_members
  add constraint workshop_members_role_canonical_check
  check (role in (
    'admin_technique',
    'directeur',
    'chef_atelier',
    'reception',
    'technicien',
    'controle_qualite',
    'lecture_seule'
  )) not valid;

-- Normalisation non destructive des seuls alias QC explicites existants.
-- ATTENTION: Ne jamais convertir les lignes déjà stockées en lecture_seule.
update public.workshop_members
set role = 'controle_qualite',
    updated_at = clock_timestamp()
where role in ('controleur_qualite', 'quality_controller', 'qualite')
  and role is distinct from 'controle_qualite';

do $nimr$
begin
  if not exists (
    select 1 from public.workshop_members
    where role not in (
      'admin_technique',
      'directeur',
      'chef_atelier',
      'reception',
      'technicien',
      'controle_qualite',
      'lecture_seule'
    )
  ) then
    alter table public.workshop_members
      validate constraint workshop_members_role_canonical_check;
  end if;
end
$nimr$;

-- ---------------------------------------------------------------------------
-- 3. RPC Dédié Contrôle Qualité à Privilège Minimal (nimr_apply_quality_review_v1)
-- ---------------------------------------------------------------------------

create or replace function public.nimr_apply_quality_review_v1(
  p_workshop_id uuid,
  p_case_id text,
  p_quality_status text,
  p_reason text,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $nimr$
declare
  current_row public.sync_entities;
  applied public.sync_entities;
  accepted_receipt public.sync_entity_operation_receipts;
  current_payload jsonb;
  reception_workflow jsonb;
  flags jsonb;
  history jsonb;
  prev_status text;
  clean_status text;
  clean_reason text;
  now_value timestamptz := clock_timestamp();
  now_iso text;
  new_version bigint;
  op_id text;
  review_event jsonb;
begin
  -- 1. Authentification obligatoire
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- 2. Paramètres obligatoires
  if p_workshop_id is null
    or nullif(trim(p_case_id), '') is null
    or nullif(trim(p_operation_id), '') is null then
    raise exception 'workshop_id, case_id and operation_id are required' using errcode = '22023';
  end if;

  op_id := 'quality-review:' || trim(p_operation_id);
  clean_status := lower(trim(coalesce(p_quality_status, '')));
  clean_reason := trim(coalesce(p_reason, ''));

  -- 3. Contrôle strict des statuts qualité autorisés
  if clean_status not in ('not_started', 'in_progress', 'validated', 'rejected', 'rework') then
    raise exception 'invalid quality status: %', p_quality_status using errcode = '22023';
  end if;

  if clean_status = 'rejected' and clean_reason = '' then
    raise exception 'rejection reason required' using errcode = '22023';
  end if;

  -- 4. Contrôle d'accès au niveau rôle atelier (Privilège Minimal QC)
  -- Seuls autorisés: admin_technique, directeur, chef_atelier, controle_qualite
  -- Refus strict: reception, technicien, lecture_seule
  if not public.nimr_has_workshop_role(
    p_workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier', 'controle_qualite']
  ) then
    raise exception 'quality review access denied' using errcode = '42501';
  end if;

  -- 5. Idempotence avant verrou
  select * into accepted_receipt
  from public.sync_entity_operation_receipts
  where workshop_id = p_workshop_id and local_operation_id = op_id;

  if found then
    if accepted_receipt.entity_type is distinct from 'case'
      or accepted_receipt.entity_id is distinct from p_case_id then
      raise exception 'quality review receipt target mismatch' using errcode = '22023';
    end if;
    select * into current_row from public.sync_entities
    where workshop_id = p_workshop_id
      and entity_type = 'case'
      and entity_id = p_case_id;
    return jsonb_build_object(
      'status', 'idempotent',
      'accepted', true,
      'idempotent', true,
      'conflict', false,
      'accepted_version', accepted_receipt.accepted_version,
      'server_version', current_row.entity_version,
      'canonical', to_jsonb(current_row)
    );
  end if;

  -- 6. Verrouillage sérialisé du dossier (Advisory + Row lock)
  perform pg_advisory_xact_lock(hashtextextended(
    p_workshop_id::text || ':case:' || p_case_id, 0
  ));

  select * into current_row from public.sync_entities
  where workshop_id = p_workshop_id
    and entity_type = 'case'
    and entity_id = p_case_id
  for update;

  if not found or current_row.deleted_at is not null then
    raise exception 'case not found or deleted: %', p_case_id using errcode = 'P0002';
  end if;

  -- Re-vérification d'idempotence après acquisition du verrou
  select * into accepted_receipt
  from public.sync_entity_operation_receipts
  where workshop_id = p_workshop_id and local_operation_id = op_id;

  if found then
    if accepted_receipt.entity_type is distinct from 'case'
      or accepted_receipt.entity_id is distinct from p_case_id then
      raise exception 'quality review receipt target mismatch' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'status', 'idempotent',
      'accepted', true,
      'idempotent', true,
      'conflict', false,
      'accepted_version', accepted_receipt.accepted_version,
      'server_version', current_row.entity_version,
      'canonical', to_jsonb(current_row)
    );
  end if;

  -- 7. Confinement de modification : Patch ciblé du domaine QC uniquement
  current_payload := coalesce(current_row.payload, '{}'::jsonb);
  reception_workflow := coalesce(current_payload->'receptionWorkflow', '{}'::jsonb);
  flags := coalesce(current_payload->'flags', '{}'::jsonb);
  prev_status := lower(trim(coalesce(reception_workflow->>'qualityStatus', 'not_started')));
  now_iso := to_char(now_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  -- Historique des revues qualité
  history := case
    when jsonb_typeof(reception_workflow->'qualityReviewHistory') = 'array'
    then reception_workflow->'qualityReviewHistory'
    else '[]'::jsonb
  end;

  review_event := jsonb_build_object(
    'at', now_iso,
    'by', auth.uid()::text,
    'status', clean_status,
    'reason', clean_reason
  );
  history := history || jsonb_build_array(review_event);

  reception_workflow := jsonb_set(reception_workflow, '{qualityStatus}', to_jsonb(clean_status));
  reception_workflow := jsonb_set(reception_workflow, '{qualityReviewedAt}', to_jsonb(now_iso));
  reception_workflow := jsonb_set(reception_workflow, '{qualityReviewHistory}', history);

  -- Application des règles d'état qualité
  if clean_status = 'validated' then
    flags := jsonb_set(flags, '{qualityApproved}', 'true'::jsonb);
    reception_workflow := jsonb_set(reception_workflow, '{readyForDeliveryAt}', to_jsonb(now_iso));
    if prev_status in ('rejected', 'rework') then
      reception_workflow := jsonb_set(reception_workflow, '{qualityRevalidatedAt}', to_jsonb(now_iso));
    end if;
  else
    flags := jsonb_set(flags, '{qualityApproved}', 'false'::jsonb);
    flags := jsonb_set(flags, '{delivered}', 'false'::jsonb);
    reception_workflow := jsonb_set(reception_workflow, '{readyForDeliveryAt}', '""'::jsonb);
  end if;

  if clean_status = 'rejected' then
    reception_workflow := jsonb_set(reception_workflow, '{qualityReturnRequestedAt}', to_jsonb(now_iso));
    reception_workflow := jsonb_set(reception_workflow, '{qualityReturnReason}', to_jsonb(clean_reason));
  elsif clean_status = 'rework' then
    reception_workflow := jsonb_set(reception_workflow, '{qualityReworkStartedAt}', to_jsonb(now_iso));
    reception_workflow := jsonb_set(
      reception_workflow,
      '{qualityReturnReason}',
      to_jsonb(coalesce(nullif(clean_reason, ''), reception_workflow->>'qualityReturnReason', ''))
    );
    flags := jsonb_set(flags, '{workCompleted}', 'false'::jsonb);
    flags := jsonb_set(flags, '{workStarted}', 'true'::jsonb);
    if nullif(reception_workflow->>'sentToWorkshopAt', '') is null then
      reception_workflow := jsonb_set(reception_workflow, '{sentToWorkshopAt}', to_jsonb(now_iso));
    end if;
  end if;

  -- Injection des sous-objets mis à jour dans le payload canonique (tous les autres champs non-QC restent intacts)
  current_payload := current_payload
    - 'qualityStatus'
    - 'qualityReviewedAt'
    - 'qualityReviewHistory'
    - 'readyForDeliveryAt'
    - 'qualityRevalidatedAt'
    - 'qualityReturnRequestedAt'
    - 'qualityReturnReason'
    - 'qualityReworkStartedAt'
    - 'sentToWorkshopAt';
  current_payload := jsonb_set(current_payload, '{flags}', flags);
  current_payload := jsonb_set(current_payload, '{receptionWorkflow}', reception_workflow);

  -- 8. Incrément de version serveur canonique
  new_version := nextval('public.nimr_sync_entity_version_seq');

  update public.sync_entities
  set payload = current_payload,
      entity_version = new_version,
      last_operation_id = op_id,
      updated_at = now_value
  where workshop_id = p_workshop_id
    and entity_type = 'case'
    and entity_id = p_case_id
  returning * into applied;

  -- 9. Enregistrement du reçu d'opération
  insert into public.sync_entity_operation_receipts (
    workshop_id,
    local_operation_id,
    entity_type,
    entity_id,
    accepted_version,
    accepted_at
  ) values (
    p_workshop_id,
    op_id,
    'case',
    p_case_id,
    new_version,
    now_value
  );

  return jsonb_build_object(
    'status', 'applied',
    'accepted', true,
    'idempotent', false,
    'conflict', false,
    'accepted_version', new_version,
    'server_version', new_version,
    'canonical', to_jsonb(applied)
  );
end;
$nimr$;

revoke all on function public.nimr_apply_quality_review_v1(uuid, text, text, text, text) from public, anon;
grant execute on function public.nimr_apply_quality_review_v1(uuid, text, text, text, text) to authenticated;

commit;
