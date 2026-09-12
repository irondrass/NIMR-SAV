-- ===========================================================================
-- NIMR SAV — VN-PART-001: Canonical Roles & Identity Parity
-- Foundation for VN-PART module: directeur_pieces, responsable_magasin, responsable_garantie_support, responsable_qualite_parc_vn
-- Additive, idempotent, non-destructive migration.
-- UNEXECUTED: Local preparation only. Awaiting deployment authorization gate.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Alignement des rôles canoniques serveur avec le frontend (11 rôles)
-- ---------------------------------------------------------------------------

create or replace function public.nimr_canonical_role(input_role text)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $nimr$
  select case regexp_replace(lower(trim(coalesce(input_role, ''))), '[^a-z0-9]+', '_', 'g')
    when 'admin' then 'admin_technique'
    when 'admin_technique' then 'admin_technique'
    when 'directeur' then 'directeur'
    when 'directeur_sav' then 'directeur'
    when 'chef_atelier' then 'chef_atelier'
    when 'reception' then 'reception'
    when 'receptionnaire' then 'reception'
    when 'technicien' then 'technicien'
    when 'technician' then 'technicien'
    when 'controle_qualite' then 'controle_qualite'
    when 'controleur_qualite' then 'controle_qualite'
    when 'quality_controller' then 'controle_qualite'
    when 'qualite' then 'controle_qualite'
    when 'lecture_seule' then 'lecture_seule'
    when 'readonly' then 'lecture_seule'
    when 'member' then 'lecture_seule'
    -- Nouveaux rôles canoniques VN-PART (Phase 1)
    when 'directeur_pieces' then 'directeur_pieces'
    when 'directeur_piece' then 'directeur_pieces'
    when 'directeur_des_pieces' then 'directeur_pieces'
    when 'responsable_magasin' then 'responsable_magasin'
    when 'magasin' then 'responsable_magasin'
    when 'magasinier' then 'responsable_magasin'
    when 'responsable_garantie_support' then 'responsable_garantie_support'
    when 'responsable_garantie' then 'responsable_garantie_support'
    when 'garantie_support' then 'responsable_garantie_support'
    when 'garantie' then 'responsable_garantie_support'
    when 'responsable_qualite_parc_vn' then 'responsable_qualite_parc_vn'
    when 'responsable_qualite_vn' then 'responsable_qualite_parc_vn'
    when 'chef_parc_vn' then 'responsable_qualite_parc_vn'
    when 'chef_de_parc_vn' then 'responsable_qualite_parc_vn'
    else null
  end
$nimr$;

-- ---------------------------------------------------------------------------
-- 2. Recréation de la contrainte canonique workshop_members (11 rôles)
-- ---------------------------------------------------------------------------

alter table public.workshop_members
  drop constraint if exists workshop_members_role_canonical_check;

alter table public.workshop_members
  add constraint workshop_members_role_canonical_check
  check (role in (
    'admin_technique',
    'directeur',
    'chef_atelier',
    'reception',
    'technicien',
    'controle_qualite',
    'lecture_seule',
    'directeur_pieces',
    'responsable_magasin',
    'responsable_garantie_support',
    'responsable_qualite_parc_vn'
  )) not valid;

do $nimr$
begin
  if not exists (
    select 1 from public.workshop_members
    where role not in (
      'admin_technique',
      'directeur',
      'chef_atelier',
      'reception',
      'technicien',
      'controle_qualite',
      'lecture_seule',
      'directeur_pieces',
      'responsable_magasin',
      'responsable_garantie_support',
      'responsable_qualite_parc_vn'
    )
  ) then
    alter table public.workshop_members
      validate constraint workshop_members_role_canonical_check;
  end if;
end
$nimr$;

commit;
