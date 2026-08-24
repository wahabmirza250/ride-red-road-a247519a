-- 1. Per-company communications settings -------------------------------------
CREATE TABLE public.company_comm_settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'telnyx',
  sms_from_number TEXT,
  messaging_profile_id TEXT,
  sms_enabled BOOLEAN NOT NULL DEFAULT false,
  inbound_webhook_path TEXT,
  notify_bill_approved BOOLEAN NOT NULL DEFAULT false,
  notify_bill_rejected BOOLEAN NOT NULL DEFAULT false,
  notify_trip_assigned BOOLEAN NOT NULL DEFAULT false,
  notify_driver_arriving BOOLEAN NOT NULL DEFAULT false,
  notify_trip_reminder BOOLEAN NOT NULL DEFAULT false,
  setup_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_comm_settings_provider_check
    CHECK (provider IN ('telnyx', 'twilio', 'none'))
);

GRANT SELECT ON public.company_comm_settings TO authenticated;
GRANT ALL ON public.company_comm_settings TO service_role;
ALTER TABLE public.company_comm_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comm_settings_read_own_company"
  ON public.company_comm_settings FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id() OR public.owner_unscoped());

CREATE POLICY "comm_settings_admin_write"
  ON public.company_comm_settings FOR ALL TO authenticated
  USING (
    (company_id = public.current_user_company_id() AND public.current_user_has_role('admin'))
    OR public.owner_unscoped()
  )
  WITH CHECK (
    (company_id = public.current_user_company_id() AND public.current_user_has_role('admin'))
    OR public.owner_unscoped()
  );

CREATE TRIGGER trg_company_comm_settings_updated_at
  BEFORE UPDATE ON public.company_comm_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed one row per existing company, preserving any number already in use.
INSERT INTO public.company_comm_settings (company_id, provider, sms_from_number, sms_enabled)
SELECT c.id,
       CASE WHEN c.twilio_phone IS NOT NULL THEN 'twilio' ELSE 'telnyx' END,
       c.twilio_phone,
       c.twilio_phone IS NOT NULL
  FROM public.companies c
ON CONFLICT (company_id) DO NOTHING;

-- 2. SMS conversations (dispatch inbox threads) -------------------------------
CREATE TABLE public.sms_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_phone TEXT NOT NULL,
  our_number TEXT NOT NULL,
  passenger_id UUID REFERENCES public.passengers(id) ON DELETE SET NULL,
  contact_name TEXT,
  status TEXT NOT NULL DEFAULT 'needs_review',
  is_known_contact BOOLEAN NOT NULL DEFAULT false,
  last_message_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sms_conversations_status_check
    CHECK (status IN ('needs_review', 'open', 'closed'))
);

CREATE UNIQUE INDEX sms_conversations_company_contact_number_key
  ON public.sms_conversations (company_id, contact_phone, our_number);
CREATE INDEX sms_conversations_company_activity_idx
  ON public.sms_conversations (company_id, last_message_at DESC);

GRANT SELECT, UPDATE ON public.sms_conversations TO authenticated;
GRANT ALL ON public.sms_conversations TO service_role;
ALTER TABLE public.sms_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_conversations_read_own_company"
  ON public.sms_conversations FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id() OR public.owner_unscoped());

CREATE POLICY "sms_conversations_staff_update"
  ON public.sms_conversations FOR UPDATE TO authenticated
  USING (
    (company_id = public.current_user_company_id()
      AND (public.current_user_has_role('admin') OR public.current_user_is_dispatch()))
    OR public.owner_unscoped()
  )
  WITH CHECK (
    (company_id = public.current_user_company_id()
      AND (public.current_user_has_role('admin') OR public.current_user_is_dispatch()))
    OR public.owner_unscoped()
  );

CREATE TRIGGER trg_sms_conversations_updated_at
  BEFORE UPDATE ON public.sms_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. SMS messages -------------------------------------------------------------
CREATE TABLE public.sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.sms_conversations(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  body TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'telnyx',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  event_kind TEXT,
  sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sms_messages_direction_check CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT sms_messages_status_check
    CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'received', 'skipped'))
);

CREATE UNIQUE INDEX sms_messages_provider_message_id_key
  ON public.sms_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX sms_messages_dedupe_key_key
  ON public.sms_messages (company_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX sms_messages_conversation_idx
  ON public.sms_messages (conversation_id, created_at);
CREATE INDEX sms_messages_company_idx
  ON public.sms_messages (company_id, created_at DESC);

GRANT SELECT ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sms_messages_read_own_company"
  ON public.sms_messages FOR SELECT TO authenticated
  USING (company_id = public.current_user_company_id() OR public.owner_unscoped());

CREATE TRIGGER trg_sms_messages_updated_at
  BEFORE UPDATE ON public.sms_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Keep the thread's activity clock fresh.
CREATE OR REPLACE FUNCTION public.bump_sms_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.sms_conversations
     SET last_message_at = NEW.created_at,
         last_inbound_at = CASE WHEN NEW.direction = 'inbound' THEN NEW.created_at ELSE last_inbound_at END,
         unread_count = CASE WHEN NEW.direction = 'inbound' THEN unread_count + 1 ELSE unread_count END,
         updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sms_messages_bump_conversation
  AFTER INSERT ON public.sms_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_sms_conversation();