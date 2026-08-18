CREATE TABLE public.staff_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  member_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_conversations_distinct_members CHECK (member_a <> member_b)
);

CREATE UNIQUE INDEX staff_conversations_pair_idx
  ON public.staff_conversations (company_id, LEAST(member_a, member_b), GREATEST(member_a, member_b));

CREATE TABLE public.staff_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.staff_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX staff_messages_conversation_idx ON public.staff_messages (conversation_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_conversations TO authenticated;
GRANT ALL ON public.staff_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.staff_messages TO authenticated;
GRANT ALL ON public.staff_messages TO service_role;

ALTER TABLE public.staff_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_staff_conversation_member(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_conversations c
    WHERE c.id = _conversation_id
      AND auth.uid() IN (c.member_a, c.member_b)
  )
$$;

CREATE POLICY "Members can view their staff conversations"
  ON public.staff_conversations FOR SELECT TO authenticated
  USING (auth.uid() IN (member_a, member_b));

CREATE POLICY "Billing staff can start a conversation they are in"
  ON public.staff_conversations FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IN (member_a, member_b)
    AND public.current_user_can_bill()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "Members can view their staff messages"
  ON public.staff_messages FOR SELECT TO authenticated
  USING (public.is_staff_conversation_member(conversation_id));

CREATE POLICY "Members can send staff messages"
  ON public.staff_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.is_staff_conversation_member(conversation_id));

CREATE POLICY "Members can mark staff messages read"
  ON public.staff_messages FOR UPDATE TO authenticated
  USING (public.is_staff_conversation_member(conversation_id))
  WITH CHECK (public.is_staff_conversation_member(conversation_id));

CREATE OR REPLACE FUNCTION public.bump_staff_conversation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.staff_conversations
     SET last_message_at = NEW.created_at, updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER staff_messages_bump
AFTER INSERT ON public.staff_messages
FOR EACH ROW EXECUTE FUNCTION public.bump_staff_conversation();

CREATE TRIGGER staff_conversations_set_updated_at
BEFORE UPDATE ON public.staff_conversations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();