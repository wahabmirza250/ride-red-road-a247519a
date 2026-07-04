
-- Add avatar_url to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Storage policies for the avatars bucket (bucket itself created via tool)
DO $$ BEGIN
  CREATE POLICY "avatars public read" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "avatars owner upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "avatars owner update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "avatars admin write" ON storage.objects
    FOR ALL TO authenticated
    USING (bucket_id = 'avatars' AND public.has_role(auth.uid(),'admin'))
    WITH CHECK (bucket_id = 'avatars' AND public.has_role(auth.uid(),'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
