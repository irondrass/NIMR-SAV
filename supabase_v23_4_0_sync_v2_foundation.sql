-- NIMR SAV Sync V2 - Phase B1
-- Migration additive, idempotente et sans bascule du runtime V23.3.0.
--
-- Cette migration prépare :
--   * les versions serveur par domaine pour repair_orders ;
--   * les métadonnées de l'enveloppe Sync V2 dans sync_operations ;
--   * les métadonnées explicites des conflits ;
--   * un RPC ciblé pour les patches header/status en mode non actif.
--
-- Elle ne supprime aucune table, aucune colonne et ne modifie pas cloud_backups.

begin;

-- ---------------------------------------------------------------------------
-- 1. Versions serveur par domaine sur repair_orders
-- ---------------------------------------------------------------------------

alter table public.repair_orders
  add column if not exists header_version bigint not null default 0;
alter table public.repair_orders
  add column if not exists estimate_version bigint not null default 0;
alter table public.repair_orders
  add column if not exists status_version bigint not null default 0;
alter table public.repair_orders
  add column if not exists execution_version bigint not null default 0;

-- La date de base des versions de domaine est initialisée par le DDL.
-- Aucun UPDATE métier de masse n'est exécuté : le trigger historique de version
-- globale ne doit pas modifier updated_at/version lors de cette migration.
alter table public.repair_orders
  add column if not exists header_updated_at timestamptz not null default clock_timestamp();
alter table public.repair_orders
  add column if not exists header_updated_by uuid;
alter table public.repair_orders
  add column if not exists estimate_updated_at timestamptz not null default clock_timestamp();
alter table public.repair_orders
  add column if not exists estimate_updated_by uuid;
alter table public.repair_orders
  add column if not exists status_updated_at timestamptz not null default clock_timestamp();
alter table public.repair_orders
  add column if not exists status_updated_by uuid;
alter table public.repair_orders
  add column if not exists execution_updated_at timestamptz not null default clock_timestamp();
alter table public.repair_orders
  add column if not exists execution_updated_by uuid;

create index if not exists repair_orders_workshop_header_version_idx
  on public.repair_orders(workshop_id, header_version);
create index if not exists repair_orders_workshop_status_version_idx
  on public.repair_orders(workshop_id, status_version);

-- ---------------------------------------------------------------------------
-- 2. Enveloppe serveur Sync V2
-- ---------------------------------------------------------------------------

alter table public.sync_operations
  add column if not exists schema_version integer not null default 1;
alter table public.sync_operations
  add column if not exists device_id text;
alter table public.sync_operations
  add column if not exists domain text;
alter table public.sync_operations
  add column if not exists entity_key text;
alter table public.sync_operations
  add column if not exists server_version bigint;
alter table public.sync_operations
  add column if not exists conflict_code text;
alter table public.sync_operations
  add column if not exists server_acknowledged_at timestamptz;

alter table public.sync_conflicts
  add column if not exists schema_version integer not null default 1;
alter table public.sync_conflicts
  add column if not exists idempotency_key text;
alter table public.sync_conflicts
  add column if not exists device_id text;
alter table public.sync_conflicts
  add column if not exists domain text;
alter table public.sync_conflicts
  add column if not exists entity_key text;
alter table public.sync_conflicts
  add column if not exists server_updated_at timestamptz;
alter table public.sync_conflicts
  add column if not exists server_updated_by uuid;
alter table public.sync_conflicts
  add column if not exists client_created_at timestamptz;

