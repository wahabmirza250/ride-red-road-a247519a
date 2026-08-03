import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, CalendarClock, Archive, History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getDriverActivity, clearDriverHours } from "@/lib/driverPay.functions";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";

type Shift = {
  id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  hours: number;
  miles: number;
  earnings: number | null;
  open: boolean;
  cleared_at: string | null;
};

const GROUP_DAYS = 14; // display grouping only — a pay period is defined by "Clear hours".

/** Buckets shifts into rolling GROUP_DAYS windows anchored on the newest shift. */
function groupShifts(shifts: Shift[]) {
  if (!shifts.length) return [] as { key: string; start: Date; end: Date; rows: Shift[] }[];
  const sorted = [...shifts].sort(
    (a, b) => new Date(b.clock_in_at).getTime() - new Date(a.clock_in_at).getTime(),
  );
  const anchor = new Date(sorted[0]!.clock_in_at);
  anchor.setHours(23, 59, 59, 999);
  const span = GROUP_DAYS * 86_400_000;
  const out = new Map<number, { key: string; start: Date; end: Date; rows: Shift[] }>();
  for (const r of sorted) {
    const idx = Math.floor((anchor.getTime() - new Date(r.clock_in_at).getTime()) / span);
    const end = new Date(anchor.getTime() - idx * span);
    const start = new Date(end.getTime() - span + 1);
    const g = out.get(idx) ?? { key: String(idx), start, end, rows: [] };
    g.rows.push(r);
    out.set(idx, g);
  }
  return [...out.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
}

/** ADMIN ONLY. Daily activity, pay-period grouping, and pay-period close-out. */
export function DriverActivityPanel({ driverId }: { driverId: string }) {
  const qc = useQueryClient();
  const activityFn = useServerFn(getDriverActivity);
  const clearFn = useServerFn(clearDriverHours);
  const [showCleared, setShowCleared] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState("");

  const q = useQuery({
    queryKey: ["driver-activity", driverId],
    queryFn: () => activityFn({ data: { driver_id: driverId } }),
  });

  const clear = useMutation({
    mutationFn: () => clearFn({ data: { driver_id: driverId, note: note.trim() || null } }),
    onSuccess: (r) => {
      toast.success(
        `Archived ${r.shifts_archived} shift(s) · ${r.hours.toFixed(2)}h — history kept`,
      );
      setNote("");
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["driver-activity", driverId] });
      qc.invalidateQueries({ queryKey: ["driver-earnings", driverId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shifts = (q.data?.shifts ?? []) as Shift[];
  const visible = useMemo(
    () => (showCleared ? shifts : shifts.filter((s) => !s.cleared_at)),
    [shifts, showCleared],
  );
  const groups = useMemo(() => groupShifts(visible), [visible]);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" /> Daily activity
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCleared((v) => !v)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              showCleared
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            <History className="mr-1 inline h-3 w-3" />
            {showCleared ? "Showing archived too" : "Show archived"}
          </button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={!q.data || q.data.current_shift_count === 0}
            onClick={() => setConfirmOpen(true)}
          >
            <Archive className="mr-1.5 h-3.5 w-3.5" /> Clear hours
          </Button>
        </div>
      </div>

      {q.isLoading || !q.data ? (
        <div className="py-6 text-center">
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
            <Metric label="Counted hours" value={`${q.data.current_hours.toFixed(2)}h`} />
            <Metric
              label="Counted earnings"
              value={
                q.data.current_earnings == null ? "—" : formatCurrency(q.data.current_earnings)
              }
            />
            <Metric label="Shifts counted" value={String(q.data.current_shift_count)} />
          </div>
          {q.data.has_open_shift && (
            <p className="mb-2 text-xs text-emerald-600">
              Driver is clocked in right now — the open shift stays counted after a clear.
            </p>
          )}

          <div className="space-y-4">
            {groups.map((g) => {
              const hours = g.rows.reduce((a, r) => a + r.hours, 0);
              const earn = g.rows.reduce((a, r) => a + (r.earnings ?? 0), 0);
              return (
                <div key={g.key} className="overflow-hidden rounded-lg border border-border">
                  <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-xs">
                    <span className="font-medium">
                      {formatDate(g.start.toISOString())} – {formatDate(g.end.toISOString())}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {hours.toFixed(2)}h
                      {q.data!.hourly_rate != null ? ` · ${formatCurrency(earn)}` : ""}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-left text-[11px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Clock in</th>
                        <th className="px-3 py-1.5 font-medium">Clock out</th>
                        <th className="px-3 py-1.5 font-medium">Hours</th>
                        <th className="px-3 py-1.5 text-right font-medium">Earnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="px-3 py-2">{formatDateTime(r.clock_in_at)}</td>
                          <td className="px-3 py-2">
                            {r.clock_out_at ? (
                              formatDateTime(r.clock_out_at)
                            ) : (
                              <span className="text-emerald-600">still clocked in</span>
                            )}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{r.hours.toFixed(2)}h</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.earnings == null ? "—" : formatCurrency(r.earnings)}
                            {r.cleared_at && (
                              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                                archived
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
            {!groups.length && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No shifts {showCleared ? "recorded" : "in the current pay period"}.
              </div>
            )}
          </div>

          {!!q.data.clearings.length && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cleared pay periods
              </div>
              <div className="space-y-1.5">
                {q.data.clearings.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"
                  >
                    <span className="font-medium">
                      {c.period_start ? formatDate(c.period_start) : "—"} –{" "}
                      {c.period_end ? formatDate(c.period_end) : "—"}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {Number(c.hours).toFixed(2)}h · {c.shift_count} shifts
                      {c.earnings != null ? ` · ${formatCurrency(Number(c.earnings))}` : ""}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      cleared {formatDateTime(c.cleared_at)}
                    </span>
                    {c.note && <span className="w-full text-muted-foreground">“{c.note}”</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear counted hours?</AlertDialogTitle>
            <AlertDialogDescription>
              This closes out the current pay period. {q.data?.current_shift_count ?? 0} completed
              shift(s) ({(q.data?.current_hours ?? 0).toFixed(2)}h) are archived — nothing is
              deleted, and they stay visible under “Show archived”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Paid by check #1042"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                clear.mutate();
              }}
              disabled={clear.isPending}
            >
              {clear.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Clear &amp; archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
