GRANT EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;