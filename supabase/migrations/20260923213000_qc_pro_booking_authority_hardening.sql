-- QC-PRO-001D3.22 — QC BOOKING AUTHORITY HARDENING
-- Restricts booking creation/mutation for key='quality'.
-- Enforces separation of powers: executor cannot self-assign quality authority.
-- Injects verified server authority into the booking payload.
-- Hardens nimr_apply_quality_review_v3 with defense-in-depth server authority checks.

begin;

-- ============================================================================
-- 1. TRIGGER FUNCTION: nimr_guard_quality_booking_authority
-- ============================================================================

create or replace function public.nimr_guard_quality_booking_authority()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  caller_id uuid := auth.uid();
  caller_role text;
  old_payload jsonb := case when tg_op = 'UPDATE' then coalesce(old.payload, '{}'::jsonb) else '{}'::jsonb end;
  new_payload jsonb := coalesce(new.payload, '{}'::jsonb);
  old_key text := trim(coalesce(old_payload->>'key', ''));
  new_key text := trim(coalesce(new_payload->>'key', ''));
  target_mode text;
  target_resource_local text;
  target_resource_id uuid;
  target_member_role text;
  caller_resource_id uuid;
  is_qc boolean := false;
begin
  -- Only monitor bookings
  if new.entity_type <> 'booking' then
    return new;
  end if;

  if new_key = 'quality' or (tg_op = 'UPDATE' and old_key = 'quality') then
    is_qc := true;
  end if;

  if not is_qc then
    return new;
  end if;

  -- 1. Soft-delete of an existing QC booking
  if new.deleted_at is not null then
    caller_role := public.nimr_current_workshop_role(new.workshop_id);
    if caller_role not in ('admin_technique', 'directeur', 'chef_atelier') then
      raise exception 'quality booking deletion access denied' using errcode = '42501';
    end if;
    return new;
  end if;

  -- 2. Prevent converting an existing QC booking into another task key to bypass or erase QC
  if tg_op = 'UPDATE' and old_key = 'quality' and new_key <> 'quality' then
    caller_role := public.nimr_current_workshop_role(new.workshop_id);
    if caller_role not in ('admin_technique', 'directeur') then
      raise exception 'cannot convert quality booking to non-quality task' using errcode = '42501';
    end if;
    return new;
  end if;

  -- 3. Verify caller role authorized to plan/modify QC
  caller_role := public.nimr_current_workshop_role(new.workshop_id);
  if caller_role not in ('admin_technique', 'directeur', 'chef_atelier') then
    raise exception 'quality booking assignment access denied' using errcode = '42501';
  end if;

  target_mode := trim(coalesce(new_payload->>'qualityAssignmentMode', ''));
  target_resource_local := trim(coalesce(new_payload->>'primaryResourceId', ''));

  if target_mode not in ('quality_controller', 'chief_fallback') then
    raise exception 'invalid quality assignment mode: %', target_mode using errcode = '22023';
  end if;

  if target_resource_local = '' then
    raise exception 'quality primary resource required' using errcode = '22023';
  end if;

  -- 4. Target resource must be an active control resource linked to a member
  select pr.id, wm.role into target_resource_id, target_member_role
  from public.planning_resources pr
  join public.workshop_members wm on wm.resource_id = pr.id
  where pr.workshop_id = new.workshop_id
    and pr.local_id = target_resource_local
    and pr.type = 'controle'
    and pr.active = true
    and pr.deleted_at is null
    and wm.workshop_id = new.workshop_id
    and wm.deleted_at is null
  limit 1;

  if target_resource_id is null then
    raise exception 'target quality resource is not an active control resource linked to a member'
      using errcode = '23514';
  end if;

  -- 5. Role & separation of powers checks
  if target_mode = 'quality_controller' then
    if target_member_role <> 'controle_qualite' then
      raise exception 'quality_controller mode requires a member with role controle_qualite'
        using errcode = '23514';
    end if;

  elsif target_mode = 'chief_fallback' then
    if target_member_role <> 'chef_atelier' then
      raise exception 'chief_fallback mode requires a member with role chef_atelier'
        using errcode = '23514';
    end if;

    -- A Chef Atelier CANNOT self-assign chief_fallback
    if caller_role = 'chef_atelier' then
      caller_resource_id := public.nimr_current_resource_id(new.workshop_id);
      if caller_resource_id = target_resource_id then
        raise exception 'chef atelier cannot self-assign quality fallback' using errcode = '42501';
      end if;
      raise exception 'chief fallback requires administrative authorization' using errcode = '42501';
    end if;

    -- Only admin_technique or directeur can authorize a chief_fallback
    if caller_role not in ('admin_technique', 'directeur') then
      raise exception 'chief fallback requires administrative authorization' using errcode = '42501';
    end if;
  end if;

  -- 6. Stamp verified server authority provenance into the booking payload
  new.payload := jsonb_set(
    new_payload,
    '{serverAuthority}',
    jsonb_build_object(
      'mode', target_mode,
      'authorizedBy', caller_id,
      'authorizedRole', caller_role,
      'authorizedAt', clock_timestamp(),
      'targetResourceId', target_resource_local,
      'workshopId', new.workshop_id,
      'caseId', new_payload->>'caseId'
    )
  );

  return new;
