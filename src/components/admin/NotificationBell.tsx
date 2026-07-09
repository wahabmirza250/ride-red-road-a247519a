import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabaseBrowser";
import {
  listAdminNotifications,
  markNotificationRead,
} from "@/lib/adminNotifications.functions";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Short alert beep as base64 WAV (simple sine ping) — no external asset needed.
const ALERT_SOUND_SRC =
  "data:audio/wav;base64,UklGRlwSAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YTgSAAAAAP8CngQ7B9UJagz+DoQR/hNwFtQYJRtsHZ0fux/OIcgjriV0J8UohSp3K/gsryzCLLot3Cw="; // ~40ms tone, low-cost

export function NotificationBell() {
  const listFn = useServerFn(listAdminNotifications);
  const markFn = useServerFn(markNotificationRead);
  const q = useQueryClient();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [open, setOpen] = useState(false);

  const notifications = useQuery({
    queryKey: ["admin-notifications"],
    queryFn: () => listFn(),
    refetchInterval: 60_000,
  });

  const unread = useMemo(
    () => (notifications.data ?? []).filter((n) => !n.read).length,
    [notifications.data],
  );

  useEffect(() => {
    audioRef.current = new Audio(ALERT_SOUND_SRC);
    audioRef.current.volume = 0.9;
  }, []);

  useEffect(() => {
    const ch = supabase
      .channel(`admin-notifications-live-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "admin_notifications" },
        (payload) => {
          const row = payload.new as {
            title: string;
            body: string;
            kind: string;
            url?: string | null;
          };
          try {
            audioRef.current?.play().catch(() => {});
          } catch {}
          toast(row.title, {
            description: row.body,
            duration: row.kind === "ride_request" ? 12000 : 6000,
            className: row.kind === "ride_request" ? "!bg-rose-500 !text-white" : undefined,
          });
          q.invalidateQueries({ queryKey: ["admin-notifications"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [q]);

  async function markAll() {
    try {
      await markFn({ data: { all: true } });
      q.invalidateQueries({ queryKey: ["admin-notifications"] });
    } catch {}
  }

  async function markOne(id: string, url?: string | null) {
    try {
      await markFn({ data: { id } });
      q.invalidateQueries({ queryKey: ["admin-notifications"] });
    } catch {}
    if (url) window.location.href = url;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="text-sm font-semibold">Notifications</div>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              onClick={markAll}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {(notifications.data ?? []).length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No notifications yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.data!.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => markOne(n.id, n.url)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-accent",
                      !n.read && "bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1 h-2 w-2 shrink-0 rounded-full",
                        n.kind === "ride_request"
                          ? "bg-rose-500"
                          : n.kind === "driver_status"
                            ? "bg-info"
                            : "bg-primary",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{n.title}</div>
                      <div className="text-xs text-muted-foreground">{n.body}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
