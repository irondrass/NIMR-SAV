-- P1-002: proposal-bound planning CAS and productive-history protection.
-- Lock order: repair order row, canonical case advisory/entity lock, then the
-- stable resource/vehicle advisory locks acquired by nimr_reserve_planning_slots.
-- Existing productive rows are never tombstoned by normal appointment acceptance.

begin;

-- Preserve the complete v23.3 lower reservation implementation while changing
-- only its workshop-role guard. pg_get_functiondef keeps idempotency, lock
-- ordering, dependency/capacity checks, conflict persistence and slot results
-- byte-for-byte at the PL/pgSQL source level. The catalog definition is trusted
-- migration input; no caller-controlled value is used as dynamic SQL.
do $nimr_lower_role_boundary$
declare
  lower_function_definition text;
  lower_legacy_role_guard constant text := 'array[''admin_technique'', ''directeur'', ''chef_atelier'']';
  lower_canonical_role_guard constant text := 'array[''admin_technique'', ''directeur'', ''chef_atelier'', ''reception'']';
  lower_function_definition_role_replacements integer := 0;
begin
  select pg_catalog.pg_get_functiondef(
    'public.nimr_reserve_planning_slots(uuid, uuid, text, jsonb)'::regprocedure
  ) into lower_function_definition;

  if lower_function_definition is null then
    raise exception 'La fonction interne nimr_reserve_planning_slots est absente.';
  end if;

  if pg_catalog.strpos(lower_function_definition, lower_canonical_role_guard) > 0 then
    if pg_catalog.strpos(lower_function_definition, lower_legacy_role_guard) > 0 then
      raise exception 'La garde de rôles du lower RPC contient deux contrats incompatibles.';
    end if;
  else
    lower_function_definition_role_replacements := (
      pg_catalog.length(lower_function_definition)
      - pg_catalog.length(pg_catalog.replace(
        lower_function_definition,
        lower_legacy_role_guard,
        ''
      ))
    ) / pg_catalog.length(lower_legacy_role_guard);
    if lower_function_definition_role_replacements <> 1 then
      raise exception 'La garde de rôles historique du lower RPC est absente ou ambiguë.';
    end if;
    lower_function_definition := pg_catalog.replace(
      lower_function_definition,
      lower_legacy_role_guard,
      lower_canonical_role_guard
    );
    execute lower_function_definition;
  end if;
end
$nimr_lower_role_boundary$;

