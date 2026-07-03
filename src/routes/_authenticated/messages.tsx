import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/nemt/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send } from "lucide-react";
import { formatDateTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/messages")({
  component: MessagesPage,
});

type Message = {
  id: string;
  driver_id: string;
  sender_id: string;
  sender_role: "admin" | "driver" | "passenger";
  body: string;
  read: boolean;
  created_at: string;
};

function useDriverThreads() {
  return useQuery({
    queryKey: ["driver-threads"],
    queryFn: async () => {
      const { data: drivers, error } = await supabase.from("drivers").select("id, user_id");
      if (error) throw error;
      const ids = (drivers ?? []).map((d) => d.user_id);
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, first_name, last_name").in("id", ids)
        : { data: [] };
      const profMap = new Map<string, { first_name: string | null; last_name: string | null }>();
      (profs ?? []).forEach((p) => profMap.set(p.id, p));
      const { data: msgs } = await supabase
        .from("messages")
        .select("driver_id, body, read, created_at, sender_role")
        .order("created_at", { ascending: false })
        .limit(1000);
      const last = new Map<string, Message>();
      const unread = new Map<string, number>();
      (msgs ?? []).forEach((m) => {
        if (!last.has(m.driver_id)) last.set(m.driver_id, m as unknown as Message);
        if (!m.read && m.sender_role === "driver") {
          unread.set(m.driver_id, (unread.get(m.driver_id) ?? 0) + 1);
        }
      });
      return (drivers ?? []).map((d) => ({
        driver_id: d.id,
        name: `${profMap.get(d.user_id)?.first_name ?? ""} ${profMap.get(d.user_id)?.last_name ?? ""}`.trim() || "Driver",
        last: last.get(d.id),
        unread: unread.get(d.id) ?? 0,
      }));
    },
    refetchInterval: 20_000,
  });
}

function MessagesPage() {
  const threads = useDriverThreads();
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedDriver && threads.data?.length) {
      setSelectedDriver(threads.data[0].driver_id);
    }
  }, [threads.data, selectedDriver]);

  return (
    <div className="space-y-6">
      <PageHeader title="Dispatch" description="Chat with drivers in real time." />

      <div className="grid h-[70vh] gap-4 rounded-2xl border border-border bg-surface shadow-soft lg:grid-cols-[280px_1fr]">
        <aside className="overflow-y-auto border-b border-border p-3 lg:border-b-0 lg:border-r">
          {threads.isLoading && (
            <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin" /></div>
          )}
          {threads.data?.length ? (
            <ul className="space-y-1">
              {threads.data.map((t) => (
                <li key={t.driver_id}>
                  <button
                    onClick={() => setSelectedDriver(t.driver_id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-accent",
                      selectedDriver === t.driver_id && "bg-primary/8",
                    )}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {initials(t.name.split(" ")[0], t.name.split(" ")[1])}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{t.name}</span>
                        {t.unread > 0 && (
                          <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                            {t.unread}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {t.last?.body ?? "No messages yet"}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            !threads.isLoading && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No drivers yet.
              </div>
            )
          )}
        </aside>

        {selectedDriver ? (
          <Thread driverId={selectedDriver} />
        ) : (
          <div className="flex items-center justify-center text-sm text-muted-foreground">
            Select a driver to start chatting.
          </div>
        )}
      </div>
    </div>
  );
}

function Thread({ driverId }: { driverId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const msgs = useQuery({
    queryKey: ["messages", driverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      // mark all unread received messages as read
      const unread = (data ?? []).filter((m) => !m.read && m.sender_role !== "admin");
      if (unread.length) {
        await supabase
          .from("messages")
          .update({ read: true })
          .in("id", unread.map((m) => m.id));
        qc.invalidateQueries({ queryKey: ["driver-threads"] });
      }
      return (data ?? []) as Message[];
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.data?.length]);

  useEffect(() => {
    const ch = supabase
      .channel(`messages-${driverId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `driver_id=eq.${driverId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["messages", driverId] });
          qc.invalidateQueries({ queryKey: ["driver-threads"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [driverId, qc]);

  const send = useMutation({
    mutationFn: async () => {
      const body = text.trim();
      if (!body || !user) return;
      const { error } = await supabase.from("messages").insert({
        driver_id: driverId,
        sender_id: user.id,
        sender_role: "admin",
        body,
      });
      if (error) throw error;
      setText("");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", driverId] });
      qc.invalidateQueries({ queryKey: ["driver-threads"] });
    },
  });

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {msgs.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : msgs.data?.length ? (
          msgs.data.map((m) => {
            const isAdmin = m.sender_role === "admin";
            return (
              <div key={m.id} className={cn("flex", isAdmin ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm shadow-soft",
                    isAdmin
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-muted text-foreground",
                  )}
                >
                  <div>{m.body}</div>
                  <div className={cn("mt-1 text-[10px]", isAdmin ? "text-primary-foreground/70" : "text-muted-foreground")}>
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
        onSubmit={(e) => { e.preventDefault(); send.mutate(); }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message"
          className="flex-1"
        />
        <Button type="submit" disabled={!text.trim() || send.isPending} size="icon" className="rounded-full">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