end;
$fn$;

revoke all on function public.nimr_guard_quality_booking_authority() from public, anon, authenticated;

drop trigger if exists nimr_05_quality_booking_authority on public.sync_entities;
create trigger nimr_05_quality_booking_authority
before insert or update on public.sync_entities
for each row execute function public.nimr_guard_quality_booking_authority();


-- ============================================================================
-- 2. HARDENED nimr_internal.nimr_apply_quality_review_v3
-- ============================================================================

create or replace function nimr_internal.nimr_apply_quality_review_v3(
  p_workshop_id uuid,
  p_case_id text,
  p_quality_status text,
  p_reason text,
  p_operation_id text,
  p_checklist jsonb default '{}'::jsonb,
  p_rework_step_key text default null,
  p_base_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  current_row public.sync_entities;
  applied public.sync_entities;
  accepted_receipt public.sync_entity_operation_receipts;
  rework_row public.sync_entities;
  quality_booking public.sync_entities;
  current_payload jsonb;
  reception_workflow jsonb;
  flags jsonb;
  history jsonb;
  checklist jsonb;
  durations jsonb;
  quality_control jsonb;
  expected_keys text[];
  all_known_keys text[];
  input_key text;
  input_value text;
  normalized_value text;
  context_text text;
  actor_role text;
  current_resource_id uuid;
  current_resource_local_id text;
  clean_status text := lower(trim(coalesce(p_quality_status,'')));
  clean_reason text := trim(coalesce(p_reason,''));
  clean_step text := trim(coalesce(p_rework_step_key,''));
  now_value timestamptz := clock_timestamp();
  now_iso text;
  op_id text;
  new_version bigint;
  rework_version bigint;
  rework_id text;
  rework_role text;
  rework_title text;
  previous_status text;
  rework_cycle integer;
  rework_booking_id text;
  finalization_issue text;
  booking_authority jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  if p_workshop_id is null
     or nullif(trim(p_case_id),'') is null
     or nullif(trim(p_operation_id),'') is null then
    raise exception 'workshop_id, case_id and operation_id are required'
      using errcode='22023';
  end if;

  actor_role :=
    public.nimr_current_workshop_role(p_workshop_id);

  if actor_role not in ('controle_qualite','chef_atelier') then
    raise exception 'quality review access denied'
      using errcode='42501';
  end if;

  current_resource_id :=
    public.nimr_current_resource_id(p_workshop_id);

  if current_resource_id is null then
    raise exception 'quality execution resource required'
      using errcode='42501';
  end if;

  select pr.local_id
  into current_resource_local_id
  from public.planning_resources as pr
  where pr.workshop_id=p_workshop_id
    and pr.id=current_resource_id
    and pr.active=true
    and pr.deleted_at is null
    and pr.type='controle'
    and nullif(trim(coalesce(pr.local_id,'')),'') is not null
  limit 1;

  if nullif(trim(coalesce(current_resource_local_id,'')),'') is null then
    raise exception 'quality execution resource required'
      using errcode='42501';
  end if;

  if clean_status not in ('validated','rejected') then
    raise exception 'invalid quality status: %', p_quality_status using errcode='22023';
  end if;

  op_id := 'quality-review-v3:' || trim(p_operation_id);

  select * into accepted_receipt
  from public.sync_entity_operation_receipts
  where workshop_id=p_workshop_id
    and local_operation_id=op_id;

  if found then
    if accepted_receipt.entity_type is distinct from 'case'
       or accepted_receipt.entity_id is distinct from p_case_id then
      raise exception 'quality review receipt target mismatch' using errcode='22023';
    end if;

    select * into current_row
    from public.sync_entities
    where workshop_id=p_workshop_id
      and entity_type='case'
      and entity_id=p_case_id;

    rework_booking_id := current_row.payload #>> '{receptionWorkflow,qualityReworkBookingId}';
    if nullif(rework_booking_id,'') is not null then
      select * into rework_row
      from public.sync_entities
      where workshop_id=p_workshop_id
        and entity_type='booking'
        and entity_id=rework_booking_id;
    end if;

    return jsonb_build_object(
      'status','idempotent',
      'accepted',true,
      'idempotent',true,
      'conflict',false,
      'accepted_version',accepted_receipt.accepted_version,
      'server_version',current_row.entity_version,
      'canonical',to_jsonb(current_row),
      'rework_canonical',case when rework_row.entity_id is null then null else to_jsonb(rework_row) end
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_workshop_id::text || ':case:' || p_case_id,0)
  );

  select * into current_row
  from public.sync_entities
  where workshop_id=p_workshop_id
    and entity_type='case'
    and entity_id=p_case_id
  for update;

  if not found or current_row.deleted_at is not null then
    raise exception 'Dossier absent ou supprimé.' using errcode='P0002';
  end if;

  if p_base_version is not null
     and current_row.entity_version is distinct from p_base_version then
    return jsonb_build_object(
      'status','conflict',
      'accepted',false,
      'conflict',true,
      'base_version',p_base_version,
      'server_version',current_row.entity_version,
      'canonical',to_jsonb(current_row),
      'conflict_canonical',to_jsonb(current_row),
      'conflict_server_version',current_row.entity_version,
      'server_payload',current_row.payload,
      'detected_at',clock_timestamp()
    );
  end if;

  select * into accepted_receipt
  from public.sync_entity_operation_receipts
  where workshop_id=p_workshop_id
    and local_operation_id=op_id;

  if found then
    return jsonb_build_object(
      'status','idempotent',
      'accepted',true,
      'idempotent',true,
      'conflict',false,
      'accepted_version',accepted_receipt.accepted_version,
      'server_version',current_row.entity_version,
      'canonical',to_jsonb(current_row)
    );
  end if;

  current_payload := coalesce(current_row.payload,'{}'::jsonb);
  reception_workflow := coalesce(current_payload->'receptionWorkflow','{}'::jsonb);
  flags := coalesce(current_payload->'flags','{}'::jsonb);

  -- ==========================================================
  -- QC-PRO-001D3 - ASSIGNED EXECUTOR AUTHORITY
  -- ==========================================================

  select *
  into quality_booking
  from public.sync_entities
  where workshop_id=p_workshop_id
    and entity_type='booking'
    and deleted_at is null
    and payload->>'caseId'=p_case_id
    and payload->>'key'='quality'
  order by entity_version desc
  limit 1;

  if quality_booking.entity_id is null then
    raise exception 'quality booking required'
      using errcode='23514';
  end if;

  if trim(coalesce(
       quality_booking.payload->>'primaryResourceId',
       ''
     )) is distinct from current_resource_local_id then
    raise exception 'quality resource assignment mismatch'
      using errcode='42501';
  end if;

  if actor_role='controle_qualite'
     and trim(coalesce(
       quality_booking.payload->>'qualityAssignmentMode',
       ''
     )) <> 'quality_controller' then
    raise exception 'quality assignment denied'
      using errcode='42501';
  end if;

  if actor_role='chef_atelier'
     and trim(coalesce(
       quality_booking.payload->>'qualityAssignmentMode',
       ''
     )) <> 'chief_fallback' then
    raise exception 'quality fallback denied'
      using errcode='42501';
  end if;

  -- ==========================================================
  -- QC-PRO-001D3.22 - DEFENSE IN DEPTH: SERVER PROVENANCE CHECK
  -- ==========================================================

  booking_authority := quality_booking.payload->'serverAuthority';
  if booking_authority is null
     or nullif(trim(coalesce(booking_authority->>'mode','')),'') is null
     or trim(coalesce(booking_authority->>'mode','')) is distinct from trim(coalesce(quality_booking.payload->>'qualityAssignmentMode',''))
     or trim(coalesce(booking_authority->>'targetResourceId','')) is distinct from current_resource_local_id
     or trim(coalesce(booking_authority->>'caseId','')) is distinct from p_case_id
     or nullif(trim(coalesce(booking_authority->>'authorizedBy','')),'') is null
  then
    raise exception 'quality booking lacks verified server authority'
      using errcode='42501';
  end if;

  if actor_role = 'chef_atelier' then
    if trim(coalesce(booking_authority->>'authorizedBy','')) = auth.uid()::text then
      raise exception 'chef atelier cannot self-assign quality fallback'
        using errcode='42501';
    end if;

    if trim(coalesce(booking_authority->>'authorizedRole','')) not in ('admin_technique', 'directeur') then
      raise exception 'chief fallback requires administrative authorization'
        using errcode='42501';
    end if;
  end if;

  -- ==========================================================
  -- QC-PRO-001D2 - DYNAMIC CHECKLIST DERIVATION & VALIDATION
  -- ==========================================================

  if flags->>'delivered' = 'true' or nullif(current_payload->>'archivedAt','') is not null then
    raise exception 'Le dossier livré ou archivé ne peut plus recevoir une décision qualité.' using errcode='23514';
  end if;

  if flags->>'workCompleted' is distinct from 'true' then
    raise exception 'Terminer les travaux avant le contrôle qualité.' using errcode='23514';
  end if;

  durations := coalesce(current_payload->'durations','{}'::jsonb);
  quality_control := coalesce(current_payload->'qualityControl','{}'::jsonb);
  context_text := lower(concat_ws(' ',
    coalesce(current_payload->>'orderType',''),
    coalesce(current_payload->>'type',''),
    coalesce(current_payload->>'visitReason',''),
    coalesce(current_payload->>'arrivalNotes',''),
    coalesce(current_payload->>'damageNotes','')
  ));

  expected_keys := array[
    'documentary.work_order_complete',
    'documentary.authorizations_present',
    'documentary.operations_recorded',
    'documentary.technician_notes_complete',
    'general.no_warning_lights',
    'general.no_leak',
    'general.reassembly_secure',
    'general.repaired_functions_verified',
    'general.no_tools_left'
  ];

  if coalesce(nullif(durations->>'oilService','')::numeric,0) > 0 then
    expected_keys := array_cat(expected_keys, array[
      'service.oil_level',
      'service.filter_correct',
      'service.drain_plug_secure',
      'service.no_leak',
      'service.maintenance_reset',
      'service.tyre_pressure'
    ]);
  end if;

  if coalesce(nullif(durations->>'mechanical','')::numeric,0) > 0 then
    expected_keys := array_cat(expected_keys, array[
      'mechanical.repair_function',
      'mechanical.fasteners',
      'mechanical.no_leak',
      'mechanical.noise_vibration',
      'mechanical.temperature_pressure'
    ]);
  end if;

  if coalesce(nullif(durations->>'electrical','')::numeric,0) > 0
     or position('diagnostic' in context_text) > 0
     or position('élect' in context_text) > 0
     or position('elect' in context_text) > 0 then
    expected_keys := array_cat(expected_keys, array[
      'electrical.final_scan',
      'electrical.no_relevant_dtc',
      'electrical.repaired_function',
      'electrical.charging_12v',
      'electrical.connectors_secure',
      'electrical.calibration_complete'
    ]);
  end if;

  if coalesce(nullif(durations->>'body','')::numeric,0) > 0
     or coalesce(nullif(durations->>'prep','')::numeric,0) > 0
     or coalesce(nullif(durations->>'paint','')::numeric,0) > 0
     or coalesce(nullif(durations->>'reassembly','')::numeric,0) > 0
     or coalesce(nullif(durations->>'finish','')::numeric,0) > 0 then
    expected_keys := array_cat(expected_keys, array[
      'body.panel_alignment',
      'body.paint_finish',
      'body.reassembly',
      'body.openings_function',
      'body.sensors_lighting',
      'body.final_photo'
    ]);
  end if;

  if quality_control->'highVoltage' = 'true'::jsonb then
    expected_keys := array_cat(expected_keys, array[
      'hv.no_relevant_fault',
      'hv.protection_connectors',
      'hv.function_verified',
      'hv.charging_verified'
    ]);
  end if;

  if quality_control->'criticalSafety' = 'true'::jsonb then
    expected_keys := array_cat(expected_keys, array[
      'safety.braking_function',
      'safety.steering_function',
      'safety.wheel_fasteners',
      'safety.no_safety_warning'
    ]);
  end if;

  if quality_control->'roadTestRequired' = 'true'::jsonb then
    expected_keys := array_cat(expected_keys, array[
      'road.complaint_resolved',
      'road.braking_steering',
      'road.transmission_engine',
      'road.no_abnormal_noise_vibration',
      'road.no_warning_lights',
      'road.mileage_recorded'
    ]);
  end if;

  expected_keys := array_cat(expected_keys, array[
    'delivery.clean_vehicle',
    'delivery.no_new_damage',
    'delivery.protections_removed',
    'delivery.client_items_present',
    'delivery.documents_ready'
  ]);

  -- Canonical keys/applicability mirror getProfessionalQualityChecklistDefinition.
  -- Legacy oil_label, fluids_level, no_fault_codes and faults_cleared are not
  -- aliases: labels/fluids/DTC clearing do not prove the current UI checks.
  -- Existing history is retained verbatim; only new decisions use this contract.
  all_known_keys := array[
    'documentary.work_order_complete','documentary.authorizations_present','documentary.operations_recorded','documentary.technician_notes_complete',
    'general.no_warning_lights','general.no_leak','general.reassembly_secure','general.repaired_functions_verified','general.no_tools_left',
    'service.oil_level','service.filter_correct','service.drain_plug_secure','service.no_leak','service.maintenance_reset','service.tyre_pressure',
    'mechanical.repair_function','mechanical.fasteners','mechanical.no_leak','mechanical.noise_vibration','mechanical.temperature_pressure',
    'electrical.final_scan','electrical.no_relevant_dtc','electrical.repaired_function','electrical.charging_12v','electrical.connectors_secure','electrical.calibration_complete',
    'body.panel_alignment','body.paint_finish','body.reassembly','body.openings_function','body.sensors_lighting','body.final_photo',
    'hv.no_relevant_fault','hv.protection_connectors','hv.function_verified','hv.charging_verified',
    'safety.braking_function','safety.steering_function','safety.wheel_fasteners','safety.no_safety_warning',
    'road.complaint_resolved','road.braking_steering','road.transmission_engine','road.no_abnormal_noise_vibration','road.no_warning_lights','road.mileage_recorded',
    'delivery.clean_vehicle','delivery.no_new_damage','delivery.protections_removed','delivery.client_items_present','delivery.documents_ready'
  ];

  checklist := '{}'::jsonb;

  if p_checklist is not null and jsonb_typeof(p_checklist) = 'object' then
    for input_key, input_value in
      select key, value::text
      from jsonb_each_text(p_checklist)
    loop
      if not (input_key = any(all_known_keys)) then
        raise exception 'unknown quality checklist key: %', input_key using errcode='22023';
      end if;

      normalized_value := lower(trim(coalesce(input_value,'')));
      if normalized_value in ('true','ok','conforme','pass') then
        normalized_value := 'ok';
      elsif normalized_value in ('na','n/a','not_applicable','non_applicable','non applicable') then
        normalized_value := 'na';
      elsif normalized_value in ('false','nok','ko','non_conforme','non conforme','fail') then
        normalized_value := 'nok';
      elsif normalized_value in ('','null') then
        normalized_value := null;
      else
        raise exception 'invalid checklist value for key %: %', input_key, input_value using errcode='22023';
      end if;

      if normalized_value is not null then
        checklist := jsonb_set(checklist, array[input_key], to_jsonb(normalized_value), true);
      end if;
    end loop;
  end if;

  if clean_status = 'validated' then
    foreach input_key in array expected_keys
    loop
      normalized_value := checklist->>input_key;
      if normalized_value is null or normalized_value not in ('ok','na') then
        raise exception 'checklist incomplete for validation: key % requires ok or na', input_key
          using errcode='23514';
      end if;
    end loop;

    for input_key, input_value in
      select key, value::text
      from jsonb_each_text(checklist)
    loop
      if input_value = 'nok' then
        raise exception 'cannot validate quality review when non-conformities are present'
          using errcode='23514';
      end if;
    end loop;
  end if;

  if clean_status = 'rejected' then
    if clean_reason = '' then
      raise exception 'Le motif de rejet qualité est obligatoire.' using errcode='23514';
    end if;

    if not exists (
      select 1
      from jsonb_each_text(checklist)
      where value = 'nok'
    ) then
      raise exception 'rejection requires at least one non-conforming (nok) checklist item'
        using errcode='23514';
    end if;

    if clean_step = '' then
      clean_step := 'body';
    end if;
  end if;

  now_iso := to_char(now_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  new_version := nextval('public.nimr_sync_entity_version_seq'::regclass);
  previous_status := coalesce(reception_workflow->>'qualityStatus','not_started');
  history := case
    when jsonb_typeof(reception_workflow->'qualityReviewHistory')='array'
      then reception_workflow->'qualityReviewHistory'
    else '[]'::jsonb
  end;

  history := history || jsonb_build_array(jsonb_build_object(
    'at', now_iso,
    'by', actor_role,
    'executorId', auth.uid()::text,
    'authority', booking_authority,
    'qualityBookingId', quality_booking.entity_id,
    'photos', coalesce(current_payload->'photos', '[]'::jsonb),
    'qualityControl', quality_control,
    'resourceId', current_resource_local_id,
    'status', clean_status,
    'reason', clean_reason,
    'operationId', trim(p_operation_id),
    'previousStatus', previous_status,
    'checklist', checklist,
    'reworkStepKey', case when clean_status='rejected' then clean_step else null end
  ));

  if clean_status = 'validated' then
    -- Restore the completed-rework precondition from the preceding QC authority.
    rework_booking_id := reception_workflow->>'qualityReworkBookingId';
    if previous_status in ('rejected','rework') or nullif(rework_booking_id,'') is not null then
      if nullif(rework_booking_id,'') is null then
        raise exception 'Une retouche atelier documentée est obligatoire avant revalidation.' using errcode='23514';
      end if;
      select * into rework_row
      from public.sync_entities
      where workshop_id=p_workshop_id
        and entity_type='booking'
        and entity_id=rework_booking_id
        and payload->>'caseId'=p_case_id
        and deleted_at is null
      for update;
      if rework_row.entity_id is null
         or coalesce(rework_row.payload->>'status','planned') not in ('completed','done') then
        raise exception 'Terminer la retouche QC avant la revalidation.' using errcode='23514';
      end if;
      reception_workflow := jsonb_set(reception_workflow, '{qualityReworkCompletedAt}',
        to_jsonb(coalesce(rework_row.payload->>'completedAt', rework_row.payload->>'actualEnd', now_iso)), true);
    end if;
    flags := jsonb_set(flags, '{qualityApproved}', 'true'::jsonb, true);
    flags := jsonb_set(flags, '{qualityRejected}', 'false'::jsonb, true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityStatus}', to_jsonb('validated'::text), true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReviewedAt}', to_jsonb(now_iso), true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReviewHistory}', history, true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReturnReason}', 'null'::jsonb, true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReturnRequestedAt}', 'null'::jsonb, true);
    reception_workflow := jsonb_set(reception_workflow, '{readyForDeliveryAt}', to_jsonb(now_iso), true);
    if previous_status in ('rework','rejected') then
      reception_workflow := jsonb_set(reception_workflow, '{qualityRevalidatedAt}', to_jsonb(now_iso), true);
    end if;
  else
    rework_cycle := coalesce((reception_workflow->>'qualityReworkCycle')::integer, 0) + 1;
    rework_id := 'booking:rework:' || p_case_id || ':' || rework_cycle::text;
    rework_role := case
      when clean_step in ('prep','paint') then 'peintre'
      when clean_step = 'electrical' then 'electricien'
      when clean_step in ('mechanical','service') then 'mecanicien'
      else 'tolier'
    end;
    rework_title := 'Retouche QC cycle ' || rework_cycle::text || ' (' || clean_step || ')';

    -- Keep the rejected decision, then append the distinct corrective operation.
    history := history || jsonb_build_array(jsonb_build_object(
      'at', now_iso,
      'by', actor_role,
      'executorId', auth.uid()::text,
      'status', 'rework',
      'reason', clean_reason,
      'operationId', trim(p_operation_id),
      'reworkBookingId', rework_id,
      'reworkStepKey', clean_step,
      'reworkCycle', rework_cycle
    ));

    flags := jsonb_set(flags, '{qualityApproved}', 'false'::jsonb, true);
    flags := jsonb_set(flags, '{qualityRejected}', 'true'::jsonb, true);
    flags := jsonb_set(flags, '{workCompleted}', 'false'::jsonb, true);

    reception_workflow := jsonb_set(reception_workflow, '{qualityStatus}', to_jsonb('rejected'::text), true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReviewedAt}', to_jsonb(now_iso), true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReviewHistory}', history, true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReturnReason}', to_jsonb(clean_reason), true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReturnRequestedAt}', to_jsonb(now_iso), true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReworkRequestedAt}', to_jsonb(now_iso), true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReworkStepKey}', to_jsonb(clean_step), true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReworkBookingId}', to_jsonb(rework_id), true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReworkCycle}', to_jsonb(rework_cycle), true);
    reception_workflow := jsonb_set(reception_workflow, '{qualityReworkCompletedAt}', 'null'::jsonb, true);
    reception_workflow := jsonb_set(reception_workflow, '{readyForDeliveryAt}', 'null'::jsonb, true);

    rework_version := nextval('public.nimr_sync_entity_version_seq'::regclass);
    insert into public.sync_entities (
      workshop_id, entity_type, entity_id, payload, entity_version,
      last_operation_id, deleted_at, updated_at
    ) values (
      p_workshop_id, 'booking', rework_id,
      jsonb_build_object(
        'id', rework_id,
        'caseId', p_case_id,
        'key', clean_step,
        'title', rework_title,
        'requiredRole', rework_role,
        'status', 'planned',
        'isRework', true,
        'reworkCycle', rework_cycle,
        'reworkReason', clean_reason,
        'createdAt', now_iso,
        'updatedAt', now_iso
      ),
      rework_version,
      op_id || ':rework:' || rework_cycle::text,
      null,
      now_value
    )
    on conflict (workshop_id, entity_type, entity_id) do update
      set payload = excluded.payload,
          entity_version = excluded.entity_version,
          last_operation_id = excluded.last_operation_id,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at
    returning * into rework_row;

    insert into public.sync_entity_operation_receipts (
      workshop_id, local_operation_id, entity_type, entity_id, accepted_version
    ) values (
      p_workshop_id, op_id || ':rework:' || rework_cycle::text,
      'booking', rework_id, rework_version
    );
  end if;

  current_payload := jsonb_set(current_payload, '{flags}', flags, true);
  current_payload := jsonb_set(current_payload, '{receptionWorkflow}', reception_workflow, true);
  current_payload := jsonb_set(current_payload, '{qualityChecklist}', checklist, true);
  current_payload := jsonb_set(current_payload, '{updatedAt}', to_jsonb(now_iso), true);

  -- NOK deliberately reopens work. Only a successful QC can finalize it.
  if clean_status = 'validated' then
    finalization_issue := public.nimr_finalization_issue(current_payload, false);
    if finalization_issue is not null then
      raise exception '%', finalization_issue using errcode='23514';
    end if;
  end if;

  set local "nimr.quality_review_v3" = 'on';

  update public.sync_entities
  set payload = current_payload,
      entity_version = new_version,
      last_operation_id = op_id,
      deleted_at = null,
      updated_at = now_value
  where workshop_id = p_workshop_id
    and entity_type = 'case'
    and entity_id = p_case_id
  returning * into applied;

  insert into public.sync_entity_operation_receipts (
    workshop_id, local_operation_id, entity_type, entity_id, accepted_version
  ) values (
    p_workshop_id, op_id, 'case', p_case_id, new_version
  );

  return jsonb_build_object(
    'status','accepted',
    'accepted',true,
    'idempotent',false,
    'conflict',false,
    'accepted_version',new_version,
    'server_version',new_version,
    'canonical',to_jsonb(applied),
    'rework_canonical',case when rework_row.entity_id is null then null else to_jsonb(rework_row) end
  );
