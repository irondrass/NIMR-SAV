-- P1-002 follow-up: remove anonymous execution from SECURITY DEFINER
-- workshop authorization helpers. Authenticated access remains intentional
-- because these helpers are used by RLS and authenticated RPC boundaries.

begin;

revoke execute
on function public.nimr_current_resource_id(uuid)
from anon;

revoke execute
on function public.nimr_current_workshop_role(uuid)
from anon;

revoke execute
on function public.nimr_has_workshop_role(uuid, text[])
from anon;

revoke execute
on function public.nimr_is_workshop_member(uuid)
from anon;

notify pgrst, 'reload schema';

commit;
