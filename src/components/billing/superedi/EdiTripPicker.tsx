/**
 * Select an existing electronic trip/billing record for EDI billing.
 * Shared by the Upload/Import and Review tabs so Super EDI is never PDF-only.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { listEdiCandidateRecords, type EdiCandidate } from "@/lib/ediBilling.functions";

export function EdiTripPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const listFn = useServerFn(listEdiCandidateRecords);
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["edi_candidates", search],
    queryFn: () => listFn({ data: { search, limit: 50 } }),
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search member, Medicaid ID or address"
          className="h-10 rounded-full pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (q.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No electronic trips match this search.
        </p>
      ) : (
        <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {(q.data ?? []).map((c: EdiCandidate) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className={cn(
                  "w-full rounded-xl border p-3 text-left transition",
                  selectedId === c.id
                    ? "border-primary bg-primary/5"
                    : "border-border bg-surface hover:bg-accent",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {c.member_name ?? "Unnamed member"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {c.edi_claim_id && <Badge variant="outline">EDI #{c.edi_claim_id}</Badge>}
                    <Badge variant="secondary">{c.status}</Badge>
                  </div>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {c.medicaid_id ?? "No Medicaid ID"} ·{" "}
                  {c.service_date ? new Date(c.service_date).toLocaleDateString() : "No date"} ·{" "}
                  {c.pickup_address ?? "?"} → {c.dropoff_address ?? "?"}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
