-- QC-PRO-001D2 - Professional dynamic QC server authority
-- CREATE OR REPLACE keeps the public v3 API used by the deployed client.
-- Replaces the historical five-line bodywork checklist authority with
-- a server-derived checklist based on the canonical case payload.

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

  -- QC-PRO-001D2:
  -- Checklist validation is intentionally deferred until the canonical
  -- case row has been locked and loaded. Applicable QC points must be
  -- derived from canonical server state, never trusted from the client.

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
  -- QC-PRO-001D2 — SERVER-DERIVED PROFESSIONAL CHECKLIST
  -- ==========================================================

  durations := coalesce(current_payload->'durations','{}'::jsonb);
  quality_control := coalesce(current_payload->'qualityControl','{}'::jsonb);

  context_text := lower(concat_ws(
    ' ',
    coalesce(current_payload->>'orderType',''),
    coalesce(current_payload->>'type',''),
    coalesce(current_payload->>'visitReason',''),
    coalesce(current_payload->>'arrivalNotes',''),
    coalesce(current_payload->>'damageNotes','')
  ));

  -- Full server whitelist. The client may never invent QC fields.
  all_known_keys := ARRAY[
    'documentary.work_order_complete',
    'documentary.authorizations_present',
    'documentary.operations_recorded',
    'documentary.technician_notes_complete',

    'general.no_warning_lights',
    'general.no_leak',
    'general.reassembly_secure',
    'general.repaired_functions_verified',
    'general.no_tools_left',

    'service.oil_level',
    'service.filter_correct',
    'service.drain_plug_secure',
    'service.no_leak',
    'service.maintenance_reset',
    'service.tyre_pressure',

    'mechanical.repair_function',
    'mechanical.fasteners',
    'mechanical.no_leak',
    'mechanical.noise_vibration',
    'mechanical.temperature_pressure',

    'electrical.final_scan',
    'electrical.no_relevant_dtc',
    'electrical.repaired_function',
    'electrical.charging_12v',
    'electrical.connectors_secure',
    'electrical.calibration_complete',

    'body.panel_alignment',
    'body.paint_finish',
    'body.reassembly',
    'body.openings_function',
    'body.sensors_lighting',
    'body.final_photo',

    'hv.no_relevant_fault',
    'hv.protection_connectors',
    'hv.function_verified',
    'hv.charging_verified',

    'safety.braking_function',
    'safety.steering_function',
    'safety.wheel_fasteners',
    'safety.no_safety_warning',

    'road.complaint_resolved',
    'road.braking_steering',
    'road.transmission_engine',
    'road.no_abnormal_noise_vibration',
    'road.no_warning_lights',
    'road.mileage_recorded',

    'delivery.clean_vehicle',
    'delivery.no_new_damage',
    'delivery.protections_removed',
    'delivery.client_items_present',
    'delivery.documents_ready'
  ]::text[];

  -- Permanent professional QC foundation.
  expected_keys := ARRAY[
    'documentary.work_order_complete',
    'documentary.authorizations_present',
    'documentary.operations_recorded',
    'documentary.technician_notes_complete',

    'general.no_warning_lights',
    'general.no_leak',
    'general.reassembly_secure',
    'general.repaired_functions_verified',
    'general.no_tools_left',

    'delivery.clean_vehicle',
    'delivery.no_new_damage',
    'delivery.protections_removed',
    'delivery.client_items_present',
    'delivery.documents_ready'
  ]::text[];

  -- Service rapide / entretien.
  if coalesce(nullif(durations->>'oilService','')::numeric,0) > 0 then
    expected_keys := expected_keys || ARRAY[
      'service.oil_level',
      'service.filter_correct',
      'service.drain_plug_secure',
      'service.no_leak',
      'service.maintenance_reset',
      'service.tyre_pressure'
    ]::text[];
  end if;

  -- Mécanique.
  if coalesce(nullif(durations->>'mechanical','')::numeric,0) > 0 then
    expected_keys := expected_keys || ARRAY[
      'mechanical.repair_function',
      'mechanical.fasteners',
      'mechanical.no_leak',
      'mechanical.noise_vibration',
      'mechanical.temperature_pressure'
    ]::text[];
  end if;

  -- Électricité / diagnostic.
  if coalesce(nullif(durations->>'electrical','')::numeric,0) > 0
     or position('diagnostic' in context_text) > 0
     or position('élect' in context_text) > 0
     or position('elect' in context_text) > 0 then

    expected_keys := expected_keys || ARRAY[
      'electrical.final_scan',
      'electrical.no_relevant_dtc',
      'electrical.repaired_function',
      'electrical.charging_12v',
      'electrical.connectors_secure',
      'electrical.calibration_complete'
    ]::text[];
  end if;

  -- Carrosserie / peinture / remontage / finition.
  if coalesce(nullif(durations->>'body','')::numeric,0) > 0
     or coalesce(nullif(durations->>'prep','')::numeric,0) > 0
     or coalesce(nullif(durations->>'paint','')::numeric,0) > 0
     or coalesce(nullif(durations->>'reassembly','')::numeric,0) > 0
     or coalesce(nullif(durations->>'finish','')::numeric,0) > 0 then

    expected_keys := expected_keys || ARRAY[
      'body.panel_alignment',
      'body.paint_finish',
      'body.reassembly',
      'body.openings_function',
      'body.sensors_lighting',
      'body.final_photo'
    ]::text[];
  end if;

  -- EV / HEV / haute tension.
  if lower(coalesce(quality_control->>'highVoltage','false')) = 'true' then
    expected_keys := expected_keys || ARRAY[
      'hv.no_relevant_fault',
      'hv.protection_connectors',
      'hv.function_verified',
      'hv.charging_verified'
    ]::text[];
  end if;

  -- Organes critiques de s?curit?.
  if lower(coalesce(quality_control->>'criticalSafety','false')) = 'true' then
    expected_keys := expected_keys || ARRAY[
      'safety.braking_function',
      'safety.steering_function',
      'safety.wheel_fasteners',
      'safety.no_safety_warning'
    ]::text[];
  end if;

  -- Essai dynamique structur?.
  if lower(coalesce(quality_control->>'roadTestRequired','false')) = 'true' then
    expected_keys := expected_keys || ARRAY[
      'road.complaint_resolved',
      'road.braking_steering',
      'road.transmission_engine',
      'road.no_abnormal_noise_vibration',
      'road.no_warning_lights',
      'road.mileage_recorded'
    ]::text[];
  end if;

  -- Reject every injected / unknown key.
  for input_key in
    select jsonb_object_keys(coalesce(p_checklist,'{}'::jsonb))
  loop
    if not (input_key = any(all_known_keys)) then
      raise exception 'unknown quality checklist key: %', input_key
        using errcode='22023';
    end if;

    if not (input_key = any(expected_keys)) then
      raise exception 'non-applicable quality checklist key: %', input_key
        using errcode='22023';
    end if;
  end loop;

  -- Normalize only the professional tri-state contract.
  checklist := '{}'::jsonb;

  foreach input_key in array expected_keys
  loop
    input_value := lower(trim(coalesce(p_checklist->>input_key,'')));

    normalized_value := case input_value
      when '' then ''
      when 'ok' then 'ok'
      when 'na' then 'na'
      when 'nok' then 'nok'
      else null
    end;

    if normalized_value is null then
      raise exception
        'invalid quality checklist value for %: %',
        input_key,
        input_value
        using errcode='22023';
    end if;

    checklist := jsonb_set(
      checklist,
      ARRAY[input_key],
      to_jsonb(normalized_value),
      true
    );
  end loop;

  -- Conforme = every applicable point completed OK or N/A.
  if clean_status='validated'
     and exists (
       select 1
       from unnest(expected_keys) as required_key
       where coalesce(checklist->>required_key,'') not in ('ok','na')
     ) then

    raise exception
      'Chaque point du contrôle qualité professionnel doit être marqué OK ou N/A avant validation.'
      using errcode='22023';
  end if;

  -- Non conforme = reason + NOK + m?tier de retouche.
  if clean_status='rejected' then

    if clean_reason='' then
      raise exception 'rejection reason required'
        using errcode='22023';
    end if;

    if not exists (
      select 1
      from jsonb_each_text(checklist) as c(key,value)
      where c.value='nok'
    ) then
      raise exception
        'Au moins un point du contrôle qualité professionnel doit être marqué NOK.'
        using errcode='22023';
    end if;

    if clean_step not in (
      'body',
      'oilService',
      'mechanical',
      'prep',
      'paint',
      'electrical',
      'reassembly',
      'finish'
    ) then
      raise exception 'rework step required'
        using errcode='22023';
    end if;
  end if;

  previous_status := lower(trim(coalesce(reception_workflow->>'qualityStatus','not_started')));
  now_iso := to_char(now_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  if coalesce(flags->>'delivered','false')='true'
     or nullif(current_payload->>'archivedAt','') is not null then
    raise exception 'Le dossier livré ou archivé ne peut plus recevoir une décision qualité.'
      using errcode='23514';
  end if;

  if coalesce(flags->>'workCompleted','false') <> 'true' then
    raise exception 'Terminer les travaux avant le contrôle qualité.'
      using errcode='23514';
  end if;

  history := case
    when jsonb_typeof(reception_workflow->'qualityReviewHistory')='array'
      then reception_workflow->'qualityReviewHistory'
    else '[]'::jsonb
  end;

  if clean_status='validated' then
    finalization_issue := public.nimr_finalization_issue(current_payload,false);
    if finalization_issue is not null then
      raise exception '%', finalization_issue using errcode='23514';
    end if;

    rework_booking_id := reception_workflow->>'qualityReworkBookingId';

    if previous_status in ('rejected','rework')
       or nullif(rework_booking_id,'') is not null then

      if nullif(rework_booking_id,'') is null then
        raise exception 'Une retouche atelier documentée est obligatoire avant revalidation.'
          using errcode='23514';
      end if;

      select * into rework_row
      from public.sync_entities
      where workshop_id=p_workshop_id
        and entity_type='booking'
        and entity_id=rework_booking_id
        and deleted_at is null;

      if rework_row.entity_id is null
         or coalesce(rework_row.payload->>'status','planned') not in ('completed','done') then
        raise exception 'Terminer la retouche QC avant la revalidation.'
          using errcode='23514';
      end if;

      reception_workflow := jsonb_set(
        reception_workflow,'{qualityRevalidatedAt}',to_jsonb(now_iso)
      );

      reception_workflow := jsonb_set(
        reception_workflow,
        '{qualityReworkCompletedAt}',
        to_jsonb(coalesce(
          rework_row.payload->>'completedAt',
          rework_row.payload->>'actualEnd',
          now_iso
        ))
      );
    end if;

    flags := jsonb_set(flags,'{qualityApproved}','true'::jsonb);
    reception_workflow := jsonb_set(reception_workflow,'{qualityStatus}',to_jsonb('validated'::text));
    reception_workflow := jsonb_set(reception_workflow,'{qualityReviewedAt}',to_jsonb(now_iso));
    reception_workflow := jsonb_set(reception_workflow,'{readyForDeliveryAt}',to_jsonb(now_iso));
    reception_workflow := jsonb_set(reception_workflow,'{qualityChecklist}',checklist);
    current_payload := jsonb_set(current_payload,'{qualityChecklist}',checklist);

    history := history || jsonb_build_array(jsonb_build_object(
      'at',now_iso,
      'by',auth.uid()::text,
      'status','validated',
      'reason',clean_reason,
      'checklist',checklist
    ));

  elsif clean_status='rejected' then
    rework_booking_id := reception_workflow->>'qualityReworkBookingId';

    if nullif(rework_booking_id,'') is not null then
      select * into rework_row
      from public.sync_entities
      where workshop_id=p_workshop_id
        and entity_type='booking'
        and entity_id=rework_booking_id
        and deleted_at is null;

      if rework_row.entity_id is not null
         and coalesce(rework_row.payload->>'status','planned') not in ('completed','done') then
        raise exception 'Une retouche QC est déjà ouverte pour ce dossier.'
          using errcode='23514';
      end if;
    end if;

    case clean_step
      when 'body' then rework_role:='tolier'; rework_title:='Retouche QC — Tôlerie / carrosserie';
      when 'oilService' then rework_role:='mecanicien'; rework_title:='Retouche QC — Entretien / vidange';
      when 'mechanical' then rework_role:='mecanicien'; rework_title:='Retouche QC — Mécanique';
      when 'prep' then rework_role:='peintre'; rework_title:='Retouche QC — Préparation peinture';
      when 'paint' then rework_role:='peintre'; rework_title:='Retouche QC — Peinture / vernis';
      when 'electrical' then rework_role:='electricien'; rework_title:='Retouche QC — Électricité';
      when 'reassembly' then rework_role:='tolier'; rework_title:='Retouche QC — Remontage';
      when 'finish' then rework_role:='peintre'; rework_title:='Retouche QC — Finition / lavage';
    end case;

    rework_cycle := coalesce(
      case
        when coalesce(reception_workflow->>'qualityReworkCycle','') ~ '^[0-9]+$'
          then (reception_workflow->>'qualityReworkCycle')::integer
        else 0
      end,
      0
    ) + 1;

    rework_id := 'booking-qc-' || gen_random_uuid()::text;
    rework_version := nextval('public.nimr_sync_entity_version_seq');

    insert into public.sync_entities(
      workshop_id,entity_type,entity_id,payload,entity_version,last_operation_id,
      deleted_at,created_at,updated_at
    ) values (
      p_workshop_id,
      'booking',
      rework_id,
      jsonb_build_object(
        'id',rework_id,
        'caseId',p_case_id,
        'type','work',
        'key',clean_step,
        'title',rework_title,
        'details','Retouche suite contrôle qualité : ' || clean_reason,
        'taskId',rework_id,
        'businessTaskId',rework_id,
        'taskModelVersion',1,
        'sourceKind','manual',
        'source','quality_rework',
        'sourceClaimIds','[]'::jsonb,
        'sourceLineIds','[]'::jsonb,
        'sourceOperations',jsonb_build_array(rework_title),
        'sourceLaborHours',0,
        'status','unplanned',
        'needsScheduling',true,
        'remainingEstimateRequired',true,
        'resourceIds','[]'::jsonb,
        'primaryResourceId','',
        'equipmentResourceIds','[]'::jsonb,
        'segments','[]'::jsonb,
        'plannedSegments','[]'::jsonb,
        'plannedMinutes',0,
        'remainingMinutes',0,
        'dependencies','[]'::jsonb,
        'parallelizable',false,
        'vehicleExclusive',true,
        'vehicleLocation','internal',
        'requiredRole',rework_role,
        'requiredCategory','',
        'requiredRolesByResource','{}'::jsonb,
        'requiredCategoriesByResource','{}'::jsonb,
        'capacityUnits',1,
        'resourceUnits','{}'::jsonb,
        'serviceMode','internal',
        'planningMode','standard',
        'qualityRework',true,
        'qualityReworkCycle',rework_cycle,
        'qualityRejectReason',clean_reason
      ),
      rework_version,
      op_id || ':rework',
      null,
      now_value,
      now_value
    )
    returning * into rework_row;

    flags := jsonb_set(flags,'{qualityApproved}','false'::jsonb);
    flags := jsonb_set(flags,'{delivered}','false'::jsonb);
    flags := jsonb_set(flags,'{workCompleted}','false'::jsonb);
    flags := jsonb_set(flags,'{workStarted}','true'::jsonb);

    reception_workflow := jsonb_set(reception_workflow,'{qualityStatus}',to_jsonb('rework'::text));
    reception_workflow := jsonb_set(reception_workflow,'{qualityReviewedAt}',to_jsonb(now_iso));
    reception_workflow := jsonb_set(reception_workflow,'{qualityReturnRequestedAt}',to_jsonb(now_iso));
    reception_workflow := jsonb_set(reception_workflow,'{qualityReturnReason}',to_jsonb(clean_reason));
    reception_workflow := jsonb_set(reception_workflow,'{qualityReworkRequestedAt}',to_jsonb(now_iso));
    reception_workflow := jsonb_set(reception_workflow,'{qualityReworkBookingId}',to_jsonb(rework_id));
    reception_workflow := jsonb_set(reception_workflow,'{qualityReworkStepKey}',to_jsonb(clean_step));
    reception_workflow := jsonb_set(reception_workflow,'{qualityReworkCycle}',to_jsonb(rework_cycle));
    reception_workflow := jsonb_set(reception_workflow,'{readyForDeliveryAt}','""'::jsonb);
    reception_workflow := jsonb_set(reception_workflow,'{qualityChecklist}',checklist);
    current_payload := jsonb_set(current_payload,'{qualityChecklist}',checklist);

    history := history || jsonb_build_array(jsonb_build_object(
      'at',now_iso,
      'by',auth.uid()::text,
      'status','rejected',
      'reason',clean_reason,
      'checklist',checklist,
      'reworkBookingId',rework_id,
      'reworkStepKey',clean_step,
      'reworkCycle',rework_cycle
    ));

  else
    flags := jsonb_set(flags,'{qualityApproved}','false'::jsonb);
    flags := jsonb_set(flags,'{delivered}','false'::jsonb);
    reception_workflow := jsonb_set(reception_workflow,'{qualityStatus}',to_jsonb(clean_status));
    reception_workflow := jsonb_set(reception_workflow,'{qualityReviewedAt}',to_jsonb(now_iso));
    reception_workflow := jsonb_set(reception_workflow,'{readyForDeliveryAt}','""'::jsonb);
    reception_workflow := jsonb_set(reception_workflow,'{qualityChecklist}',checklist);
    current_payload := jsonb_set(current_payload,'{qualityChecklist}',checklist);

    history := history || jsonb_build_array(jsonb_build_object(
      'at',now_iso,
      'by',auth.uid()::text,
      'status',clean_status,
      'reason',clean_reason,
      'checklist',checklist
    ));
  end if;

  reception_workflow := jsonb_set(
    reception_workflow,'{qualityReviewHistory}',history
  );

  current_payload := jsonb_set(current_payload,'{flags}',flags);
  current_payload := jsonb_set(current_payload,'{receptionWorkflow}',reception_workflow);

  -- Required by the later LOT20B authority cutover trigger.
  perform set_config('nimr.quality_review_v3','on',true);

  new_version := nextval('public.nimr_sync_entity_version_seq');

  update public.sync_entities
  set payload=current_payload,
      entity_version=new_version,
      last_operation_id=op_id,
      updated_at=now_value
  where workshop_id=p_workshop_id
    and entity_type='case'
    and entity_id=p_case_id
  returning * into applied;

  insert into public.sync_entity_operation_receipts(
    workshop_id,local_operation_id,entity_type,entity_id,accepted_version,accepted_at
  ) values (
    p_workshop_id,op_id,'case',p_case_id,new_version,now_value
  );

  return jsonb_build_object(
    'status','applied',
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

revoke all on function public.nimr_apply_quality_review_v3(
  uuid,text,text,text,text,jsonb,text,bigint
) from public, anon;

grant execute on function public.nimr_apply_quality_review_v3(
  uuid,text,text,text,text,jsonb,text,bigint
) to authenticated;

comment on function public.nimr_apply_quality_review_v3(
  uuid,text,text,text,text,jsonb,text,bigint
) is
  'QC-PRO-001D2: authoritative dynamic professional QC checklist with server-derived scope, OK/N-A/NOK validation, automatic rework creation, optimistic concurrency and idempotency.';
