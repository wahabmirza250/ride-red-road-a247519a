import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

/**
 * Renders a single conversation thread with realtime updates,
 * mark-as-read on view, and a send composer.
 */
export function ChatThread({
  conversationId,
  headerRight,
  disabled,
  disabledReason,
}: {
  conversationId: string;
  headerRight?: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const msgs = useQuery({
    queryKey: ["chat-messages", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      // mark others' messages as read
      const unread = (data ?? []).filter(
        (m) => !m.read_at && m.sender_id !== user?.id,
      );
      if (unread.length) {
        await supabase
          .from("chat_messages")
          .update({ read_at: new Date().toISOString() })
          .in(
            "id",
            unread.map((m) => m.id),
          );
        qc.invalidateQueries({ queryKey: ["chat-threads"] });
      }
      return (data ?? []) as ChatMessage[];
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.data?.length]);

  useEffect(() => {
    const ch = supabase
      .channel(`chat-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
          qc.invalidateQueries({ queryKey: ["chat-threads"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, qc]);

  const send = useMutation({
    mutationFn: async () => {
      const body = text.trim();
      if (!body || !user) return;
      const { error } = await supabase.from("chat_messages").insert({
        conversation_id: conversationId,
        sender_id: user.id,
        body,
      });
      if (error) throw error;
      setText("");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["chat-threads"] });
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {headerRight ? (
        <div className="flex items-center justify-between border-b border-border p-3">
          <div className="text-sm font-medium">Conversation</div>
          {headerRight}
        </div>
      ) : null}
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {msgs.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : msgs.data?.length ? (
          msgs.data.map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-soft",
                    mine
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-muted text-foreground",
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                  <div
                    className={cn(
                      "mt-1 text-[10px]",
                      mine ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {formatDateTime(m.created_at)}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No messages yet. Say hi.
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="flex items-center gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled) send.mutate();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? disabledReason ?? "Chat closed" : "Type a message"}
          disabled={disabled}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={disabled || !text.trim() || send.isPending}
          size="icon"
          className="rounded-full"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

/**
 * Ensures a driver_admin or passenger_admin conversation exists for the
 * current user, creating it if missing. Returns the conversation id.
 */
export async function ensureAdminConversation(
  userId: string,
  role: "driver" | "passenger",
): Promise<string> {
  const column = role === "driver" ? "driver_user_id" : "passenger_user_id";
  const kind = role === "driver" ? "driver_admin" : "passenger_admin";

  const { data: existing } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("kind", kind)
    .eq(column, userId)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const insertPayload: {
    kind: string;
    is_closed: boolean;
    driver_user_id?: string;
    passenger_user_id?: string;
  } = { kind, is_closed: false };
  if (role === "driver") insertPayload.driver_user_id = userId;
  else insertPayload.passenger_user_id = userId;

  const { data: created, error } = await supabase
    .from("chat_conversations")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}
