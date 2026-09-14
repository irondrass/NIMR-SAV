-- ============================================================================
-- NIMR-SAV — Migration: VN-PART-004 Donor Intelligence & Restoration ETA
-- Timestamp: 20260913130207
--
-- Adds:
--   1. Normalized expression index on public.vn_part_removals:
--      (workshop_id, upper(trim(donor_vin))) where donor_vin is not null and trim(donor_vin) <> ''
--   2. Authoritative read-only view: public.vn_part_donor_commitment_v1
--      Groups by (workshop_id, upper(trim(donor_vin)))
--      Aggregates open commitments (planned + physical), distinguishing physical
--      readiness (can_be_restored_today) from projected full restoration date.
--   3. Explicit least-privilege security invoker grants.
--
-- Semantics preserved:
--   - public.vn_part_donor_state_v1 is UNTOUCHED.
--   - nimr_apply_vn_part_action_v1 is UNTOUCHED.
--   - No unique constraint on donor_vin (multiple removals per donor allowed).
-- ============================================================================

begin;

-- 1. Expression Index for Fast Normalized Donor Lookup
create index if not exists idx_vn_part_removals_donor_norm
on public.vn_part_removals (
  workshop_id,
  upper(trim(donor_vin))
)
where donor_vin is not null
  and trim(donor_vin) <> '';

-- 2. New Comprehensive Read-Only View: public.vn_part_donor_commitment_v1
create or replace view public.vn_part_donor_commitment_v1
with (security_invoker = true)
as
select
  r.workshop_id,
  upper(trim(r.donor_vin)) as donor_vin_normalized,
  (array_agg(r.donor_vin order by r.updated_at desc nulls last) filter (where r.donor_vin is not null and trim(r.donor_vin) <> ''))[1] as donor_vin,
  (array_agg(r.donor_model order by r.updated_at desc nulls last) filter (where r.donor_model is not null and trim(r.donor_model) <> ''))[1] as donor_model,
  (array_agg(r.donor_location order by r.updated_at desc nulls last) filter (where r.donor_location is not null and trim(r.donor_location) <> ''))[1] as donor_location,
  count(distinct nullif(trim(r.donor_model), '')) as donor_model_variant_count,
  count(distinct nullif(trim(r.donor_location), '')) as donor_location_variant_count,

  -- Total open commitments (both planned and physical, non-terminal, un-restored)
  count(*) filter (
    where r.status not in ('REFUSE', 'ANNULE', 'CLOTURE')
      and r.restored_at is null
  ) as open_commitment_count,

  -- Planned commitments (donor assigned, not yet physically removed)
  count(*) filter (
    where r.status in ('EN_ATTENTE_VALIDATIONS', 'AUTORISE_A_PRELEVER')
      and r.removed_at is null
      and r.restored_at is null
  ) as planned_removal_count,

  -- Physical open removals (physically removed, not yet restored)
  count(*) filter (
    where r.removed_at is not null
      and r.restored_at is null
  ) as physical_open_removal_count,

  -- Physical removals waiting for replacement arrival
  count(*) filter (
    where r.removed_at is not null
      and r.restored_at is null
      and r.replacement_available_at is null
  ) as physical_waiting_replacement_count,

  -- Physical removals with replacement piece available in store
  count(*) filter (
    where r.removed_at is not null
      and r.restored_at is null
      and r.replacement_available_at is not null
  ) as physical_replacement_available_count,

  -- Missing ETA count among open commitments still needing replacement
  count(*) filter (
    where r.status not in ('REFUSE', 'ANNULE', 'CLOTURE')
      and r.restored_at is null
      and r.replacement_available_at is null
      and r.expected_replacement_date is null
  ) as eta_missing_count,

  -- Closest known ETA across open commitments still needing replacement (MIN)
  min(r.expected_replacement_date) filter (
    where r.status not in ('REFUSE', 'ANNULE', 'CLOTURE')
      and r.restored_at is null
      and r.replacement_available_at is null
  ) as next_expected_replacement_date,

  -- Projected full restoration ETA across open commitments still needing replacement (MAX)
  max(r.expected_replacement_date) filter (
    where r.status not in ('REFUSE', 'ANNULE', 'CLOTURE')
      and r.restored_at is null
      and r.replacement_available_at is null
  ) as estimated_full_restoration_date,

  -- Overdue commitments (ETA past current_date and replacement not yet available)
  count(*) filter (
    where r.status not in ('REFUSE', 'ANNULE', 'CLOTURE')
      and r.restored_at is null
      and r.replacement_available_at is null
      and r.expected_replacement_date is not null
      and r.expected_replacement_date < current_date
  ) as overdue_count,

  -- Physical readiness: physically incomplete donor can be restored today if ALL physically removed pieces have replacements available
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
  ) as can_be_restored_today

from public.vn_part_removals r
where r.donor_vin is not null and trim(r.donor_vin) <> ''
group by r.workshop_id, upper(trim(r.donor_vin));

-- 3. Explicit Least-Privilege Reset & Grants
revoke all privileges on table public.vn_part_donor_commitment_v1 from public, anon, authenticated;
grant select on table public.vn_part_donor_commitment_v1 to authenticated;

notify pgrst, 'reload schema';
commit;