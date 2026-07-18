
CREATE TABLE public.rewards_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT false,
  rides_required integer NOT NULL DEFAULT 15 CHECK (rides_required > 0),
  period_type text NOT NULL DEFAULT 'weekly' CHECK (period_type IN ('weekly','monthly')),
  prize_description text NOT NULL DEFAULT '$25 Gift Card',
  winners_per_period integer NOT NULL DEFAULT 1 CHECK (winners_per_period > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rewards_settings TO authenticated;
GRANT ALL ON public.rewards_settings TO service_role;
ALTER TABLE public.rewards_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings readable by authed" ON public.rewards_settings FOR SELECT TO authenticated USING (true);
INSERT INTO public.rewards_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE public.contest_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid NOT NULL REFERENCES public.passengers(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  ride_count integer NOT NULL DEFAULT 0,
  qualified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (passenger_id, period_start)
);
CREATE INDEX idx_contest_entries_period ON public.contest_entries(period_start, period_end);
GRANT SELECT ON public.contest_entries TO authenticated;
GRANT ALL ON public.contest_entries TO service_role;
ALTER TABLE public.contest_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entries own or admin" ON public.contest_entries FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.passengers p WHERE p.id = passenger_id AND p.user_id = auth.uid())
);

CREATE TABLE public.contest_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid NOT NULL REFERENCES public.passengers(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  prize_description text NOT NULL,
  selected_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  delivery_note text
);
CREATE INDEX idx_contest_winners_period ON public.contest_winners(period_start);
GRANT SELECT ON public.contest_winners TO authenticated;
GRANT ALL ON public.contest_winners TO service_role;
ALTER TABLE public.contest_winners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "winners readable by authed" ON public.contest_winners FOR SELECT TO authenticated USING (true);
