import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, ClipboardList } from "lucide-react";
import { AppLink } from "@/lib/appLink";
import { listMyDriverTripDrafts } from "@/lib/driverTripDrafts.functions";
import { phaseLabel, withLifecycle, type ActiveTripDraft } from "@/lib/driverTripLifecycle";

/**
 * Active / incomplete self-created trips. Tapping one resumes exactly where the
 * driver left off, even after a refresh, sign-out or on another phone.
 */
export function InProgressTrips() {
  const list = useServerFn(listMyDriverTripDrafts);
  const { data } = useQuery({
    queryKey: ["driver-trip-drafts"],
    queryFn: () => list(),
    refetchOnWindowFocus: true,
  });

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Active trips — tap to resume
      </div>
      {rows.map((row) => {
        const draft = withLifecycle(row.payload as ActiveTripDraft);
        return (
          <AppLink
            key={row.id}
            to="/driver/trip/active"
            search={{ draftId: row.id }}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <ClipboardList className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="truncate text-sm font-semibold">{row.label ?? "Active trip"}</span>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{phaseLabel(draft)}</div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </AppLink>
        );
      })}
    </div>
  );
}
