-- VN-PART-005A — Strict donor VIN17 contract
-- SUPABASE IMPACT: LOCAL ONLY until separately authorized for live deployment.
--
-- Purpose:
--   * canonicalize donor_vin as trimmed uppercase;
--   * accept only a complete 17-character VIN;
--   * exclude I, O and Q;
--   * preserve historical rows unless donor_vin is explicitly written again;
--   * avoid a table-wide CHECK constraint that could invalidate legacy data.

begin;

create or replace function public.nimr_validate_vn_part_donor_vin17()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  -- Donor VIN is assigned later in the approval workflow.
  -- NULL/empty remains permitted until that business step.
  if new.donor_vin is null or trim(new.donor_vin) = '' then
    return new;
  end if;

  new.donor_vin := upper(trim(new.donor_vin));

  if new.donor_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then
    raise exception using
      errcode = '22023',
      message = 'INVALID_DONOR_VIN',
      detail = 'Le VIN donneur doit contenir exactement 17 caractères valides et ne peut pas contenir I, O ou Q.',
      hint = 'Saisir le VIN complet à 17 caractères du véhicule donneur.';
  end if;

  return new;
end;
$fn$;

drop trigger if exists nimr_vn_part_donor_vin17_guard
on public.vn_part_removals;

create trigger nimr_vn_part_donor_vin17_guard
before insert or update of donor_vin on public.vn_part_removals
for each row
execute function public.nimr_validate_vn_part_donor_vin17();

notify pgrst, 'reload schema';

commit;