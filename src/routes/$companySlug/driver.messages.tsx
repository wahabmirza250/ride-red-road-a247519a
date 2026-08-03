import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { ChatThread, ensureAdminConversation } from "@/components/chat/ChatThread";
import { Loader2, MessageSquare, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/$companySlug/$companySlug/driver/messages")({
  ssr: false,
  component: DriverMessagesPage,
});

type Thread = {
  id: string;
  kind: "driver_admin" | "driver_passenger";
  title: string;
  subtitle: string;
  is_closed: boolean;
  last_message_at: string | null;
};

function DriverMessagesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const threads = useQuery({
    queryKey: ["chat-threads", "driver", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Thread[]> => {
      if (!user) return [];
      // Ensure dispatch conversation exists
      await ensureAdminConversation(user.id, "driver");

      const { data: convs, error } = await supabase
        .from("chat_conversations")
        .select("id, kind, passenger_user_id, trip_id, is_closed, last_message_at")
        .eq("driver_user_id", user.id)
        .in("kind", ["driver_admin", "driver_passenger"])
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;

      const passengerIds = (convs ?? [])
        .map((c) => c.passenger_user_id)
        .filter((x): x is string => !!x);
      const profMap = new Map<string, { first_name: string | null; last_name: string | null }>();
      if (passengerIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", passengerIds);
        (profs ?? []).forEach((p) => profMap.set(p.id, p));
      }

      return (convs ?? []).map((c) => {
        if (c.kind === "driver_admin") {
          return {
            id: c.id,
            kind: "driver_admin" as const,
            title: "Dispatch",
            subtitle: "Support & operations",
            is_closed: c.is_closed,
            last_message_at: c.last_message_at,
          };
        }
        const p = c.passenger_user_id ? profMap.get(c.passenger_user_id) : null;
        const name = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Passenger";
        return {
          id: c.id,
          kind: "driver_passenger" as const,
          title: name,
          subtitle: c.is_closed ? "Trip ended" : "Active trip",
          is_closed: c.is_closed,
          last_message_at: c.last_message_at,
        };
      });
    },
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`driver-threads-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_conversations", filter: `driver_user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["chat-threads", "driver", user.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, qc]);

  useEffect(() => {
    if (!selectedId && threads.data?.length) setSelectedId(threads.data[0].id);
  }, [threads.data, selectedId]);

  const selected = threads.data?.find((t) => t.id === selectedId);

  return (
    <div className="grid h-[calc(100vh-8rem)] gap-3 overflow-hidden md:grid-cols-[280px_1fr]">
      <aside className="overflow-y-auto rounded-2xl border border-border bg-surface p-2 md:h-full">
        {threads.isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        <ul className="space-y-1">
          {threads.data?.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-accent",
                  selectedId === t.id && "bg-primary/8",
                )}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {t.kind === "driver_admin" ? (
                    <MessageSquare className="h-4 w-4" />
                  ) : (
                    <Users className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.subtitle}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface">
        {selected ? (
          <ChatThread
            conversationId={selected.id}
            disabled={selected.is_closed}
            disabledReason={
              selected.kind === "driver_passenger" ? "Trip ended — chat closed" : undefined
            }
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation
          </div>
        )}
      </section>
    </div>
  );
}
