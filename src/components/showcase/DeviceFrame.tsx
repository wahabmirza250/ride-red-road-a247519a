import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Device } from "./slides";

/**
 * Presentational device mockups used by the showcase deck.
 * Pure CSS — no images beyond the screenshot itself.
 */
export function DeviceFrame({
  device,
  src,
  alt,
  className,
}: {
  device: Device;
  src?: string;
  alt: string;
  className?: string;
}) {
  const content: ReactNode = src ? (
    <img src={src} alt={alt} loading="lazy" className="block h-full w-full object-cover object-top" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-muted/40 p-6 text-center text-xs text-muted-foreground">
      Screenshot placeholder — {alt}
    </div>
  );

  if (device === "phone") {
    return (
      <div className={cn("relative mx-auto w-[236px] sm:w-[268px]", className)}>
        <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-surface-accent/20 blur-2xl" />
        <div className="rounded-[2.5rem] border border-border bg-card p-2 shadow-lift">
          <div className="relative overflow-hidden rounded-[2rem] bg-background">
            <div className="absolute left-1/2 top-2 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-brand-ink/80" />
            <div className="aspect-[9/19]">{content}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative mx-auto w-full max-w-[620px]", className)}>
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-surface-accent/20 blur-2xl" />
      <div className="rounded-2xl border border-border bg-card p-2 shadow-lift">
        <div className="mb-2 flex items-center gap-1.5 px-2 pt-1">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </div>
        <div className="overflow-hidden rounded-xl bg-background">
          <div className="aspect-[16/10]">{content}</div>
        </div>
      </div>
      <div className="mx-auto mt-1 h-2 w-2/3 rounded-b-2xl bg-border/70" />
    </div>
  );
}
