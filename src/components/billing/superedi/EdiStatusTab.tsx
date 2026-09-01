/**
 * Claim Status / Remittance.
 *
 * Lists every EDI-linked bill of the selected company and refreshes their
 * status through the backend (`GET /claims/{id}/status/`). What the backend
 * exposes is what is shown: 999 acknowledgement, 277 claim status and 835
 * remittance appear only when present, otherwise the section says so plainly.
 * Legacy HCPF/robot statuses are never touched by this screen.
 */
import { Fragment, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ediFeedSections } from "@/lib/ediStatusFeed";
import { ediRefreshStatuses } from "@/lib/ediBulk.functions";
import { listEdiWorkbench } from "@/lib/ediRecords.functions";
import type { EdiWorkRow } from "@/lib/ediTypes";
import {
  Empty,
  FeedSections,
  Pill,
  StatCard,
  dateText,
  dateTimeText,
  moneyText,
} from "./ediUi";

export function EdiStatusTab({ companyId }: { companyId: string | null }) {
  const listFn = useServerFn(listEdiWorkbench);
  const refreshFn = useServerFn(ediRefreshStatuses);

  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rows, setRows] = useState<EdiWorkRow[] | null>(null);

  const linked = useQuery({
    queryKey: ["edi", "workbench", "linked", companyId, search],
    queryFn: async () => {
      const page = await listFn({
        data: {
          company_id: companyId,
          scope: "linked" as const,
          limit: 200,
          ...(search.trim() ? { search: search.trim() } : {}),
        },
      });
      setRows(page.rows);
      setPicked(new Set());
      return page;
    },
  });

  const list = rows ?? linked.data?.rows ?? [];
  const totals = useMemo(() => {
    const uploaded = list.filter((r) => (r.edi_status ?? "").toLowerCase() === "uploaded").length;
    const withRemit = list.filter((r) => hasSection(r, "remit_835")).length;
    const withAck = list.filter((r) => hasSection(r, "ack_999")).length;
    return { uploaded, withRemit, withAck };
  }, [list]);

  const refresh = useMutation({
    mutationFn: async (ids: string[]) =>
      refreshFn({ data: { company_id: companyId, record_ids: ids } }),
    onSuccess: (res) => {
      setRows(res.rows);
      if (res.failed.length) {
        toast.error(
          `${res.updated} refreshed · ${res.failed.length} failed — ${res.failed[0]!.reason}`,
        );
      } else {
        toast.success(`${res.updated} claim status${res.updated === 1 ? "" : "es"} refreshed.`);
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Refresh failed"),
  });

  const allPicked = list.length > 0 && list.every((r) => picked.has(r.record_id));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="EDI-linked bills" value={linked.data?.total ?? list.length} />
        <StatCard label="Uploaded" value={totals.uploaded} />
        <StatCard label="With 999 acknowledgement" value={totals.withAck} />
        <StatCard label="With 835 remittance" value={totals.withRemit} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-3 shadow-soft">
        <Checkbox
          checked={allPicked}
          onCheckedChange={() =>
            setPicked(allPicked ? new Set() : new Set(list.map((r) => r.record_id)))
          }
          aria-label="Select all"
        />
        <span className="text-sm text-muted-foreground">{picked.size} selected</span>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Member, Medicaid ID, date…"
            className="h-9 w-60 rounded-full pl-8 text-sm"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          disabled={!list.length || refresh.isPending}
          onClick={() => refresh.mutate(list.map((r) => r.record_id))}
        >
          {refresh.isPending && !picked.size ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
          )}
          Refresh all
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          disabled={!picked.size || refresh.isPending}
          onClick={() => refresh.mutate([...picked])}
        >
          {refresh.isPending && picked.size ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : null}
          Refresh selected ({picked.size})
        </Button>
      </div>

      {linked.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading EDI claims…
        </div>
      ) : list.length === 0 ? (
        <Empty icon>
          No bill is linked to an EDI claim yet. Validate a selection in Batch Review first.
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2.5" />
                  <th className="px-3 py-2.5">Member</th>
                  <th className="px-3 py-2.5">Service date</th>
                  <th className="px-3 py-2.5">Claim / batch / file</th>
                  <th className="px-3 py-2.5">Backend status</th>
                  <th className="px-3 py-2.5 text-right">Charge</th>
                  <th className="px-3 py-2.5">Last sync</th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((row) => {
                  const open = expanded === row.record_id;
                  return (
                    <Fragment key={row.record_id}>
                      <tr
                        className={cn("transition hover:bg-surface-muted/60", open && "bg-surface-muted/40")}
                      >
                        <td className="px-3 py-3">
                          <Checkbox
                            checked={picked.has(row.record_id)}
                            onCheckedChange={() => toggle(row.record_id)}
                            aria-label={`Select ${row.member_name ?? "claim"}`}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-foreground">
                            {row.member_name ?? "Unknown member"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {row.medicaid_id ?? "No Medicaid ID"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{dateText(row.service_date)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                          #{row.edi_claim_id ?? "—"}
                          {row.edi_batch_id ? ` · b${row.edi_batch_id}` : ""}
                          {row.edi_file_id ? ` · f${row.edi_file_id}` : ""}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Pill tone={statusTone(row)}>
                              {row.backend_status ?? row.edi_status ?? "No status yet"}
                            </Pill>
                            <span className="text-[11px] uppercase text-muted-foreground">
                              {(row.edi_environment ?? "test").toUpperCase()}
                            </span>
                          </div>
                          {row.edi_last_error && (
                            <div className="mt-1 max-w-[240px] break-words text-xs text-destructive">
                              {row.edi_last_error}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                          {moneyText(row.total_charge)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                          {dateTimeText(row.edi_last_sync_at)}
                        </td>
                        <td className="px-3 py-3">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 rounded-full p-0"
                            onClick={() => setExpanded(open ? null : row.record_id)}
                            aria-label={open ? "Hide detail" : "Show detail"}
                          >
                            {open ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-surface-muted/30">
                          <td colSpan={8} className="px-3 py-4">
                            <FeedSections sections={ediFeedSections(parse(row.status_detail_json))} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function parse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function hasSection(row: EdiWorkRow, key: "ack_999" | "remit_835"): boolean {
  return ediFeedSections(parse(row.status_detail_json)).some((s) => s.key === key && s.available);
}

function statusTone(row: EdiWorkRow): "muted" | "ready" | "warn" | "error" | "info" {
  const status = (row.backend_status ?? row.edi_status ?? "").toLowerCase();
  if (!status) return "muted";
  if (row.edi_last_error || status.includes("reject") || status.includes("denied")) return "error";
  if (status.includes("paid") || status.includes("accepted")) return "ready";
  if (status.includes("pend") || status.includes("queue")) return "warn";
  return "info";
}
