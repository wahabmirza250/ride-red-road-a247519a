import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { useAuth } from "@/lib/auth";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChatThread } from "./ChatThread";
import { Loader2 } from "lucide-react";

/**
 * Bottom sheet that lazily ensures a driver_passenger conversation exists
 * (scoped to a specific ride), then renders the shared ChatThread.
 *
 * RLS: chat_conversations allows insert/select when passenger_user_id or
 * driver_user_id equals auth.uid(); the passenger is the caller here.
 */
export function RideChatSheet({
  open,
  onOpenChange,
  driverUserId,
  tripId,
  driverName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  driverUserId: string | null;
  tripId: string | null;
  driverName: string;
}) {
  const { user } = useAuth();
  const [convId, setConvId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user?.id || !driverUserId) return;
    let cancelled = false;
    setErr(null);
    void (async () => {
      try {
        // Find an existing driver_passenger conversation for this pair.
        // Scope to trip_id when we have one so different rides don't collide.
        let query = supabase
          .from("chat_conversations")
          .select("id")
          .eq("kind", "driver_passenger")
          .eq("driver_user_id", driverUserId)
          .eq("passenger_user_id", user.id);
        query = tripId ? query.eq("trip_id", tripId) : query.is("trip_id", null);
        const { data: existing } = await query.maybeSingle();
        if (cancelled) return;
        if (existing?.id) {
          setConvId(existing.id);
          return;
        }
        const { data: created, error } = await supabase
          .from("chat_conversations")
          .insert({
            kind: "driver_passenger",
            driver_user_id: driverUserId,
            passenger_user_id: user.id,
            trip_id: tripId,
            is_closed: false,
          })
          .select("id")
          .single();
        if (cancelled) return;
        if (error) throw error;
        setConvId(created.id);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not open chat");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id, driverUserId, tripId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[85vh] flex-col p-0">
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle>Message {driverName}</SheetTitle>
        </SheetHeader>
        {err ? (
          <div className="p-6 text-sm text-destructive">{err}</div>
        ) : convId ? (
          <ChatThread conversationId={convId} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
