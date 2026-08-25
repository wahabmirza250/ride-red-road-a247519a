import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { MODIFIER_OPTIONS, modifierLabel } from "@/lib/claimModifiers";
import {
  cancelResubmission,
  getResubmission,
  queueResubmission,
  setServiceLineModifiers,
} from "@/lib/resubmission.functions";

/**
 * Edit mode for ONE resubmission draft. Modifiers are chosen per service line
 * by the biller — modifier 76 is offered, never applied automatically.
 */
export function ResubmissionDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getResubmission);
  const saveFn = useServerFn(setServiceLineModifiers);
  const queueFn = useServerFn(queueResubmission);
  const cancelFn = useServerFn(cancelResubmission);

  const [reason, setReason] = useState("");
  const [draftMods, setDraftMods] = useState<Record<string, string[]>>({});

  const q = useQuery({
    queryKey: ["resubmission", id],
    queryFn: () => getFn({ data: { id: id! } }) as Promise<any>,
    enabled: !!id,
  });

  useEffect(() => {
    if (!q.data) return;
    const map: Record<string, string[]> = {};
    for (const l of q.data.lines) map[l.id] = (l.modifiers ?? []) as string[];
    setDraftMods(map);
  }, [q.data]);

  const isDraft = q.data?.resubmission?.status === "draft";

  const save = useMutation({
    mutationFn: (vars: { line_id: string; modifiers: string[] }) =>
      saveFn({ data: { ...vars, reason: reason || null } }) as Promise<{ changes: number }>,
    onSuccess: (res) => {
      if (res.changes) toast.success("Modifiers saved and audited");
      void qc.invalidateQueries({ queryKey: ["resubmission", id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save modifiers"),
  });

  const queue = useMutation({
    mutationFn: () => queueFn({ data: { id: id! } }) as Promise<{ queued: boolean; reason?: string }>,
    onSuccess: (res) => {
      toast[res.queued ? "success" : "info"](
        res.queued ? "Resubmission queued for the portal" : (res.reason ?? "Already queued"),
      );
      void qc.invalidateQueries({ queryKey: ["denied_claims"] });
      void qc.invalidateQueries({ queryKey: ["resubmission", id] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not queue resubmission"),
  });

  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { id: id! } }) as Promise<{ ok: boolean }>,
    onSuccess: () => {
      toast.success("Draft cancelled");
      void qc.invalidateQueries({ queryKey: ["denied_claims"] });
      onClose();
    },
  });

  const toggleMod = (lineId: string, code: string) =>
    setDraftMods((prev) => {
      const cur = prev[lineId] ?? [];
      return {
        ...prev,
        [lineId]: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code],
      };
    });

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prepare resubmission</DialogTitle>
          <DialogDescription>
            The original denied claim and its claim ID are never changed. Modifiers apply to the
            resubmission's service lines only — modifier 76 is a manual biller decision.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading || !q.data ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">Original: {q.data.resubmission.original_status ?? "denied"}</Badge>
                <span className="font-mono text-xs">
                  {q.data.resubmission.original_claim_number ?? "no claim ID"}
                </span>
                <Badge variant="secondary">Resubmission: {q.data.resubmission.status}</Badge>
              </div>
              {q.data.resubmission.original_denial_reason && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Denial reason: {q.data.resubmission.original_denial_reason}
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label>Reason / note for this change (optional, audited)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={!isDraft} />
            </div>

            <div className="space-y-3">
              {q.data.lines.map((l: any) => (
                <div key={l.id} className="rounded-xl border p-3">
                  <div className="flex items-center justify-between text-sm">
                    <div className="font-medium">Service line {l.line_index}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.service_date ?? "—"} · {l.miles ?? 0} mi · {l.units ?? 1} unit
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {MODIFIER_OPTIONS.map((m) => {
                      const active = (draftMods[l.id] ?? []).includes(m.code);
                      return (
                        <Button
                          key={m.code}
                          type="button"
                          size="sm"
                          variant={active ? "default" : "outline"}
                          disabled={!isDraft}
                          onClick={() => toggleMod(l.id, m.code)}
                          title={m.label}
                        >
                          {m.code}
                        </Button>
                      );
                    })}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!isDraft || save.isPending}
                      onClick={() => save.mutate({ line_id: l.id, modifiers: draftMods[l.id] ?? [] })}
                    >
                      Save line
                    </Button>
                  </div>
                  {(draftMods[l.id] ?? []).length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {(draftMods[l.id] ?? []).map((c) => `${c} — ${modifierLabel(c)}`).join(" · ")}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {q.data.audit.length > 0 && (
              <div className="rounded-xl border p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Modifier audit
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {q.data.audit.slice(0, 12).map((a: any) => (
                    <li key={a.id}>
                      {a.action === "added" ? "Added" : "Removed"} {a.modifier} ·{" "}
                      {formatDateTime(a.created_at)}
                      {a.reason ? ` · ${a.reason}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {isDraft && (
            <>
              <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                Cancel draft
              </Button>
              <Button onClick={() => queue.mutate()} disabled={queue.isPending}>
                {queue.isPending ? "Queuing…" : "Queue for HCPF"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
