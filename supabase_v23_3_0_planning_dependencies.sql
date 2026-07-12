-- NIMR SAV V23.3.0
-- Migration idempotente : conservation et validation des dépendances planning.
-- Ne contient aucune donnée atelier ni réparation spécifique.

begin;

CREATE OR REPLACE FUNCTION public.nimr_reserve_planning_slots(p_workshop_id uuid, p_operation_id uuid, p_idempotency_key text, p_slots jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  operation_row public.sync_operations%rowtype;
  existing_operation public.sync_operations%rowtype;
  slot_payload jsonb;
  lock_row record;
  resource_id_value uuid;
  resource_ids_value uuid[];
  equipment_ids_value uuid[];
  dependencies_value text[];
  dependency_ref text;
  dependency_end_value timestamptz;
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

      select coalesce(
        array_agg(distinct dependency_token order by dependency_token),
        '{}'::text[]
      )
      into dependencies_value
      from (
        select nullif(trim(dependency_item.value), '') as dependency_token
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(slot_payload -> 'dependencies') = 'array'
              then slot_payload -> 'dependencies'
            else '[]'::jsonb
          end
        ) as dependency_item(value)
      ) parsed_dependencies
      where dependency_token is not null;

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

      foreach dependency_ref in array dependencies_value
      loop
        select max(
          public.nimr_try_timestamptz(
            coalesce(
              dependency_slot.value ->> 'endAt',
              dependency_slot.value ->> 'end_at',
              dependency_slot.value ->> 'end'
            )
          )
        )
        into dependency_end_value
        from jsonb_array_elements(p_slots) as dependency_slot(value)
        where coalesce(
          dependency_slot.value ->> 'taskId',
          dependency_slot.value ->> 'task_id',
          dependency_slot.value ->> 'stepKey',
          dependency_slot.value ->> 'step_key'
        ) = dependency_ref;

        if dependency_end_value is null then
          select max(existing_slot.end_at)
          into dependency_end_value
          from public.planning_slots existing_slot
          where existing_slot.workshop_id = p_workshop_id
            and existing_slot.repair_order_id = repair_order_id_value
            and existing_slot.deleted_at is null
            and (
              existing_slot.task_id = dependency_ref
              or existing_slot.step_key = dependency_ref
            );
        end if;

        if dependency_end_value is null then
          conflict_result := jsonb_build_object(
            'ok', false,
            'status', 'conflict',
            'code', 'planning_dependency_not_found',
            'slotId', slot_id_value,
            'dependency', dependency_ref,
            'message', 'Une dépendance du planning est introuvable.'
          );
          raise exception 'NIMR_RESERVATION_CONFLICT:%', conflict_result::text
            using errcode = 'P0001';
        end if;

        if start_value < dependency_end_value then
          conflict_result := jsonb_build_object(
            'ok', false,
            'status', 'conflict',
            'code', 'planning_dependency_order_conflict',
            'slotId', slot_id_value,
            'dependency', dependency_ref,
            'dependencyEnd', dependency_end_value,
            'slotStart', start_value,
            'message', 'Une tâche commence avant la fin de sa dépendance.'
          );
          raise exception 'NIMR_RESERVATION_CONFLICT:%', conflict_result::text
            using errcode = 'P0001';
        end if;
      end loop;

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
            dependencies = dependencies_value,
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
          dependencies, start_at, end_at, status, planned_minutes, vehicle_location,
          vehicle_exclusive, service_mode, subcontract_id, capacity_units,
          resource_units, operation_id, idempotency_key, temporary, sync_source
        ) values (
          slot_id_value, p_workshop_id, local_id_value, repair_order_id_value,
          resource_ids_value[1], resource_ids_value, primary_resource_id_value,
          equipment_ids_value,
          coalesce(slot_payload ->> 'taskId', slot_payload ->> 'task_id'),
          coalesce(slot_payload ->> 'stepKey', slot_payload ->> 'step_key'),
          slot_payload ->> 'title', dependencies_value,
          start_value, end_value, status_value,
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
        'resourceIds', to_jsonb(resource_ids_value),
        'dependencies', to_jsonb(dependencies_value)
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
$function$;

revoke all on function public.nimr_reserve_planning_slots(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;

grant execute on function public.nimr_reserve_planning_slots(
  uuid, uuid, text, jsonb
) to authenticated;

comment on function public.nimr_reserve_planning_slots(
  uuid, uuid, text, jsonb
) is
  'Réservation atomique NIMR SAV avec dépendances persistées et ordre temporel validé.';

commit;
