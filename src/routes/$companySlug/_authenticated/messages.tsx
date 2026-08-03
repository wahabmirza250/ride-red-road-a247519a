import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseBrowser";
import { PageHeader } from "@/components/nemt/PageHeader";
import { ChatThread } from "@/components/chat/ChatThread";
import { Loader2, MessageSquare, Car, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

export const Route = createFileRoute("/$companySlug/_authenticated/messages")({
  component: DispatchInboxPage,
});

type ConvKind = "driver_admin" | "passenger_admin" | "driver_passenger";

type InboxRow = {
  id: string;
  kind: ConvKind;
  title: string;
  subtitle: string;
  last_message_at: string | null;
  is_closed: boolean;
};

function DispatchInboxPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "drivers" | "passengers" | "trips">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const threads = useQuery({
    queryKey: ["chat-threads", "admin"],
    queryFn: async (): Promise<InboxRow[]> => {
      const { data: convs, error } = await supabase
        .from("chat_conversations")
        .select("id, kind, driver_user_id, passenger_user_id, trip_id, is_closed, last_message_at")
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;

      const userIds = new Set<string>();
      (convs ?? []).forEach((c) => {
        if (c.driver_user_id) userIds.add(c.driver_user_id);
        if (c.passenger_user_id) userIds.add(c.passenger_user_id);
      });
      const profMap = new Map<string, { first_name: string | null; last_name: string | null; email: string | null }>();
      if (userIds.size) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, email")
          .in("id", Array.from(userIds));
        (profs ?? []).forEach((p) => profMap.set(p.id, p));
      }

      const nameOf = (id?: string | null) => {
        if (!id) return "";
        const p = profMap.get(id);
        return `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || p?.email || "Unknown";
      };

      return (convs ?? []).map((c) => {
        if (c.kind === "driver_admin") {
          return {
            id: c.id,
            kind: "driver_admin" as ConvKind,
            title: nameOf(c.driver_user_id),
            subtitle: "Driver ↔ Dispatch",
            last_message_at: c.last_message_at,
            is_closed: c.is_closed,
          };
        }
        if (c.kind === "passenger_admin") {
          return {
            id: c.id,
            kind: "passenger_admin" as ConvKind,
            title: nameOf(c.passenger_user_id),
            subtitle: "Passenger ↔ Support",
            last_message_at: c.last_message_at,
            is_closed: c.is_closed,
          };
        }
        return {
          id: c.id,
          kind: "driver_passenger" as ConvKind,
          title: `${nameOf(c.driver_user_id)} ↔ ${nameOf(c.passenger_user_id)}`,
          subtitle: c.is_closed ? "Trip ended" : "Active trip",
          last_message_at: c.last_message_at,
          is_closed: c.is_closed,
        };
      });
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("admin-inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_conversations" },
        () => qc.invalidateQueries({ queryKey: ["chat-threads", "admin"] }),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        () => qc.invalidateQueries({ queryKey: ["chat-threads", "admin"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const filtered = (threads.data ?? []).filter((t) => {
    if (filter === "all") return true;
    if (filter === "drivers") return t.kind === "driver_admin";
    if (filter === "passengers") return t.kind === "passenger_admin";
    if (filter === "trips") return t.kind === "driver_passenger";
    return true;
  });

  useEffect(() => {
    if (!selectedId && filtered.length) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = filtered.find((t) => t.id === selectedId);

  return (
    <div className="space-y-4">
      <PageHeader title="Messages" description="Every driver and passenger conversation in one inbox." />

      <div className="flex gap-2">
        {(["all", "drivers", "passengers", "trips"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium capitalize transition",
              filter === k
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="grid h-[70vh] gap-4 rounded-2xl border border-border bg-surface shadow-soft lg:grid-cols-[320px_1fr]">
        <aside className="overflow-y-auto border-b border-border p-3 lg:border-b-0 lg:border-r">
          {threads.isLoading && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {filtered.length ? (
            <ul className="space-y-1">
              {filtered.map((t) => {
                const Icon =
                  t.kind === "driver_admin" ? Car : t.kind === "passenger_admin" ? User : MessageSquare;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => setSelectedId(t.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-accent",
                        selectedId === t.id && "bg-primary/8",
                      )}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {t.kind === "driver_passenger" ? (
                          <Icon className="h-4 w-4" />
                        ) : (
                          initials(t.title.split(" ")[0], t.title.split(" ")[1])
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{t.title}</span>
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{t.subtitle}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            !threads.isLoading && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No conversations yet.
              </div>
            )
          )}
        </aside>

        {selected ? (
          <ChatThread conversationId={selected.id} />
        ) : (
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            Select a conversation to reply.
          </div>
        )}
      </div>
    </div>
  );
}
