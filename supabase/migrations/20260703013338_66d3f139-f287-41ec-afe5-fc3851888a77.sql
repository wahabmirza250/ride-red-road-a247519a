
-- Storage policies for games bucket (thumbnails)
CREATE POLICY "games read all authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'games');

CREATE POLICY "games admin write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'games' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "games admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'games' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "games admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'games' AND public.has_role(auth.uid(), 'admin'));

-- Auto-create drivers row when a user is assigned the 'driver' role
CREATE OR REPLACE FUNCTION public.ensure_driver_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'driver' THEN
    INSERT INTO public.drivers (user_id, status)
    VALUES (NEW.user_id, 'offline')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_driver_row ON public.user_roles;
CREATE TRIGGER trg_ensure_driver_row
  AFTER INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.ensure_driver_row();

-- Backfill: create driver rows for any existing users with driver role but no drivers row
INSERT INTO public.drivers (user_id, status)
SELECT ur.user_id, 'offline'
FROM public.user_roles ur
LEFT JOIN public.drivers d ON d.user_id = ur.user_id
WHERE ur.role = 'driver' AND d.id IS NULL;
