ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS twilio_phone text;
CREATE UNIQUE INDEX IF NOT EXISTS companies_twilio_phone_key ON public.companies (twilio_phone) WHERE twilio_phone IS NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sms_alerts_enabled boolean NOT NULL DEFAULT true;