do $nimr$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sync_operations_domain_check'
      and conrelid = 'public.sync_operations'::regclass
  ) then
    alter table public.sync_operations
      add constraint sync_operations_domain_check
      check (
        domain is null
        or domain in (
          'header', 'estimate', 'status', 'execution',
          'planning', 'note', 'photo', 'audit', 'settings'
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sync_conflicts_domain_check'
      and conrelid = 'public.sync_conflicts'::regclass
  ) then
    alter table public.sync_conflicts
      add constraint sync_conflicts_domain_check
      check (
        domain is null
        or domain in (
          'header', 'estimate', 'status', 'execution',
          'planning', 'note', 'photo', 'audit', 'settings'
        )
      ) not valid;
  end if;
end
$nimr$;

alter table public.sync_operations
  validate constraint sync_operations_domain_check;
alter table public.sync_conflicts
  validate constraint sync_conflicts_domain_check;

create index if not exists sync_operations_workshop_domain_entity_idx
  on public.sync_operations(workshop_id, domain, entity_type, entity_key, created_at);
create index if not exists sync_conflicts_workshop_domain_status_idx
  on public.sync_conflicts(workshop_id, domain, status, created_at);

-- ---------------------------------------------------------------------------
-- 3. RPC ciblé repair_order header/status
-- ---------------------------------------------------------------------------

create or replace function public.nimr_apply_repair_order_patch_v2(
  p_workshop_id uuid,
  p_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $nimr$
declare
  operation_schema_version bigint;
  operation_id_value uuid;
  idempotency_key_value text;
  entity_key_value text;
  entity_type_value text;
  operation_workshop_id_value uuid;
  domain_value text;
  action_value text;
  device_id_value text;
  expected_version_value bigint;
  payload_value jsonb;
  changes_value jsonb;
  payload_hash_value text;
  current_version_value bigint;
  next_version_value bigint;
  current_updated_at timestamptz;
  current_updated_by uuid;
  repair_order_row public.repair_orders%rowtype;
  existing_operation public.sync_operations%rowtype;
  before_data_value jsonb;
  after_data_value jsonb;
  result_value jsonb;
  conflict_value jsonb;
  unsupported_fields text[];
  requested_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentification Supabase requise.'
      using errcode = '42501';
  end if;

  if not public.nimr_has_workshop_role(
    p_workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier', 'reception']
  ) then
    raise exception 'Rôle non autorisé pour modifier ce dossier.'
      using errcode = '42501';
  end if;

  if p_operation is null or jsonb_typeof(p_operation) <> 'object' then
    raise exception 'p_operation doit être un objet JSON.'
      using errcode = '22023';
  end if;

  operation_schema_version := case
    when not (p_operation ? 'schemaVersion')
      or nullif(trim(coalesce(p_operation ->> 'schemaVersion', '')), '') is null
      then 1
    else public.nimr_try_bigint(p_operation ->> 'schemaVersion')
  end;
  operation_id_value := public.nimr_try_uuid(
    p_operation ->> 'operationId'
  );
  idempotency_key_value := trim(
    coalesce(p_operation ->> 'idempotencyKey', '')
  );
  entity_key_value := trim(
    coalesce(p_operation ->> 'entityId', '')
  );
  entity_type_value := trim(
    lower(coalesce(p_operation ->> 'entityType', ''))
  );
  operation_workshop_id_value := public.nimr_try_uuid(
    p_operation ->> 'workshopId'
  );
  domain_value := trim(
    lower(coalesce(p_operation ->> 'domain', ''))
  );
  action_value := trim(
    lower(coalesce(p_operation ->> 'action', ''))
  );
  device_id_value := nullif(
    trim(coalesce(p_operation ->> 'deviceId', '')),
    ''
  );
  expected_version_value := public.nimr_try_bigint(
    p_operation ->> 'expectedVersion'
  );
  payload_value := coalesce(
    p_operation -> 'payload',
    '{}'::jsonb
  );
  changes_value := coalesce(
    payload_value -> 'changes',
    '{}'::jsonb
  );

  if operation_schema_version is null
    or operation_schema_version <> 1 then
    raise exception 'schemaVersion Sync V2 non supportée.'
      using errcode = '22023';
  end if;
  if operation_id_value is null then
    raise exception 'operationId UUID obligatoire.'
      using errcode = '22023';
  end if;
  if idempotency_key_value = '' then
    raise exception 'idempotencyKey obligatoire.'
      using errcode = '22023';
  end if;
  if entity_key_value = '' then
    raise exception 'entityId obligatoire.'
      using errcode = '22023';
  end if;
  if entity_type_value <> 'repair_order' then
    raise exception 'Le RPC B1 accepte uniquement entityType=repair_order.'
      using errcode = '22023';
  end if;
  if operation_workshop_id_value is null
    or operation_workshop_id_value <> p_workshop_id then
    raise exception 'workshopId doit correspondre à l''atelier du RPC.'
      using errcode = '22023';
  end if;
  if domain_value not in ('header', 'status') then
    raise exception 'Le RPC B1 accepte uniquement header ou status.'
      using errcode = '22023';
  end if;
  if action_value <> 'patch' then
    raise exception 'Le RPC B1 accepte uniquement action=patch.'
      using errcode = '22023';
  end if;
  if expected_version_value is null
    or expected_version_value < 0 then
    raise exception 'expectedVersion entier positif ou nul obligatoire.'
      using errcode = '22023';
  end if;
  if jsonb_typeof(payload_value) <> 'object'
    or jsonb_typeof(changes_value) <> 'object' then
    raise exception 'payload.changes doit être un objet JSON.'
      using errcode = '22023';
  end if;
  if payload_value ? 'state' then
    raise exception 'payload.state est interdit dans Sync V2.'
      using errcode = '22023';
  end if;

  if domain_value = 'header' then
    select coalesce(array_agg(field_name order by field_name), '{}'::text[])
    into unsupported_fields
    from jsonb_object_keys(changes_value) as fields(field_name)
    where field_name not in (
      'estimate_number', 'next_action'
    );
  else
    select coalesce(array_agg(field_name order by field_name), '{}'::text[])
    into unsupported_fields
    from jsonb_object_keys(changes_value) as fields(field_name)
    where field_name not in ('status');
  end if;

  if coalesce(array_length(unsupported_fields, 1), 0) > 0 then
    raise exception 'Champs non autorisés pour le domaine % : %',
      domain_value,
      array_to_string(unsupported_fields, ', ')
      using errcode = '22023';
  end if;

  if changes_value = '{}'::jsonb then
    raise exception 'payload.changes ne peut pas être vide.'
      using errcode = '22023';
  end if;

  if domain_value = 'status' then
    requested_status := trim(
      lower(coalesce(changes_value ->> 'status', ''))
    );

    -- Contrat transitoire B1 : valeurs réellement persistées par
    -- buildRepairStatus() dans le moteur V23.3.0, plus le défaut historique
    -- chief_validation_pending du schéma Supabase.
    if requested_status not in (
      'new',
      'appointment_scheduled',
      'expert_approved',
      'client_approved',
      'pdf_chief_validation_pending',
      'pdf_ready_for_planning',
      'received',
      'in_progress',
      'work_completed',
      'quality_approved',
      'delivered',
      'chief_validation_pending'
    ) then
      raise exception 'Statut métier non autorisé.'
        using errcode = '22023';
    end if;
  end if;

  payload_hash_value := pg_catalog.md5(
    jsonb_build_object(
      'schemaVersion', operation_schema_version,
      'workshopId', operation_workshop_id_value,
      'entityType', entity_type_value,
      'entityId', entity_key_value,
      'domain', domain_value,
      'action', action_value,
      'expectedVersion', expected_version_value,
      'payload', payload_value
    )::text
  );

  -- Sérialise les retries concurrents de la même clé avant toute lecture.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workshop_id::text || ':' || idempotency_key_value,
      0
    )
  );

  select *
  into existing_operation
  from public.sync_operations
  where workshop_id = p_workshop_id
    and idempotency_key = idempotency_key_value
  limit 1;

  if found then
    if existing_operation.payload_hash is distinct from payload_hash_value then
      return jsonb_build_object(
        'ok', false,
        'acknowledged', true,
        'status', 'conflict',
        'code', 'idempotency_payload_mismatch',
        'operationId', existing_operation.operation_id,
        'idempotencyKey', idempotency_key_value,
        'message', 'Cette idempotencyKey existe avec un contenu différent.'
      );
    end if;

    return coalesce(
      existing_operation.result,
      jsonb_build_object(
        'ok', existing_operation.status = 'applied',
        'acknowledged', existing_operation.status in ('applied', 'conflict'),
        'status', existing_operation.status,
        'operationId', existing_operation.operation_id,
        'serverVersion', existing_operation.server_version
      )
    ) || jsonb_build_object('idempotentReplay', true);
  end if;

  select candidate.*
  into repair_order_row
  from public.repair_orders candidate
  where candidate.workshop_id = p_workshop_id
    and candidate.deleted_at is null
    and (
      candidate.id = public.nimr_try_uuid(entity_key_value)
      or candidate.local_id = entity_key_value
    )
  order by case
    when candidate.id = public.nimr_try_uuid(entity_key_value) then 0
    else 1
  end,
  candidate.id
  limit 1
  for update;

  if not found then
    result_value := jsonb_build_object(
      'ok', false,
      'acknowledged', true,
      'status', 'conflict',
      'code', 'repair_order_not_found',
      'operationId', operation_id_value,
      'entityId', entity_key_value,
      'domain', domain_value,
      'message', 'Le dossier est introuvable dans cet atelier.'
    );

    insert into public.sync_operations (
      operation_id, workshop_id, idempotency_key, entity_type,
      entity_id, entity_key, domain, action, payload, payload_hash,
      expected_version, user_id, device_id, schema_version,
      status, conflict_code, last_error, result,
      acknowledged_at, server_acknowledged_at
    ) values (
      operation_id_value, p_workshop_id, idempotency_key_value,
      'repair_order', null, entity_key_value, domain_value, action_value,
      payload_value, payload_hash_value, expected_version_value,
      auth.uid(), device_id_value, operation_schema_version,
      'conflict', 'repair_order_not_found', result_value ->> 'message',
      result_value, clock_timestamp(), clock_timestamp()
    );

    return result_value;
  end if;

  if domain_value = 'header' then
    current_version_value := repair_order_row.header_version;
    current_updated_at := repair_order_row.header_updated_at;
    current_updated_by := repair_order_row.header_updated_by;
    before_data_value := jsonb_build_object(
      'estimate_number', repair_order_row.estimate_number,
      'next_action', repair_order_row.next_action,
      'headerVersion', repair_order_row.header_version
    );
  else
    current_version_value := repair_order_row.status_version;
    current_updated_at := repair_order_row.status_updated_at;
    current_updated_by := repair_order_row.status_updated_by;
    before_data_value := jsonb_build_object(
      'status', repair_order_row.status,
      'statusVersion', repair_order_row.status_version
    );
  end if;

  if current_version_value is distinct from expected_version_value then
    conflict_value := jsonb_build_object(
      'ok', false,
      'acknowledged', true,
      'status', 'conflict',
      'code', 'optimistic_version_conflict',
      'operationId', operation_id_value,
      'idempotencyKey', idempotency_key_value,
      'entityType', 'repair_order',
      'entityId', entity_key_value,
      'repairOrderId', repair_order_row.id,
      'domain', domain_value,
      'expectedVersion', expected_version_value,
      'actualVersion', current_version_value,
      'serverVersion', current_version_value,
      'serverUpdatedAt', current_updated_at,
      'serverUpdatedBy', current_updated_by,
      'serverPayload', before_data_value,
      'message', 'Le même domaine du dossier a été modifié sur un autre poste.'
    );

    insert into public.sync_operations (
      operation_id, workshop_id, idempotency_key, entity_type,
      entity_id, entity_key, domain, action, payload, payload_hash,
      expected_version, server_version, user_id, device_id,
      schema_version, status, conflict_code, last_error, result,
      acknowledged_at, server_acknowledged_at
    ) values (
      operation_id_value, p_workshop_id, idempotency_key_value,
      'repair_order', repair_order_row.id, entity_key_value,
      domain_value, action_value, payload_value, payload_hash_value,
      expected_version_value, current_version_value, auth.uid(),
      device_id_value, operation_schema_version, 'conflict',
      'optimistic_version_conflict', conflict_value ->> 'message',
      conflict_value, clock_timestamp(), clock_timestamp()
    );

    insert into public.sync_conflicts (
      workshop_id, operation_id, idempotency_key, entity_type,
      entity_id, entity_key, domain, conflict_code,
      expected_version, actual_version, local_payload, server_payload,
      server_updated_at, server_updated_by, client_created_at,
      device_id, schema_version, status, sync_source
    ) values (
      p_workshop_id, operation_id_value, idempotency_key_value,
      'repair_order', repair_order_row.id, entity_key_value,
      domain_value, 'optimistic_version_conflict',
      expected_version_value, current_version_value,
      p_operation, before_data_value, current_updated_at,
      current_updated_by,
      public.nimr_try_timestamptz(p_operation ->> 'createdAt'),
      device_id_value, operation_schema_version, 'open', 'sync_v2_rpc'
    )
    on conflict (workshop_id, operation_id) do update
    set expected_version = excluded.expected_version,
        actual_version = excluded.actual_version,
        local_payload = excluded.local_payload,
        server_payload = excluded.server_payload,
        server_updated_at = excluded.server_updated_at,
        server_updated_by = excluded.server_updated_by,
        client_created_at = excluded.client_created_at,
        device_id = excluded.device_id,
        domain = excluded.domain,
        entity_key = excluded.entity_key,
        status = 'open',
        resolution = null,
        resolved_at = null,
        resolved_by = null;

    return conflict_value;
  end if;

  if domain_value = 'header' then
    update public.repair_orders
    set estimate_number = case
          when changes_value ? 'estimate_number'
            then nullif(trim(changes_value ->> 'estimate_number'), '')
          else estimate_number
        end,
        next_action = case
          when changes_value ? 'next_action'
            then changes_value ->> 'next_action'
          else next_action
        end,
        header_version = header_version + 1,
        header_updated_at = clock_timestamp(),
        header_updated_by = auth.uid()
    where id = repair_order_row.id
      and workshop_id = p_workshop_id
      and header_version = current_version_value
    returning * into repair_order_row;

    next_version_value := repair_order_row.header_version;
    after_data_value := jsonb_build_object(
      'estimate_number', repair_order_row.estimate_number,
      'next_action', repair_order_row.next_action,
      'headerVersion', repair_order_row.header_version,
      'updatedAt', repair_order_row.header_updated_at,
      'updatedBy', repair_order_row.header_updated_by
    );
  else
    update public.repair_orders
    set status = requested_status,
        status_version = status_version + 1,
        status_updated_at = clock_timestamp(),
        status_updated_by = auth.uid()
    where id = repair_order_row.id
      and workshop_id = p_workshop_id
      and status_version = current_version_value
    returning * into repair_order_row;

    next_version_value := repair_order_row.status_version;
    after_data_value := jsonb_build_object(
      'status', repair_order_row.status,
      'statusVersion', repair_order_row.status_version,
      'updatedAt', repair_order_row.status_updated_at,
      'updatedBy', repair_order_row.status_updated_by
    );
  end if;

  if not found then
    raise exception 'La version du domaine a changé pendant la transaction.'
      using errcode = '40001';
  end if;

  result_value := jsonb_build_object(
    'ok', true,
    'acknowledged', true,
    'status', 'applied',
    'operationId', operation_id_value,
    'idempotencyKey', idempotency_key_value,
    'entityType', 'repair_order',
    'entityId', entity_key_value,
    'repairOrderId', repair_order_row.id,
    'domain', domain_value,
    'serverVersion', next_version_value,
    'serverAcknowledgedAt', clock_timestamp(),
    'result', after_data_value
  );

  insert into public.sync_operations (
    operation_id, workshop_id, idempotency_key, entity_type,
    entity_id, entity_key, domain, action, payload, payload_hash,
    expected_version, server_version, user_id, device_id,
    schema_version, status, result, acknowledged_at,
    server_acknowledged_at
  ) values (
    operation_id_value, p_workshop_id, idempotency_key_value,
    'repair_order', repair_order_row.id, entity_key_value,
    domain_value, action_value, payload_value, payload_hash_value,
    expected_version_value, next_version_value, auth.uid(),
    device_id_value, operation_schema_version, 'applied',
    result_value, clock_timestamp(), clock_timestamp()
  );

  insert into public.audit_logs (
    workshop_id, local_id, repair_order_id, action,
    entity_type, entity_id, before_data, after_data,
    sync_source
  ) values (
    p_workshop_id,
    'sync-v2:' || operation_id_value::text,
    repair_order_row.id,
    'sync_v2.repair_order.' || domain_value || '.patch',
    'repair_order',
    repair_order_row.id,
    before_data_value,
    after_data_value,
    'sync_v2_rpc'
  )
  on conflict (workshop_id, local_id) do nothing;

  return result_value;
end
$nimr$;

revoke all on function public.nimr_apply_repair_order_patch_v2(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.nimr_apply_repair_order_patch_v2(uuid, jsonb)
  to authenticated;

comment on function public.nimr_apply_repair_order_patch_v2(uuid, jsonb) is
  'Sync V2 B1 non actif : patch idempotent et versionné des domaines header/status de repair_orders.';

insert into public.nimr_schema_migrations(version, description)
values (
  '23.4.0-sync-v2-b1',
  'Sync V2 B1 : versions par domaine, enveloppe serveur et RPC repair_order header/status'
)
on conflict (version) do update
set description = excluded.description;

update public.workshops
set schema_version = '23.4.0-sync-v2-b1',
    updated_at = clock_timestamp()
where id = '00000000-0000-0000-0000-000000000001';

commit;