end;
$function$;

revoke all on function nimr_internal.nimr_apply_quality_review_v3(
  uuid,text,text,text,text,jsonb,text,bigint
) from public, anon, authenticated;

-- Fail-closed revocation on legacy internal overload (p_decision, p_rework_key)
revoke all on function nimr_internal.nimr_apply_quality_review_v3(
  uuid,text,text,text,jsonb,text,text,bigint
) from public, anon, authenticated;

create or replace function public.nimr_apply_quality_review_v3(
  p_workshop_id uuid,
  p_case_id text,
  p_quality_status text,
  p_reason text,
  p_operation_id text,
  p_checklist jsonb default '{}'::jsonb,
  p_rework_step_key text default null,
  p_base_version bigint default null
)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','public'
as $function$
  select nimr_internal.nimr_apply_quality_review_v3(
    p_workshop_id,
    p_case_id,
    p_quality_status,
    p_reason,
    p_operation_id,
    p_checklist,
    p_rework_step_key,
    p_base_version
  )
$function$;

-- Hardening: revoke all execution on legacy public wrapper (p_decision, p_rework_key)
-- Prevents authenticated users from bypassing QC-PRO verified server authority via the legacy overload.
revoke all on function public.nimr_apply_quality_review_v3(
  uuid,text,text,text,jsonb,text,text,bigint
) from public, anon, authenticated;

revoke all on function public.nimr_apply_quality_review_v3(
  uuid,text,text,text,text,jsonb,text,bigint
) from public, anon;

grant execute on function public.nimr_apply_quality_review_v3(
  uuid,text,text,text,text,jsonb,text,bigint
) to authenticated;

comment on function public.nimr_guard_quality_booking_authority() is
  'QC-PRO-001D3.22: authoritative server guard on sync_entities for QC bookings; enforces separation of powers and injects verified server authority.';

comment on function public.nimr_apply_quality_review_v3(
  uuid,text,text,text,text,jsonb,text,bigint
) is
  'QC-PRO-001D3.22: authoritative professional QC review with dynamic checklist, verified server authority, optimistic concurrency, and idempotency.';

commit;
