import { cn } from "@/lib/utils";

/**
 * Full-screen animated loading state (no logo).
 * Three pulsing dots in the brand color over a subtle gradient backdrop.
 */
export function LoadingScreen({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-surface-muted to-background",
        className,
      )}
    >
      <div className="flex items-end gap-2">
        <span className="h-3 w-3 animate-loading-bounce rounded-full bg-primary [animation-delay:-0.32s]" />
        <span className="h-3 w-3 animate-loading-bounce rounded-full bg-primary [animation-delay:-0.16s]" />
        <span className="h-3 w-3 animate-loading-bounce rounded-full bg-primary" />
      </div>
      <p className="text-sm font-medium tracking-wide text-muted-foreground">
        {label}
        <span className="sr-only"> please wait</span>
      </p>
    </div>
  );
}
