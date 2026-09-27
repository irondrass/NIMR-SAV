-- QC-GATE0 legacy quality RPC cutover
--
-- V3 becomes the sole authenticated QC decision authority.
-- No table, trigger or application runtime change.

begin;

set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
declare
  v3 regprocedure;
begin
  if to_regprocedure(
    'public.nimr_apply_quality_review_v1(uuid,text,text,text,text)'
  ) is null then
    raise exception 'QC_GATE0_LEGACY_CUTOVER: public V1 missing'
      using errcode='55000';
  end if;

  if to_regprocedure(
    'nimr_internal.nimr_apply_quality_review_v1(uuid,text,text,text,text)'
  ) is null then
    raise exception 'QC_GATE0_LEGACY_CUTOVER: internal V1 missing'
      using errcode='55000';
  end if;

  if to_regprocedure(
    'public.nimr_apply_quality_review_v2(uuid,text,text,text,text,bigint)'
  ) is null then
    raise exception 'QC_GATE0_LEGACY_CUTOVER: public V2 missing'
      using errcode='55000';
  end if;

  if to_regprocedure(
    'nimr_internal.nimr_apply_quality_review_v2(uuid,text,text,text,text,bigint)'
  ) is null then
    raise exception 'QC_GATE0_LEGACY_CUTOVER: internal V2 missing'
      using errcode='55000';
  end if;

  v3 := to_regprocedure(
    'public.nimr_apply_quality_review_v3(uuid,text,text,text,text,jsonb,text,bigint)'
  );

  if v3 is null then
    raise exception 'QC_GATE0_LEGACY_CUTOVER: canonical V3 missing'
      using errcode='55000';
  end if;

  if not has_function_privilege(
    'authenticated',
    v3,
    'EXECUTE'
  ) then
    raise exception 'QC_GATE0_LEGACY_CUTOVER: canonical V3 unavailable'
      using errcode='55000';
  end if;
end
$preflight$;

revoke all on function
  public.nimr_apply_quality_review_v1(
    uuid,text,text,text,text
  )
from public, anon, authenticated;

revoke all on function
  nimr_internal.nimr_apply_quality_review_v1(
    uuid,text,text,text,text
  )
from public, anon, authenticated;

revoke all on function
  public.nimr_apply_quality_review_v2(
    uuid,text,text,text,text,bigint
  )
from public, anon, authenticated;

revoke all on function
  nimr_internal.nimr_apply_quality_review_v2(
    uuid,text,text,text,text,bigint
  )
from public, anon, authenticated;

commit;