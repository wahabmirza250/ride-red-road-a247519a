CREATE TABLE public.robot_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.robot_api_keys TO authenticated;
GRANT ALL ON public.robot_api_keys TO service_role;

ALTER TABLE public.robot_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage robot api keys"
ON public.robot_api_keys
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_robot_api_keys_active ON public.robot_api_keys (is_active) WHERE is_active = true;