-- The lower function is an implementation boundary. Its owner may invoke it
-- from the SECURITY DEFINER outer wrapper, but no browser-facing role may do so.
revoke all on function public.nimr_reserve_planning_slots(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

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
  accepted_planning_version bigint;
  next_planning_version bigint;
  rpc_result jsonb;
  conflict_result jsonb;
  rollback_message text;
  sync_case_entity_id text;
  sync_case_payload jsonb;
  sync_case_missing_after_lock boolean := false;
  productive_history_exists boolean := false;
  accepted_slots_identity jsonb;
  current_slots_identity jsonb;
  current_slots_match_accepted_plan boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentification Supabase requise.' using errcode = '42501';
  end if;
  if not public.nimr_has_workshop_role(
    p_workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier', 'reception']
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

  -- The workshop+case row is the first lock. It serializes the case planning
  -- version and the productive-history check with replacement.
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
  limit 1
  for update;

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

  -- P0-010's granular entity is the freshest cross-workstation authority for
  -- workflow and booking state. Resolve it through the repair-order identity,
  -- then take the same parent advisory lock used by booking CAS mutations. A
  -- concurrent booking start/pause/complete therefore finishes either wholly
  -- before this productive-history check or wholly after this transaction.
  select candidate.entity_id into sync_case_entity_id
  from public.sync_entities candidate
  where candidate.workshop_id = p_workshop_id
    and candidate.entity_type = 'case'
    and candidate.deleted_at is null
    and (
      candidate.entity_id = p_case_id
      or candidate.entity_id = repair_order_row.order_number
      or candidate.payload ->> 'id' = p_case_id
      or candidate.payload ->> 'id' = repair_order_row.order_number
      or candidate.payload ->> 'orNavNumber' = repair_order_row.order_number
    )
  order by case
    when candidate.entity_id = p_case_id then 0
    when candidate.payload ->> 'id' = p_case_id then 1
    when candidate.entity_id = repair_order_row.order_number then 2
    when candidate.payload ->> 'id' = repair_order_row.order_number then 3
    else 4
  end,
  candidate.updated_at desc,
  candidate.entity_id
  limit 1;

  if sync_case_entity_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      p_workshop_id::text || ':case:' || sync_case_entity_id, 0
    ));
    select candidate.payload into sync_case_payload
    from public.sync_entities candidate
    where candidate.workshop_id = p_workshop_id
      and candidate.entity_type = 'case'
      and candidate.entity_id = sync_case_entity_id
      and candidate.deleted_at is null
    for update;
    if not found then
      sync_case_missing_after_lock := true;
    end if;
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
  current_planning_version := repair_order_row.planning_version;

  -- This single predicate is authoritative for both a new reservation and an
  -- idempotent replay. A historical receipt never bypasses productive state
  -- that appeared after the operation was first applied.
  productive_history_exists := (
    lower(coalesce(repair_order_row.status, '')) in (
      'in_progress', 'work_started', 'work_completed', 'completed',
      'quality_approved', 'delivered', 'closed', 'archived'
    )
    or coalesce(repair_order_row.actual_duration_minutes, 0) > 0
    or repair_order_row.repair_actual_start_at is not null
    or repair_order_row.delivery_done_at is not null
    or repair_order_row.closed_at is not null
    or repair_order_row.archived_at is not null
    or lower(coalesce(sync_case_payload #>> '{flags,workStarted}', 'false')) = 'true'
    or lower(coalesce(sync_case_payload #>> '{flags,workCompleted}', 'false')) = 'true'
    or lower(coalesce(sync_case_payload #>> '{flags,qualityApproved}', 'false')) = 'true'
    or lower(coalesce(sync_case_payload #>> '{flags,delivered}', 'false')) = 'true'
    or lower(coalesce(sync_case_payload ->> 'workStarted', 'false')) = 'true'
    or lower(coalesce(sync_case_payload ->> 'workCompleted', 'false')) = 'true'
    or lower(coalesce(sync_case_payload ->> 'qualityApproved', 'false')) = 'true'
    or lower(coalesce(sync_case_payload ->> 'delivered', 'false')) = 'true'
    or nullif(sync_case_payload ->> 'closedAt', '') is not null
    or nullif(sync_case_payload ->> 'archivedAt', '') is not null
    or exists (
      select 1
      from public.sync_entities booking_entity
      where booking_entity.workshop_id = p_workshop_id
        and booking_entity.entity_type = 'booking'
        and booking_entity.deleted_at is null
        and booking_entity.payload ->> 'caseId' = sync_case_entity_id
        and (
          lower(coalesce(
            booking_entity.payload ->> 'status',
            booking_entity.payload ->> 'operationalStatus',
            ''
          )) <> 'planned'
          or coalesce(public.nimr_try_numeric(
            booking_entity.payload ->> 'actualWorkedMinutes'
          ), 0) > 0
          or nullif(booking_entity.payload ->> 'actualStart', '') is not null
          or nullif(booking_entity.payload ->> 'startedAt', '') is not null
          or nullif(booking_entity.payload ->> 'actualEnd', '') is not null
          or nullif(booking_entity.payload ->> 'completedAt', '') is not null
          or nullif(booking_entity.payload ->> 'pausedAt', '') is not null
          or nullif(booking_entity.payload ->> 'blockedAt', '') is not null
          or nullif(booking_entity.payload ->> 'blockReason', '') is not null
          or lower(coalesce(booking_entity.payload ->> 'remainingFromPaused', 'false')) = 'true'
          or lower(coalesce(booking_entity.payload ->> 'needsScheduling', 'false')) = 'true'
        )
    )
    or exists (
      select 1
      from public.planning_slots planning_slot
      where planning_slot.workshop_id = p_workshop_id
        and planning_slot.repair_order_id = repair_order_row.id
        and planning_slot.deleted_at is null
        and (
          lower(coalesce(planning_slot.status, '')) <> 'planned'
          or coalesce(planning_slot.actual_worked_minutes, 0) > 0
          or planning_slot.actual_start_at is not null
          or planning_slot.actual_end_at is not null
        )
    )
    or exists (
      select 1
      from public.repair_steps repair_step
      where repair_step.workshop_id = p_workshop_id
        and repair_step.repair_order_id = repair_order_row.id
        and repair_step.deleted_at is null
        and (
          lower(coalesce(repair_step.status, '')) in ('started', 'paused', 'completed', 'in_progress', 'done')
          or coalesce(repair_step.actual_hours, 0) > 0
          or repair_step.started_at is not null
          or repair_step.completed_at is not null
          or repair_step.actual_start_at is not null
          or repair_step.actual_end_at is not null
        )
    )
  );

  -- A historical operation is immutable evidence, not necessarily current
  -- authority. Payload collision remains rejected before any replay decision.
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
        'planningVersion', current_planning_version,
        'message', 'Cette idempotencyKey existe déjà avec un contenu différent.'
      );
    end if;

    if existing_operation.status = 'applied' then
      accepted_planning_version := coalesce(
        public.nimr_try_numeric(existing_operation.result ->> 'acceptedPlanningVersion')::bigint,
        public.nimr_try_numeric(existing_operation.result ->> 'planningVersion')::bigint,
        existing_operation.expected_version + 1
      );

      -- The lower slot RPC is callable by authenticated clients and does not
      -- advance repair_orders.planning_version. Compare the active reservation
      -- identity as well as the planning CAS version before replaying an ACK.
      select coalesce(jsonb_agg(identity_row.identity order by identity_row.local_id), '[]'::jsonb)
      into accepted_slots_identity
      from (
        select
          accepted_slot ->> 'localId' as local_id,
          jsonb_build_object(
            'localId', accepted_slot ->> 'localId',
            'startAt', to_jsonb((accepted_slot ->> 'startAt')::timestamptz),
            'endAt', to_jsonb((accepted_slot ->> 'endAt')::timestamptz),
            'resourceIds', coalesce((
              select jsonb_agg(resource_id order by resource_id)
              from jsonb_array_elements_text(coalesce(accepted_slot -> 'resourceIds', '[]'::jsonb)) resource_id
            ), '[]'::jsonb),
            'primaryResourceId', nullif(accepted_slot ->> 'primaryResourceId', ''),
            'equipmentResourceIds', coalesce((
              select jsonb_agg(resource_id order by resource_id)
              from jsonb_array_elements_text(coalesce(accepted_slot -> 'equipmentResourceIds', '[]'::jsonb)) resource_id
            ), '[]'::jsonb),
            'taskId', coalesce(accepted_slot ->> 'taskId', ''),
            'stepKey', coalesce(accepted_slot ->> 'stepKey', ''),
            'dependencies', coalesce((
              select jsonb_agg(distinct dependency order by dependency)
              from jsonb_array_elements_text(coalesce(accepted_slot -> 'dependencies', '[]'::jsonb)) dependency
              where nullif(trim(dependency), '') is not null
            ), '[]'::jsonb),
            'title', accepted_slot ->> 'title',
            'plannedMinutes', greatest(0, coalesce(public.nimr_try_bigint(accepted_slot ->> 'plannedMinutes'), 0)),
            'vehicleExclusive', (
              lower(coalesce(accepted_slot ->> 'vehicleExclusive', 'false')) = 'true'
              or lower(coalesce(nullif(accepted_slot ->> 'vehicleLocation', ''), 'internal')) in ('external', 'transport')
            ),
            'vehicleLocation', lower(coalesce(nullif(accepted_slot ->> 'vehicleLocation', ''), 'internal')),
            'serviceMode', lower(coalesce(nullif(accepted_slot ->> 'serviceMode', ''), 'internal')),
            'subcontractId', coalesce(accepted_slot ->> 'subcontractId', accepted_slot ->> 'subcontract_id'),
            'capacityUnits', greatest(1, coalesce(public.nimr_try_numeric(accepted_slot ->> 'capacityUnits'), 1)),
            'resourceUnits', coalesce(accepted_slot -> 'resourceUnits', '{}'::jsonb),
            'status', lower(coalesce(nullif(accepted_slot ->> 'status', ''), 'planned'))
          ) as identity
        from jsonb_array_elements(existing_operation.payload) accepted_slot
      ) identity_row;

      select coalesce(jsonb_agg(identity_row.identity order by identity_row.local_id), '[]'::jsonb)
      into current_slots_identity
      from (
        select
          planning_slot.local_id as local_id,
          jsonb_build_object(
            'localId', planning_slot.local_id,
            'startAt', to_jsonb(planning_slot.start_at),
            'endAt', to_jsonb(planning_slot.end_at),
            'resourceIds', coalesce((
              select jsonb_agg(resource_id::text order by resource_id::text)
              from unnest(coalesce(planning_slot.resource_ids, '{}'::uuid[])) resource_id
            ), '[]'::jsonb),
            'primaryResourceId', planning_slot.primary_resource_id::text,
            'equipmentResourceIds', coalesce((
              select jsonb_agg(resource_id::text order by resource_id::text)
              from unnest(coalesce(planning_slot.equipment_resource_ids, '{}'::uuid[])) resource_id
            ), '[]'::jsonb),
            'taskId', coalesce(planning_slot.task_id, ''),
            'stepKey', coalesce(planning_slot.step_key, ''),
            'dependencies', coalesce((
              select jsonb_agg(dependency order by dependency)
              from unnest(coalesce(planning_slot.dependencies, '{}'::text[])) dependency
            ), '[]'::jsonb),
            'title', planning_slot.title,
            'plannedMinutes', greatest(0, coalesce(planning_slot.planned_minutes, 0))::bigint,
            'vehicleExclusive', coalesce(planning_slot.vehicle_exclusive, true),
            'vehicleLocation', coalesce(nullif(planning_slot.vehicle_location, ''), 'internal'),
            'serviceMode', coalesce(nullif(planning_slot.service_mode, ''), 'internal'),
            'subcontractId', planning_slot.subcontract_id,
            'capacityUnits', greatest(1, coalesce(planning_slot.capacity_units, 1)),
            'resourceUnits', coalesce(planning_slot.resource_units, '{}'::jsonb),
            'status', lower(coalesce(planning_slot.status, ''))
          ) as identity
        from public.planning_slots planning_slot
        where planning_slot.workshop_id = p_workshop_id
          and planning_slot.repair_order_id = repair_order_row.id
          and planning_slot.deleted_at is null
      ) identity_row;

      current_slots_match_accepted_plan := accepted_slots_identity = current_slots_identity;
      if not sync_case_missing_after_lock
        and current_planning_version = accepted_planning_version
        and productive_history_exists is false
        and current_slots_match_accepted_plan then
        return coalesce(existing_operation.result, '{}'::jsonb) || jsonb_build_object(
          'ok', true,
          'acknowledged', true,
          'status', 'applied',
          'operationId', existing_operation.operation_id,
          'acceptedPlanningVersion', accepted_planning_version,
          'planningVersion', current_planning_version,
          'idempotentReplay', true,
          'superseded', false,
          'currentSlotsMatchAcceptedPlan', true
        );
      end if;

      return jsonb_build_object(
        'ok', false,
        'acknowledged', true,
        'status', 'conflict',
        'code', case
          when productive_history_exists then 'idempotent_replay_productive_history'
          else 'idempotent_replay_superseded'
        end,
        'operationId', existing_operation.operation_id,
        'caseId', p_case_id,
        'acceptedPlanningVersion', accepted_planning_version,
        'planningVersion', current_planning_version,
        'idempotentReplay', true,
        'superseded', true,
        'productiveHistory', productive_history_exists,
        'currentSlotsMatchAcceptedPlan', current_slots_match_accepted_plan,
        'message', case
          when productive_history_exists then 'Cette réservation a réussi historiquement, mais le travail productif a commencé depuis.'
          else 'Cette réservation a réussi historiquement, mais elle n''est plus le planning courant.'
        end
      );
    end if;

    return coalesce(existing_operation.result, jsonb_build_object(
      'ok', false,
      'acknowledged', existing_operation.status = 'conflict',
      'status', existing_operation.status,
      'operationId', existing_operation.operation_id
    )) || jsonb_build_object(
      'planningVersion', current_planning_version,
      'idempotentReplay', true,
      'superseded', false
    );
  end if;

  if sync_case_missing_after_lock then
    conflict_result := jsonb_build_object(
      'ok', false,
      'acknowledged', true,
      'status', 'conflict',
      'code', 'case_state_conflict',
      'operationId', operation_id_value,
      'caseId', p_case_id,
      'expectedVersion', p_expected_version,
      'actualVersion', current_planning_version,
      'planningVersion', current_planning_version,
      'message', 'Le dossier canonique a changé ou a été supprimé pendant la réservation.'
    );
  elsif current_planning_version is distinct from coalesce(p_expected_version, 0) then
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
  elsif productive_history_exists then
    conflict_result := jsonb_build_object(
      'ok', false,
      'acknowledged', true,
      'status', 'conflict',
      'code', 'productive_history_conflict',
      'operationId', operation_id_value,
      'caseId', p_case_id,
      'expectedVersion', p_expected_version,
      'actualVersion', current_planning_version,
      'planningVersion', current_planning_version,
      'message', 'Le travail productif a déjà commencé ou est terminé ; le planning ne peut pas être remplacé.'
    );
  end if;

  if conflict_result is not null then
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
      repair_order_row.id, conflict_result ->> 'code', p_expected_version,
      current_planning_version, enriched_bookings, conflict_result,
      'open', 'rpc_reservation'
    )
    on conflict (workshop_id, operation_id) do update
    set expected_version = excluded.expected_version,
        actual_version = excluded.actual_version,
        local_payload = excluded.local_payload,
        server_payload = excluded.server_payload,
        conflict_code = excluded.conflict_code,
        status = 'open';

    return conflict_result;
  end if;

  -- Replacement is a subtransaction. If capacity/reservation fails, the
  -- P1_002_RESERVATION_ROLLBACK exception restores every prior planned row and
  -- allocation before the explicit conflict is returned.
  begin
    update public.planning_slot_allocations allocation
    set deleted_at = clock_timestamp(),
        updated_by = auth.uid()
    where allocation.workshop_id = p_workshop_id
      and allocation.deleted_at is null
      and exists (
        select 1
        from public.planning_slots planning_slot
        where planning_slot.id = allocation.slot_id
          and planning_slot.workshop_id = p_workshop_id
          and planning_slot.repair_order_id = repair_order_row.id
          and planning_slot.deleted_at is null
          and lower(coalesce(planning_slot.status, '')) = 'planned'
      );

    update public.planning_slots planning_slot
    set local_id = planning_slot.local_id || ':replaced:' || operation_id_value::text,
        deleted_at = clock_timestamp(),
        updated_by = auth.uid()
    where planning_slot.workshop_id = p_workshop_id
      and planning_slot.repair_order_id = repair_order_row.id
      and planning_slot.deleted_at is null
      and lower(coalesce(planning_slot.status, '')) = 'planned';

    rpc_result := public.nimr_reserve_planning_slots(
      p_workshop_id,
      operation_id_value,
      trim(p_idempotency_key),
      enriched_bookings
    );

    if coalesce((rpc_result ->> 'ok')::boolean, false) is not true then
      conflict_result := rpc_result;
      raise exception 'P1_002_RESERVATION_ROLLBACK'
        using errcode = 'P0001';
    end if;
  exception when raise_exception then
    rollback_message := sqlerrm;
    if rollback_message <> 'P1_002_RESERVATION_ROLLBACK' then
      raise;
    end if;
  end;

  if conflict_result is not null then
    conflict_result := conflict_result || jsonb_build_object(
      'acknowledged', true,
      'planningVersion', current_planning_version,
      'caseId', p_case_id
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
      repair_order_row.id, coalesce(conflict_result ->> 'code', 'planning_conflict'),
      p_expected_version, current_planning_version, enriched_bookings,
      conflict_result, 'open', 'rpc_reservation'
    )
    on conflict (workshop_id, operation_id) do update
    set expected_version = excluded.expected_version,
        actual_version = excluded.actual_version,
        local_payload = excluded.local_payload,
        server_payload = excluded.server_payload,
        conflict_code = excluded.conflict_code,
        status = 'open';
    return conflict_result;
  end if;

  update public.repair_orders
  set planning_version = planning_version + 1
  where id = repair_order_row.id
    and workshop_id = p_workshop_id
    and planning_version = current_planning_version
  returning planning_version into next_planning_version;

  if not found then
    raise exception 'La version planning a changé pendant la réservation.'
      using errcode = '40001';
  end if;

  rpc_result := rpc_result || jsonb_build_object(
    'ok', true,
    'acknowledged', true,
    'status', 'applied',
    'caseId', p_case_id,
    'repairOrderId', repair_order_row.id,
    'acceptedPlanningVersion', next_planning_version,
    'planningVersion', next_planning_version,
    'idempotentReplay', false,
    'superseded', false
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

-- A nested call executes with the outer SECURITY DEFINER owner's privileges.
-- Fail the migration instead of deploying a wrapper whose owner cannot invoke
-- the now-internal lower function.
do $nimr_nested_owner_boundary$
declare
  lower_function_owner oid;
  outer_function_owner oid;
begin
  select candidate.proowner into lower_function_owner
  from pg_catalog.pg_proc candidate
  where candidate.oid = 'public.nimr_reserve_planning_slots(uuid, uuid, text, jsonb)'::regprocedure;

  select candidate.proowner into outer_function_owner
  from pg_catalog.pg_proc candidate
  where candidate.oid = 'public.nimr_reserve_planning_atomic(uuid, text, bigint, text, jsonb)'::regprocedure;

  if lower_function_owner is null
    or outer_function_owner is null
    or lower_function_owner <> outer_function_owner then
    raise exception 'Les RPC planning interne et externe doivent avoir le même propriétaire SECURITY DEFINER.';
  end if;
end
$nimr_nested_owner_boundary$;

revoke all on function public.nimr_reserve_planning_atomic(uuid, text, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.nimr_reserve_planning_atomic(uuid, text, bigint, text, jsonb)
  to authenticated;

comment on function public.nimr_reserve_planning_atomic(uuid, text, bigint, text, jsonb) is
  'P1-002: CAS lié à la proposition ; un reçu idempotent historique n est applicable que si version, créneaux actifs et état non productif restent courants.';

insert into public.nimr_schema_migrations (version, description)
values (
  'p1-002-planning-acceptance-safety',
  'Protection productive, remplacement planifié atomique et rejeu historique vérifié contre l autorité planning courante.'
)
on conflict (version) do update
set description = excluded.description;

notify pgrst, 'reload schema';

commit;
