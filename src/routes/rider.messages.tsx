import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import { ChatThread, ensureAdminConversation } from "@/components/chat/ChatThread";
import { Loader2, MessageSquare, Car } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/rider/messages")({
  ssr: false,
  component: RiderMessagesPage,
});

type Thread = {
  id: string;
  kind: "passenger_admin" | "driver_passenger";
  title: string;
  subtitle: string;
  is_closed: boolean;
};

function RiderMessagesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const threads = useQuery({
    queryKey: ["chat-threads", "rider", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Thread[]> => {
      if (!user) return [];
      await ensureAdminConversation(user.id, "passenger");

      const { data: convs, error } = await supabase
        .from("chat_conversations")
        .select("id, kind, driver_user_id, is_closed, last_message_at")
        .eq("passenger_user_id", user.id)
        .in("kind", ["passenger_admin", "driver_passenger"])
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;

      const driverIds = (convs ?? [])
        .map((c) => c.driver_user_id)
        .filter((x): x is string => !!x);
      const profMap = new Map<string, { first_name: string | null; last_name: string | null }>();
      if (driverIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", driverIds);
        (profs ?? []).forEach((p) => profMap.set(p.id, p));
      }

      return (convs ?? []).map((c) => {
        if (c.kind === "passenger_admin") {
          return {
            id: c.id,
            kind: "passenger_admin" as const,
            title: "Support",
            subtitle: "RedArt dispatch",
            is_closed: c.is_closed,
          };
        }
        const p = c.driver_user_id ? profMap.get(c.driver_user_id) : null;
        const name = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || "Your driver";
        return {
          id: c.id,
          kind: "driver_passenger" as const,
          title: name,
          subtitle: c.is_closed ? "Trip ended" : "Active trip",
          is_closed: c.is_closed,
        };
      });
    },
  });

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`rider-threads-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_conversations", filter: `passenger_user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["chat-threads", "rider", user.id] }),
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
                  {t.kind === "passenger_admin" ? (
                    <MessageSquare className="h-4 w-4" />
                  ) : (
                    <Car className="h-4 w-4" />
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
