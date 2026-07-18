REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_portal_credential_for_submission(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_credential_for_submission(text, uuid) TO service_role;