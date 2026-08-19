ALTER TABLE public.driver_payouts
  ADD COLUMN IF NOT EXISTS bonus_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_note text;

ALTER TABLE public.driver_claim_payouts
  ADD COLUMN IF NOT EXISTS extra_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_note text;
