CREATE TABLE public.trip_destination_classifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  destination_text TEXT,
  status TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0,
  summary TEXT,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  matched JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  classifier_version TEXT NOT NULL,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX trip_destination_classifications_trip_version_key
  ON public.trip_destination_classifications (trip_id, classifier_version);
CREATE INDEX trip_destination_classifications_company_status_idx
  ON public.trip_destination_classifications (company_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_destination_classifications TO authenticated;
GRANT ALL ON public.trip_destination_classifications TO service_role;
ALTER TABLE public.trip_destination_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing staff read own company classifications"
  ON public.trip_destination_classifications FOR SELECT TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));
CREATE POLICY "billing staff write own company classifications"
  ON public.trip_destination_classifications FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_bill() AND (company_id IS NULL OR company_id = public.current_user_company_id() OR public.owner_unscoped()));
CREATE POLICY "billing staff update own company classifications"
  ON public.trip_destination_classifications FOR UPDATE TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));

CREATE TRIGGER trip_destination_classifications_stamp_company
  BEFORE INSERT ON public.trip_destination_classifications
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER trip_destination_classifications_updated_at
  BEFORE UPDATE ON public.trip_destination_classifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.destination_review_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES public.medicaid_trips(id) ON DELETE CASCADE,
  billing_record_id UUID REFERENCES public.billing_records(id) ON DELETE CASCADE,
  classification_id UUID REFERENCES public.trip_destination_classifications(id) ON DELETE SET NULL,
  original_status TEXT NOT NULL,
  original_summary TEXT,
  note TEXT,
  overridden_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX destination_review_overrides_trip_idx ON public.destination_review_overrides (trip_id);
CREATE INDEX destination_review_overrides_company_idx ON public.destination_review_overrides (company_id, created_at DESC);

GRANT SELECT, INSERT ON public.destination_review_overrides TO authenticated;
GRANT ALL ON public.destination_review_overrides TO service_role;
ALTER TABLE public.destination_review_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing staff read own company overrides"
  ON public.destination_review_overrides FOR SELECT TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));
CREATE POLICY "billing staff create own company overrides"
  ON public.destination_review_overrides FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_bill() AND (company_id IS NULL OR company_id = public.current_user_company_id() OR public.owner_unscoped()));

CREATE TRIGGER destination_review_overrides_stamp_company
  BEFORE INSERT ON public.destination_review_overrides
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();

CREATE TABLE public.destination_place_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  normalized_key TEXT NOT NULL,
  address TEXT,
  place JSONB,
  nearby JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider TEXT,
  lookup_ok BOOLEAN NOT NULL DEFAULT true,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX destination_place_cache_company_key
  ON public.destination_place_cache (company_id, normalized_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.destination_place_cache TO authenticated;
GRANT ALL ON public.destination_place_cache TO service_role;
ALTER TABLE public.destination_place_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing staff read own company place cache"
  ON public.destination_place_cache FOR SELECT TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));
CREATE POLICY "billing staff write own company place cache"
  ON public.destination_place_cache FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_bill() AND (company_id IS NULL OR company_id = public.current_user_company_id() OR public.owner_unscoped()));
CREATE POLICY "billing staff update own company place cache"
  ON public.destination_place_cache FOR UPDATE TO authenticated
  USING (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()))
  WITH CHECK (public.current_user_can_bill() AND (public.owner_unscoped() OR company_id = public.current_user_company_id()));

CREATE TRIGGER destination_place_cache_stamp_company
  BEFORE INSERT ON public.destination_place_cache
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_id();
CREATE TRIGGER destination_place_cache_updated_at
  BEFORE UPDATE ON public.destination_place_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();