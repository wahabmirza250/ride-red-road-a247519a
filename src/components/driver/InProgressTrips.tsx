import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, ClipboardList } from "lucide-react";
import { AppLink } from "@/lib/appLink";
import { listMyDriverTripDrafts } from "@/lib/driverTripDrafts.functions";
import { missingForCompletion, type DriverTripDraft } from "@/lib/driverTripDraft";

/** Saved (server-side) in-progress trips the driver still has to finish. */
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
        In progress — needs completion
      </div>
      {rows.map((row) => {
        const missing = missingForCompletion({
          ...(row.payload as DriverTripDraft),
        } as DriverTripDraft);
        return (
          <AppLink
            key={row.id}
            to="/driver/trip/new"
            search={{ draftId: row.id }}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4"
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <ClipboardList className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="truncate text-sm font-semibold">{row.label ?? "Saved trip"}</span>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {missing.length === 0 ? "Ready to submit" : `Missing: ${missing.slice(0, 2).join(", ")}`}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </AppLink>
        );
      })}
    </div>
  );
}
