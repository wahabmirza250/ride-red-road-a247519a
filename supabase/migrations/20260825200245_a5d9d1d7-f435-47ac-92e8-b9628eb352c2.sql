DROP POLICY IF EXISTS "Authenticated users can read app settings" ON public.app_settings;
DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can write app settings" ON public.app_settings;
CREATE POLICY "Admins manage app settings"
ON public.app_settings
FOR ALL
TO authenticated
USING (current_user_has_role('admin'::public.app_role))
WITH CHECK (current_user_has_role('admin'::public.app_role));

DROP POLICY IF EXISTS "winners readable by authed" ON public.contest_winners;
CREATE POLICY "Admins or winning passenger can read winners"
ON public.contest_winners
FOR SELECT
TO authenticated
USING (
  current_user_has_role('admin'::public.app_role)
  OR EXISTS (
    SELECT 1
    FROM public.passengers p
    WHERE p.id = contest_winners.passenger_id
      AND p.user_id = auth.uid()
  )
);