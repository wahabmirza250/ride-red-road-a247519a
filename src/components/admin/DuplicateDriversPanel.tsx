import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Merge, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listDuplicateDrivers,
  mergeDuplicateDrivers,
  previewDriverMergePlan,
} from "@/lib/driverDuplicates.functions";

const REASON_LABEL: Record<string, string> = {
  same_account: "Same login account",
  same_email: "Same email address",
  same_phone: "Same phone number",
  same_name: "Same name only",
};

/**
 * Admin review of possible duplicate driver profiles.
 *
 * Nothing merges automatically: an admin picks the record to keep, reviews the
 * exact rows that would move, and confirms. Name-only matches are shown as
 * weak evidence and are never presented as ready to merge.
 */
export function DuplicateDriversPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDuplicateDrivers);
  const previewFn = useServerFn(previewDriverMergePlan);
  const mergeFn = useServerFn(mergeDuplicateDrivers);

  const [pending, setPending] = useState<{ keeper: string; duplicate: string } | null>(null);
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["duplicate_drivers"],
    queryFn: () => listFn() as Promise<any>,
  });

  const groups: any[] = q.data?.groups ?? [];

  async function openMerge(keeper: string, duplicate: string) {
    setPending({ keeper, duplicate });
    setPlan(null);
    try {
      setPlan(await previewFn({ data: { keeper_id: keeper, duplicate_id: duplicate } }));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not build the merge preview.");
      setPending(null);
    }
  }

  async function confirmMerge() {
    if (!pending) return;
    setBusy(true);
    try {
      const res: any = await mergeFn({
        data: { keeper_id: pending.keeper, duplicate_id: pending.duplicate, approve: true },
      });
      toast.success(`Merged — ${res?.total ?? 0} record(s) moved to the kept driver.`);
      setPending(null);
      setPlan(null);
      qc.invalidateQueries({ queryKey: ["duplicate_drivers"] });
      qc.invalidateQueries({ queryKey: ["drivers"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Merge failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Possible duplicate drivers</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Matched on login account, email or phone. A matching name alone is only supporting
        evidence — nothing is ever merged automatically.
      </p>

      {q.isLoading && <Loader2 className="mt-4 h-4 w-4 animate-spin" />}
      {!q.isLoading && groups.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No duplicate candidates found.</p>
      )}

      <div className="mt-4 space-y-3">
        {groups.map((g) => (
          <div key={g.key} className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                {REASON_LABEL[g.reason] ?? g.reason}
              </span>
              {g.strength === "strong" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600">
                  <ShieldCheck className="h-3 w-3" /> Strong identifier
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600">
                  <AlertTriangle className="h-3 w-3" /> Weak — review manually
                </span>
              )}
            </div>

            {g.notes?.map((n: string) => (
              <p key={n} className="mt-2 text-xs text-amber-600">
                {n}
              </p>
            ))}

            <ul className="mt-3 space-y-2">
              {g.drivers.map((d: any) => {
                const keeper = d.id === g.suggestedKeeperId;
                return (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">
                        {`${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || d.email || d.id}
                        {keeper && (
                          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            Suggested keeper
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {d.email ?? "no email"} · {d.phone ?? "no phone"} · {d.id.slice(0, 8)}…
                      </div>
                    </div>
                    {!keeper && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openMerge(g.suggestedKeeperId, d.id)}
                      >
                        <Merge className="mr-2 h-4 w-4" /> Review merge into keeper
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review merge</DialogTitle>
          </DialogHeader>
          {!plan ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <div className="space-y-3 text-sm">
              <p>
                Keep{" "}
                <strong>
                  {`${plan.keeper.first_name ?? ""} ${plan.keeper.last_name ?? ""}`.trim() ||
                    plan.keeper.id}
                </strong>{" "}
                and move everything from{" "}
                <strong>
                  {`${plan.duplicate.first_name ?? ""} ${plan.duplicate.last_name ?? ""}`.trim() ||
                    plan.duplicate.id}
                </strong>
                .
              </p>
              {plan.blocked ? (
                <p className="rounded-lg bg-rose-500/10 p-3 text-rose-600">{plan.blocked}</p>
              ) : (
                <>
                  <div className="rounded-lg border border-border p-3">
                    {Object.keys(plan.counts ?? {}).length === 0 ? (
                      <p className="text-muted-foreground">
                        Nothing is attached to the duplicate record.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {Object.entries(plan.counts).map(([table, n]) => (
                          <li key={table} className="flex justify-between">
                            <span className="text-muted-foreground">
                              {table.replace(/_/g, " ")}
                            </span>
                            <span className="tabular-nums">{String(n)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The duplicate record is retired, never deleted, and the merge is written to the
                    audit log.
                  </p>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button onClick={confirmMerge} disabled={busy || !plan || !!plan?.blocked}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
