REVOKE EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, PUBLIC;