import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/nemt/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { addDays, formatTime, startOfWeek } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/schedules")({
  component: SchedulesPage,
});

type Shift = {
  id: string;
  driver_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  status: "scheduled" | "completed" | "no_show";
};

function useDriverOptions() {
  return useQuery({
    queryKey: ["driver-options"],
    queryFn: async () => {
      const { data: drivers } = await supabase.from("drivers").select("id, user_id");
      const ids = (drivers ?? []).map((d) => d.user_id);
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, first_name, last_name").in("id", ids)
        : { data: [] };
      const m = new Map<string, { first_name: string | null; last_name: string | null }>();
      (profs ?? []).forEach((p) => m.set(p.id, p));
      return (drivers ?? []).map((d) => ({
        id: d.id,
        name:
          [m.get(d.user_id)?.first_name, m.get(d.user_id)?.last_name].filter(Boolean).join(" ") ||
          `Driver ${d.id.slice(0, 6)}`,
      }));
    },
  });
}

function SchedulesPage() {
  const drivers = useDriverOptions();
  const [driverId, setDriverId] = useState<string>("");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [openDay, setOpenDay] = useState<Date | null>(null);

  const week = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const shifts = useQuery({
    queryKey: ["shifts", driverId, weekStart.toISOString()],
    enabled: !!driverId,
    queryFn: async () => {
      const from = weekStart.toISOString().slice(0, 10);
      const to = addDays(weekStart, 7).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("shifts")
        .select("*")
        .eq("driver_id", driverId)
        .gte("shift_date", from)
        .lt("shift_date", to);
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
  });

  const shiftForDay = (d: Date) => shifts.data?.find((s) => s.shift_date === d.toISOString().slice(0, 10));

  return (
    <div className="space-y-6">
      <PageHeader title="Schedules" description="Weekly shift planning." />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px]">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Driver</label>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger className="rounded-full"><SelectValue placeholder="Pick driver" /></SelectTrigger>
            <SelectContent>
              {drivers.data?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={() => setWeekStart((w) => addDays(w, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium">
            Week of {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </div>
          <Button size="icon" variant="ghost" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!driverId && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Pick a driver to view or edit their week.
        </div>
      )}

      {driverId && (
        <div className="grid gap-3 md:grid-cols-7">
          {week.map((d) => {
            const shift = shiftForDay(d);
            return (
              <button
                key={d.toISOString()}
                onClick={() => setOpenDay(d)}
                className="rounded-2xl border border-border bg-surface p-4 text-left shadow-soft transition hover:shadow-lift"
              >
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                </div>
                <div className="mt-0.5 text-lg font-semibold">
                  {d.getDate()}
                </div>
                {shift ? (
                  <div className="mt-2 text-xs">
                    <div className="font-medium">{formatTime(shift.start_time)} – {formatTime(shift.end_time)}</div>
                    <div className="text-muted-foreground">
                      {(new Date(shift.end_time).getTime() - new Date(shift.start_time).getTime()) / 3_600_000} hrs
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">No shift</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!openDay} onOpenChange={(o) => !o && setOpenDay(null)}>
        {openDay && driverId && (
          <ShiftDialog day={openDay} driverId={driverId} shift={shiftForDay(openDay) ?? null} onClose={() => setOpenDay(null)} />
        )}
      </Dialog>
    </div>
  );
}

function ShiftDialog({
  day,
  driverId,
  shift,
  onClose,
}: {
  day: Date;
  driverId: string;
  shift: Shift | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const dayIso = day.toISOString().slice(0, 10);
  const defaultStart = shift
    ? shift.start_time.slice(0, 16)
    : `${dayIso}T09:00`;
  const defaultEnd = shift
    ? shift.end_time.slice(0, 16)
    : `${dayIso}T17:00`;
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [notes, setNotes] = useState(shift?.notes ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        driver_id: driverId,
        shift_date: dayIso,
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        notes: notes || null,
      };
      if (shift) {
        const { error } = await supabase.from("shifts").update(payload).eq("id", shift.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shifts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(shift ? "Shift updated" : "Shift added");
      qc.invalidateQueries({ queryKey: ["shifts"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!shift) return;
      const { error } = await supabase.from("shifts").delete().eq("id", shift.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Shift deleted");
      qc.invalidateQueries({ queryKey: ["shifts"] });
      onClose();
    },
  });

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {shift ? "Edit shift" : "Add shift"} — {day.toLocaleDateString()}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Start</Label><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>End</Label><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <DialogFooter className="flex items-center justify-between">
        {shift ? (
          <Button variant="ghost" className="text-destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {shift ? "Save" : <><Plus className="mr-2 h-4 w-4" />Add</>}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
