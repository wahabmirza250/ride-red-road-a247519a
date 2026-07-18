import { cn } from "@/lib/utils";
import { humanizeStatus } from "@/lib/format";

const styles: Record<string, string> = {
  // trip statuses
  scheduled: "bg-muted text-foreground/80",
  assigned: "bg-info/10 text-info",
  driver_en_route_to_pickup: "bg-info/10 text-info",
  arrived_at_pickup: "bg-warning/15 text-warning-foreground",
  in_progress: "bg-info/15 text-info",
  completed: "bg-success/15 text-success",
  cancelled: "bg-destructive/10 text-destructive",
  no_show: "bg-destructive/10 text-destructive",
  // billing
  pending: "bg-warning/15 text-warning-foreground",
  submitted: "bg-info/15 text-info",
  paid: "bg-success/15 text-success",
  rejected: "bg-destructive/10 text-destructive",
  // driver
  available: "bg-success/15 text-success",
  busy: "bg-info/15 text-info",
  offline: "bg-muted text-muted-foreground",
  // incidents
  open: "bg-warning/15 text-warning-foreground",
  reviewed: "bg-info/15 text-info",
  closed: "bg-success/15 text-success",
};

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        styles[status] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {humanizeStatus(status)}
    </span>
  );
}
