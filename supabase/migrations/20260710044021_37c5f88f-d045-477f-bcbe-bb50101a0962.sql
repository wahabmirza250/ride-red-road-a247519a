
CREATE TABLE public.billing_rate_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('ambulatory','wheelchair_van')),
  procedure_code text NOT NULL,
  charge_amount numeric(10,2) NOT NULL,
  unit_type text NOT NULL CHECK (unit_type IN ('trip','mile')),
  place_of_service text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, vehicle_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_rate_settings TO authenticated;
GRANT ALL ON public.billing_rate_settings TO service_role;

ALTER TABLE public.billing_rate_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all billing rate settings"
  ON public.billing_rate_settings
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_billing_rate_settings_updated_at
  BEFORE UPDATE ON public.billing_rate_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
