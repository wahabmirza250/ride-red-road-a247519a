
-- Chat system: 3-way (driver↔admin, passenger↔admin, driver↔passenger during active trip)
-- and passenger self-signup wiring.

-- 1) Update handle_new_user so signups with role='passenger' also get a passengers row
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _role public.app_role;
  _existing_admins INTEGER;
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT COUNT(*) INTO _existing_admins FROM public.user_roles WHERE role = 'admin';

  IF _existing_admins = 0 THEN
    _role := 'admin';
  ELSE
    _role := COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'passenger');
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Auto-create passenger row for self-signups so they can be found in dispatch
  IF _role = 'passenger' THEN
    INSERT INTO public.passengers (user_id, first_name, last_name, email, phone, medicaid_id)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'phone', ''),
      'SELF-' || substr(NEW.id::text, 1, 8)
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Chat tables
CREATE TABLE public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('driver_admin','passenger_admin','driver_passenger')),
  driver_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  passenger_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chat_conversations_driver_admin_uniq
  ON public.chat_conversations (driver_user_id)
  WHERE kind = 'driver_admin';

CREATE UNIQUE INDEX chat_conversations_passenger_admin_uniq
  ON public.chat_conversations (passenger_user_id)
  WHERE kind = 'passenger_admin';

CREATE UNIQUE INDEX chat_conversations_trip_uniq
  ON public.chat_conversations (trip_id)
  WHERE kind = 'driver_passenger' AND trip_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants and admins can view conversations"
  ON public.chat_conversations FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR driver_user_id = auth.uid()
    OR passenger_user_id = auth.uid()
  );

CREATE POLICY "Participants can create their conversations"
  ON public.chat_conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR driver_user_id = auth.uid()
    OR passenger_user_id = auth.uid()
  );

CREATE POLICY "Admins can update conversations"
  ON public.chat_conversations FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER chat_conversations_updated_at
  BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_conv_created_idx
  ON public.chat_messages (conversation_id, created_at);

GRANT SELECT, INSERT, UPDATE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants and admins can view messages"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id
        AND (
          public.has_role(auth.uid(),'admin')
          OR c.driver_user_id = auth.uid()
          OR c.passenger_user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Participants and admins can send messages"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id
        AND (c.is_closed = false OR public.has_role(auth.uid(),'admin'))
        AND (
          public.has_role(auth.uid(),'admin')
          OR c.driver_user_id = auth.uid()
          OR c.passenger_user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Recipients can mark messages read"
  ON public.chat_messages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = conversation_id
        AND (
          public.has_role(auth.uid(),'admin')
          OR c.driver_user_id = auth.uid()
          OR c.passenger_user_id = auth.uid()
        )
    )
  )
  WITH CHECK (true);

-- Bump conversation last_message_at + auto-open on new message
CREATE OR REPLACE FUNCTION public.bump_chat_conversation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.chat_conversations
     SET last_message_at = NEW.created_at,
         updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_messages_bump
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_chat_conversation();

-- 3) Auto driver↔passenger conversation on active trip
CREATE OR REPLACE FUNCTION public.sync_trip_chat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _driver_user UUID;
  _passenger_user UUID;
BEGIN
  IF NEW.status = 'in_progress' AND (OLD.status IS DISTINCT FROM 'in_progress') THEN
    SELECT user_id INTO _driver_user FROM public.drivers WHERE id = NEW.driver_id;
    SELECT user_id INTO _passenger_user FROM public.passengers WHERE id = NEW.passenger_id;
    IF _driver_user IS NOT NULL AND _passenger_user IS NOT NULL THEN
      INSERT INTO public.chat_conversations
        (kind, driver_user_id, passenger_user_id, trip_id, is_closed)
      VALUES ('driver_passenger', _driver_user, _passenger_user, NEW.id, false)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF NEW.status IN ('completed','cancelled') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.chat_conversations
       SET is_closed = true
     WHERE trip_id = NEW.id AND kind = 'driver_passenger';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trips_sync_chat
  AFTER UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.sync_trip_chat();

-- 4) Enable Realtime for chat tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
