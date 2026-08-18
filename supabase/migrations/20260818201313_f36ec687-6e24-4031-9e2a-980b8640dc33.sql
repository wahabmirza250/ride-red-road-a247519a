CREATE OR REPLACE FUNCTION public.bump_staff_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.staff_conversations
     SET last_message_at = NEW.created_at, updated_at = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;