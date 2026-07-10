
DROP POLICY IF EXISTS "Recipients can mark messages read" ON public.chat_messages;
CREATE POLICY "Recipients can mark messages read"
  ON public.chat_messages
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = chat_messages.conversation_id
        AND (
          public.has_role(auth.uid(), 'admin'::app_role)
          OR c.driver_user_id = auth.uid()
          OR c.passenger_user_id = auth.uid()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_conversations c
      WHERE c.id = chat_messages.conversation_id
        AND (
          public.has_role(auth.uid(), 'admin'::app_role)
          OR c.driver_user_id = auth.uid()
          OR c.passenger_user_id = auth.uid()
        )
    )
  );
