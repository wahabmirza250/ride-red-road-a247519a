-- Restrict the legacy admin-wide chat policies without granting new access.
CREATE POLICY "Company boundary for conversation access"
ON public.chat_conversations AS RESTRICTIVE FOR ALL TO authenticated
USING (driver_user_id = (select auth.uid()) OR passenger_user_id = (select auth.uid()) OR (
  (select public.current_user_company_id()) IS NOT NULL
  AND (driver_user_id IS NOT NULL OR passenger_user_id IS NOT NULL)
  AND (driver_user_id IS NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = chat_conversations.driver_user_id AND p.company_id = (select public.current_user_company_id())))
  AND (passenger_user_id IS NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = chat_conversations.passenger_user_id AND p.company_id = (select public.current_user_company_id())))
)) WITH CHECK (driver_user_id = (select auth.uid()) OR passenger_user_id = (select auth.uid()) OR (
  (select public.current_user_company_id()) IS NOT NULL
  AND (driver_user_id IS NOT NULL OR passenger_user_id IS NOT NULL)
  AND (driver_user_id IS NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = chat_conversations.driver_user_id AND p.company_id = (select public.current_user_company_id())))
  AND (passenger_user_id IS NULL OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = chat_conversations.passenger_user_id AND p.company_id = (select public.current_user_company_id())))
));
