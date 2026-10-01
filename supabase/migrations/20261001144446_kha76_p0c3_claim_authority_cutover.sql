-- KHA-76 / P0c.3 — legacy claim authority cutover.
-- repair_claims stays canonical. Legacy PWA writes through one bounded RPC.
-- No warranty-network, MEDIA, OEM or payment schema is introduced here.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.nimr_upsert_legacy_repair_claims(
  p_workshop_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $p0c3$
declare
  row_payload jsonb;
  unknown_field text;
  local_id_value text;
  repair_order_id_value uuid;
  type_value text;
  status_value text;
  include_value boolean;
  expert_value boolean;
  client_value boolean;
  amount_value numeric;
  created_at_value timestamptz;
  existing_row public.repair_claims%rowtype;
  claim_id_value uuid;
  result_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'P0C3_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not public.nimr_has_workshop_role(
    p_workshop_id,
    array['admin_technique', 'directeur', 'chef_atelier', 'reception']
  ) then
    raise exception 'P0C3_ROLE_FORBIDDEN' using errcode = '42501';
  end if;

  if pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'P0C3_ROWS_ARRAY_REQUIRED' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_rows) > 200 then
    raise exception 'P0C3_BATCH_TOO_LARGE' using errcode = '22023';
  end if;
  for row_payload in
    select value from pg_catalog.jsonb_array_elements(p_rows)
  loop
    if pg_catalog.jsonb_typeof(row_payload) <> 'object' then
      raise exception 'P0C3_ROW_OBJECT_REQUIRED' using errcode = '22023';
    end if;

    select key into unknown_field
    from pg_catalog.jsonb_object_keys(row_payload) as key
    where key <> all(array[
      'local_id',
      'repair_order_id',
      'number',
      'title',
      'vehicle_area',
      'type',
      'status',
      'include_in_planning',
      'expert_approved',
      'client_approved',
      'estimate_number',
      'or_number',
      'amount',
      'source_file',
      'created_at',
      'updated_at'
    ]::text[])
    limit 1;

    if unknown_field is not null then
      raise exception 'P0C3_UNKNOWN_CLAIM_FIELD: %', unknown_field
        using errcode = '22023';
    end if;

    local_id_value := nullif(pg_catalog.btrim(row_payload ->> 'local_id'), '');
    if local_id_value is null then
      raise exception 'P0C3_LOCAL_ID_REQUIRED' using errcode = '22023';
    end if;

    if pg_catalog.length(local_id_value) > 300 then
      raise exception 'P0C3_LOCAL_ID_TOO_LONG' using errcode = '22023';
    end if;

    repair_order_id_value := public.nimr_try_uuid(row_payload ->> 'repair_order_id');
    if row_payload ? 'repair_order_id'
       and nullif(pg_catalog.btrim(row_payload ->> 'repair_order_id'), '') is not null
       and repair_order_id_value is null then
      raise exception 'P0C3_INVALID_REPAIR_ORDER_ID' using errcode = '22023';
    end if;

    type_value := coalesce(
      nullif(pg_catalog.btrim(row_payload ->> 'type'), ''),
      'assurance'
    );
    if type_value <> all(array[
      'assurance', 'client', 'vidange', 'mechanical_client',
      'electrical_client', 'diagnostic', 'garantie'
    ]::text[]) then
      raise exception 'P0C3_INVALID_CLAIM_TYPE' using errcode = '22023';
    end if;

    status_value := coalesce(
      nullif(pg_catalog.btrim(row_payload ->> 'status'), ''),
      'draft'
    );
    if status_value <> all(array[
      'draft', 'expert_pending', 'client_pending', 'approved',
      'refused', 'planned', 'done'
    ]::text[]) then
      raise exception 'P0C3_INVALID_CLAIM_STATUS' using errcode = '22023';
    end if;
    include_value := coalesce((row_payload ->> 'include_in_planning')::boolean, true);
    expert_value := coalesce((row_payload ->> 'expert_approved')::boolean, false);
    client_value := coalesce((row_payload ->> 'client_approved')::boolean, false);
    amount_value := nullif(row_payload ->> 'amount', '')::numeric;
    created_at_value := public.nimr_try_timestamptz(row_payload ->> 'created_at');

    select *
    into existing_row
    from public.repair_claims
    where workshop_id = p_workshop_id
      and local_id = local_id_value
    for update;

    if found then
      if existing_row.repair_order_id is distinct from repair_order_id_value then
        raise exception 'P0C3_CLAIM_ORDER_IMMUTABLE' using errcode = '42501';
      end if;
      if existing_row.type is distinct from type_value then
        raise exception 'P0C3_CLAIM_TYPE_IMMUTABLE' using errcode = '42501';
      end if;
      if existing_row.status is distinct from status_value then
        raise exception 'P0C3_STATUS_CHANGE_FORBIDDEN' using errcode = '42501';
      end if;
      if existing_row.expert_approved is distinct from expert_value then
        raise exception 'P0C3_EXPERT_APPROVAL_CHANGE_FORBIDDEN' using errcode = '42501';
      end if;
      if existing_row.client_approved is distinct from client_value then
        raise exception 'P0C3_CLIENT_APPROVAL_CHANGE_FORBIDDEN' using errcode = '42501';
      end if;

      update public.repair_claims
      set
        number = row_payload ->> 'number',
        title = coalesce(
          nullif(pg_catalog.btrim(row_payload ->> 'title'), ''),
          existing_row.title
        ),
        vehicle_area = row_payload ->> 'vehicle_area',
        include_in_planning = include_value,
        estimate_number = row_payload ->> 'estimate_number',
        or_number = row_payload ->> 'or_number',
        amount = amount_value,
        source_file = row_payload -> 'source_file'
      where id = existing_row.id
        and workshop_id = p_workshop_id
      returning id into claim_id_value;
    else
      if status_value <> 'draft' or expert_value or client_value then
        raise exception 'P0C3_NEW_CLAIM_AUTHORITY_FORBIDDEN' using errcode = '42501';
      end if;

      insert into public.repair_claims (
        workshop_id,
        local_id,
        repair_order_id,
        number,
        title,
        vehicle_area,
        type,
        status,
        include_in_planning,
        expert_approved,
        client_approved,
        estimate_number,
        or_number,
        amount,
        source_file,
        created_at
      ) values (
        p_workshop_id,
        local_id_value,
        repair_order_id_value,
        row_payload ->> 'number',
        coalesce(
          nullif(pg_catalog.btrim(row_payload ->> 'title'), ''),
          'Ordre'
        ),
        row_payload ->> 'vehicle_area',
        type_value,
        'draft',
        include_value,
        false,
        false,
        row_payload ->> 'estimate_number',
        row_payload ->> 'or_number',
        amount_value,
        row_payload -> 'source_file',
        coalesce(created_at_value, pg_catalog.clock_timestamp())
      )
      returning id into claim_id_value;
    end if;

    result_rows := result_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', claim_id_value,
        'local_id', local_id_value
      )
    );
  end loop;

  return pg_catalog.jsonb_build_object('rows', result_rows);
end
$p0c3$;
revoke all on function public.nimr_upsert_legacy_repair_claims(uuid, jsonb) from public;
revoke all on function public.nimr_upsert_legacy_repair_claims(uuid, jsonb) from anon;
grant execute on function public.nimr_upsert_legacy_repair_claims(uuid, jsonb) to authenticated;

revoke insert, update, delete on table public.repair_claims from authenticated;
revoke insert, update, delete on table public.repair_claims from anon;
grant select on table public.repair_claims to authenticated;

comment on function public.nimr_upsert_legacy_repair_claims(uuid, jsonb) is
  'KHA-76 P0c.3 bounded legacy repair_claims projection. Future authority fields are not accepted.';

commit;
