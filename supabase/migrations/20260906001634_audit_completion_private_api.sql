-- Audit F01/F04/F19: preserve endpoint signatures, OIDs of policy dependencies,
-- existing role checks and exact caller grants; no customer payload rewrite.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
create schema if not exists nimr_internal;
revoke all on schema nimr_internal from public, anon;
grant usage on schema nimr_internal to authenticated, service_role;

-- Move reviewed implementations out of the exposed schema. SQL invoker wrappers
-- keep the API stable. Internal role lookups still use auth.uid(), never metadata.
set local search_path = pg_catalog;
do $migration$
declare r record; positional_args text; wrapper_body text;
begin
  for r in select p.oid, p.proname, p.pronargs, p.provolatile,
      pg_get_function_identity_arguments(p.oid) identity_args,
      pg_get_function_arguments(p.oid) definition_args,
      pg_get_function_result(p.oid) result_type,
      has_function_privilege('authenticated',p.oid,'execute') authenticated_allowed,
      has_function_privilege('service_role',p.oid,'execute') service_allowed
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef and p.proname = any(array[
      'nimr_apply_quality_review_v1','nimr_apply_sync_entity_v2','nimr_apply_workshop_settings_v2',
      'nimr_current_resource_id','nimr_current_workshop_role','nimr_has_workshop_role',
      'nimr_is_workshop_member','nimr_reserve_planning_atomic','nimr_reserve_planning_slots',
      'nimr_resolve_sync_entity_conflict'])
  loop
    select string_agg('$'||i::text,',' order by i) into positional_args from generate_series(1,r.pronargs) i;
    if to_regprocedure(format('nimr_internal.%I(%s)',r.proname,r.identity_args)) is null then
      execute format('alter function public.%I(%s) set schema nimr_internal',r.proname,r.identity_args);
    else
      -- An earlier migration may have recreated a public implementation.
      -- Refresh the private body without breaking its existing policy OID.
      execute replace(pg_get_functiondef(r.oid),'FUNCTION public.','FUNCTION nimr_internal.');
    end if;
    wrapper_body := format('select * from nimr_internal.%I(%s)',r.proname,coalesce(positional_args,''));
    execute format('create or replace function public.%I(%s) returns %s language sql %s security invoker set search_path=pg_catalog as %L',
      r.proname,r.definition_args,r.result_type,
      case r.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end,wrapper_body);
    execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role',r.proname,r.identity_args);
    execute format('revoke all on function nimr_internal.%I(%s) from public,anon',r.proname,r.identity_args);
    if r.authenticated_allowed then execute format('grant execute on function public.%I(%s) to authenticated',r.proname,r.identity_args); end if;
    if r.service_allowed then execute format('grant execute on function public.%I(%s) to service_role',r.proname,r.identity_args); end if;
  end loop;
end;
$migration$;

-- Relocation preserves existing GiST operator-class OIDs and exclusion constraints.
create schema if not exists extensions;
do $extension$
begin
  if exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
      where e.extname='btree_gist' and n.nspname='public' and e.extrelocatable) then
    alter extension btree_gist set schema extensions;
  end if;
end;
$extension$;

-- Cover foreign-key lookups reported by Advisor. Retain existing useful indexes,
-- including those with no reads yet on this small production database.
do $indexes$
declare r record;
begin
  for r in select c.conrelid, c.conname, t.relname,
      (select string_agg(quote_ident(a.attname),',' order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum,ordinality)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum) columns_sql
    from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and n.nspname='public' and not exists(
      select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid and i.indisready
        and i.indpred is null and i.indnkeyatts>=array_length(c.conkey,1)
        and c.conkey <@ (i.indkey::smallint[])[0:array_length(c.conkey,1)-1])
  loop
    execute format('create index if not exists %I on public.%I (%s)',
      'nimr_fk_'||substr(md5(r.relname||':'||r.conname),1,20),r.relname,r.columns_sql);
  end loop;
end;
$indexes$;

create or replace function public.nimr_guard_client_commitment()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public
as $guard$
declare previous jsonb := '{}'::jsonb; changed boolean; deciding boolean;
begin
  if new.entity_type <> 'case' then return new; end if;
  if tg_op='UPDATE' then previous:=coalesce(old.payload,'{}'::jsonb); end if;
  if new.deleted_at is not null then
    if auth.uid() is not null and not public.nimr_has_workshop_role(new.workshop_id,array['admin_technique','directeur','chef_atelier','reception']) then
      raise exception 'case deletion access denied' using errcode='42501';
    end if;
    return new;
  end if;
  changed := exists(select 1 from unnest(array['promisedAt','nextContactAt','lastContactAt','note']) k
      where coalesce(new.payload #>> array['clientCommitment',k],'') <> coalesce(previous #>> array['clientCommitment',k],''))
    or exists(select 1 from unnest(array['ownerId','dueAt','note']) k
      where coalesce(new.payload #>> array['exceptionFollowup',k],'') <> coalesce(previous #>> array['exceptionFollowup',k],''))
    or coalesce(new.payload #>> '{flags,received}','false') <> coalesce(previous #>> '{flags,received}','false');
  if changed and auth.uid() is not null and not public.nimr_has_workshop_role(new.workshop_id,array['admin_technique','directeur','chef_atelier','reception']) then
    raise exception 'client commitment or reception access denied' using errcode='42501';
  end if;
  deciding := (new.payload #>> '{flags,delivered}'='true' and previous #>> '{flags,delivered}' is distinct from 'true')
    or (new.payload #>> '{flags,qualityApproved}'='true' and previous #>> '{flags,qualityApproved}' is distinct from 'true');
  if deciding and exists(select 1 from public.sync_entities b where b.workshop_id=new.workshop_id
      and b.entity_type='booking' and b.deleted_at is null and b.payload->>'caseId'=new.entity_id
      and coalesce(b.payload->>'type','work') <> 'leave'
      and coalesce(b.payload->>'status','planned') not in ('completed','done')
      and coalesce(b.payload->>'temporary','false') <> 'true') then
    raise exception 'Des opérations partagées restent à terminer avant le contrôle ou la remise.' using errcode='23514';
  end if;
  return new;
end;
$guard$;
revoke all on function public.nimr_guard_client_commitment() from public,anon,authenticated;
drop trigger if exists nimr_client_commitment_guard on public.sync_entities;
create trigger nimr_client_commitment_guard after insert or update on public.sync_entities
for each row execute function public.nimr_guard_client_commitment();
notify pgrst,'reload schema';
commit;
