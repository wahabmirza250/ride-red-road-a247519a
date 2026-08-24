import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const UNASSIGNED_DRIVER_KEY = "__unassigned__";
const UNASSIGNED_LABEL = "Unassigned / unknown driver";

export type DriverGroup = {
  key: string;
  label: string;
  rows: any[];
  submittedCount: number;
  lastSubmittedAt: string | null;
};

/**
 * Groups already-loaded billing rows by their authoritative driver name
 * (`driver_name`, which the server resolves from the paper form's driver or
 * the assigned driver profile). Purely client-side over the rows the tab has
 * already fetched — no extra queries.
 */
export function groupRowsByDriver(rows: any[]): DriverGroup[] {
  const map = new Map<string, DriverGroup>();
  for (const r of rows) {
    const raw = typeof r.driver_name === "string" ? r.driver_name.trim() : "";
    const known = raw && raw !== "—" && raw !== "-";
    const key = known ? raw.toLowerCase() : UNASSIGNED_DRIVER_KEY;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label: known ? raw : UNASSIGNED_LABEL,
        rows: [],
        submittedCount: 0,
        lastSubmittedAt: null,
      };
      map.set(key, g);
    }
    g.rows.push(r);
    if (r.submitted_at) {
      g.submittedCount += 1;
      if (!g.lastSubmittedAt || new Date(r.submitted_at) > new Date(g.lastSubmittedAt)) {
        g.lastSubmittedAt = r.submitted_at;
      }
    }
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.rows.sort((a, b) => {
      const av = new Date(b.submitted_at ?? b.pickup_at ?? 0).getTime();
      const bv = new Date(a.submitted_at ?? a.pickup_at ?? 0).getTime();
      return av - bv;
    });
  }
  groups.sort((a, b) => {
    if (a.key === UNASSIGNED_DRIVER_KEY) return 1;
    if (b.key === UNASSIGNED_DRIVER_KEY) return -1;
    return a.label.localeCompare(b.label);
  });
  return groups;
}

/** Shared driver selector + expand/collapse toolbar state. */
function useDriverGrouping(rows: any[]) {
  const groups = useMemo(() => groupRowsByDriver(rows), [rows]);
  const [driver, setDriver] = useState<string>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Keep collapse state and the selected driver valid as rows refresh.
  useEffect(() => {
    const keys = new Set(groups.map((g) => g.key));
    setOpen((prev) => {
      const next = new Set([...prev].filter((k) => keys.has(k)));
      // A single driver group is always worth showing expanded.
      if (next.size === 0 && groups.length === 1) next.add(groups[0]!.key);
      return next;
    });
    setDriver((d) => (d !== "all" && !keys.has(d) ? "all" : d));
  }, [groups]);

  const visible = driver === "all" ? groups : groups.filter((g) => g.key === driver);
  const allOpen = visible.length > 0 && visible.every((g) => open.has(g.key));

  return {
    groups,
    visible,
    driver,
    setDriver,
    isOpen: (k: string) => open.has(k) || driver !== "all",
    toggle: (k: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      }),
    allOpen,
    toggleAll: () =>
      setOpen(allOpen ? new Set() : new Set(visible.map((g) => g.key))),
  };
}

function GroupToolbar({
  groups,
  driver,
  setDriver,
  allOpen,
  toggleAll,
  total,
}: {
  groups: DriverGroup[];
  driver: string;
  setDriver: (v: string) => void;
  allOpen: boolean;
  toggleAll: () => void;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-3">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        {groups.length} driver{groups.length === 1 ? "" : "s"} · {total} bill
        {total === 1 ? "" : "s"}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Select value={driver} onValueChange={setDriver}>
          <SelectTrigger className="h-9 w-[220px] text-sm">
            <SelectValue placeholder="All drivers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All drivers</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.key} value={g.key}>
                {g.label} ({g.rows.length})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {driver === "all" && (
          <Button variant="outline" size="sm" onClick={toggleAll}>
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        )}
      </div>
    </div>
  );
}

function GroupHeaderContent({ group }: { group: DriverGroup }) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <User className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-semibold">{group.label}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground/80">
        {group.rows.length} bill{group.rows.length === 1 ? "" : "s"}
      </span>
      {group.submittedCount > 0 && (
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
          {group.submittedCount} submitted
        </span>
      )}
      {group.lastSubmittedAt && (
        <span className="text-[11px] font-normal text-muted-foreground">
          last submitted {formatDateTime(group.lastSubmittedAt)}
        </span>
      )}
    </span>
  );
}

/**
 * A table whose body is split into collapsible per-driver sections. `columns`
 * describes the shared header; `renderRow` renders one `<tr>` exactly as the
 * flat table did, so every existing per-bill action keeps working.
 */
export function DriverGroupedTable({
  rows,
  columns,
  renderRow,
  minWidth = "min-w-[760px]",
}: {
  rows: any[];
  columns: { label: string; className?: string }[];
  renderRow: (row: any) => ReactNode;
  minWidth?: string;
}) {
  const g = useDriverGrouping(rows);

  return (
    <div className="space-y-3">
      <GroupToolbar
        groups={g.groups}
        driver={g.driver}
        setDriver={g.setDriver}
        allOpen={g.allOpen}
        toggleAll={g.toggleAll}
        total={rows.length}
      />
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-soft">
        <table className={cn("w-full text-sm", minWidth)}>
          <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={cn("px-4 py-3 text-left", c.className)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          {g.visible.map((group) => {
            const open = g.isOpen(group.key);
            return (
              <tbody key={group.key} className="divide-y divide-border border-t border-border">
                <tr className="bg-surface-muted/60">
                  <td colSpan={columns.length} className="px-3 py-2">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 text-left text-sm"
                      onClick={() => g.toggle(group.key)}
                      aria-expanded={open}
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <GroupHeaderContent group={group} />
                    </button>
                  </td>
                </tr>
                {open && group.rows.map((r) => renderRow(r))}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}

/** Card-list variant used by the "Awaiting portal" tab. */
export function DriverGroupedList({
  rows,
  renderItem,
}: {
  rows: any[];
  renderItem: (row: any) => ReactNode;
}) {
  const g = useDriverGrouping(rows);

  return (
    <div className="space-y-3">
      <GroupToolbar
        groups={g.groups}
        driver={g.driver}
        setDriver={g.setDriver}
        allOpen={g.allOpen}
        toggleAll={g.toggleAll}
        total={rows.length}
      />
      {g.visible.map((group) => {
        const open = g.isOpen(group.key);
        return (
          <div
            key={group.key}
            className="overflow-hidden rounded-2xl border border-border bg-surface/60"
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 bg-surface-muted/60 px-3 py-2.5 text-left text-sm"
              onClick={() => g.toggle(group.key)}
              aria-expanded={open}
            >
              {open ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <GroupHeaderContent group={group} />
            </button>
            {open && (
              <div className="space-y-3 p-3">{group.rows.map((r) => renderItem(r))}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
