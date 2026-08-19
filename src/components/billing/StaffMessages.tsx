import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/nemt/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, initials } from "@/lib/format";
import {
  ensureBillingConversation,
  listBillingColleagues,
  type BillingColleague,
} from "@/lib/billingChat.functions";

type StaffMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

const ROLE_LABEL: Record<string, string> = {
  billing: "Biller",
  admin_biller: "Admin biller",
  admin: "Admin",
};

/** Direct messaging between billing staff inside the same company. */
export function StaffMessages({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listColleagues = useServerFn(listBillingColleagues);
  const ensureConv = useServerFn(ensureBillingConversation);
  const [selected, setSelected] = useState<BillingColleague | null>(null);

  const colleagues = useQuery({
    queryKey: ["billing-colleagues"],
    queryFn: () => listColleagues({ data: undefined as never }),
  });

  const conv = useQuery({
    queryKey: ["billing-conversation", selected?.user_id],
    enabled: !!selected,
    queryFn: () => ensureConv({ data: { other_user_id: selected!.user_id } }),
  });

  const conversationId = conv.data?.conversation_id ?? null;

  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader title="Team messages" description="Message other billing staff in your company." />
      )}

      <div className="grid h-[70vh] gap-4 rounded-2xl border border-border bg-surface shadow-soft lg:grid-cols-[300px_1fr]">
        <aside className="overflow-y-auto border-b border-border p-3 lg:border-b-0 lg:border-r">
          {colleagues.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : colleagues.data?.length ? (
            <ul className="space-y-1">
              {colleagues.data.map((c) => (
                <li key={c.user_id}>
                  <button
                    onClick={() => setSelected(c)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-accent",
                      selected?.user_id === c.user_id && "bg-primary/10",
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {initials(c.name.split(" ")[0], c.name.split(" ")[1])}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {ROLE_LABEL[c.role] ?? c.role}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <Users className="h-5 w-5" />
              No other billing staff in your company yet.
            </div>
          )}
        </aside>

        {selected && conversationId ? (
          <StaffThread
            key={conversationId}
            conversationId={conversationId}
            title={selected.name}
            currentUserId={user?.id ?? ""}
            onSent={() => qc.invalidateQueries({ queryKey: ["billing-colleagues"] })}
          />
        ) : (
          <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
            {conv.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pick a teammate to message."}
          </div>
        )}
      </div>
    </div>
  );
}

function StaffThread({
  conversationId,
  title,
  currentUserId,
  onSent,
}: {
  conversationId: string;
  title: string;
  currentUserId: string;
  onSent?: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const msgs = useQuery({
    queryKey: ["staff-messages", conversationId],
    queryFn: async (): Promise<StaffMessage[]> => {
      const { data, error } = await supabase
        .from("staff_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const unread = (data ?? []).filter((m) => !m.read_at && m.sender_id !== currentUserId);
      if (unread.length) {
        await supabase
          .from("staff_messages")
          .update({ read_at: new Date().toISOString() })
          .in(
            "id",
            unread.map((m) => m.id),
          );
      }
      return (data ?? []) as StaffMessage[];
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.data?.length]);

  useEffect(() => {
    const ch = supabase
      .channel(`staff-chat-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "staff_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["staff-messages", conversationId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, qc]);

  const send = useMutation({
    mutationFn: async () => {
      const body = text.trim();
      if (!body) return;
      const { error } = await supabase
        .from("staff_messages")
        .insert({ conversation_id: conversationId, sender_id: currentUserId, body });
      if (error) throw error;
      setText("");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-messages", conversationId] });
      onSent?.();
    },
  });

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-border p-3 text-sm font-medium">{title}</div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {msgs.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : msgs.data?.length ? (
          msgs.data.map((m) => {
            const mine = m.sender_id === currentUserId;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-soft",
                    mine ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground",
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
            No messages yet.
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="flex items-center gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message"
          className="flex-1"
        />
        <Button type="submit" size="icon" className="rounded-full" disabled={!text.trim() || send.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
