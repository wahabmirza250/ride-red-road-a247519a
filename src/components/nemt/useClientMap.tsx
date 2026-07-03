import { useEffect, useState, type ComponentType } from "react";

type MapModule = typeof import("@/components/nemt/MapView.client");

/**
 * Dynamically loads the client-only map module. Leaflet touches `window`
 * at module scope so it MUST NOT be imported during SSR.
 */
export function useClientMap(): MapModule | null {
  const [mod, setMod] = useState<MapModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@/components/nemt/MapView.client").then((m) => {
      if (!cancelled) setMod(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return mod;
}

export function ClientMap<T extends keyof MapModule>({
  as,
  fallback,
  ...props
}: {
  as: T;
  fallback?: React.ReactNode;
} & React.ComponentProps<Extract<MapModule[T], ComponentType<unknown>>>) {
  const mod = useClientMap();
  if (!mod) {
    return (
      <>{fallback ?? (
        <div className="flex h-full w-full items-center justify-center bg-surface-muted text-xs text-muted-foreground">
          Loading map…
        </div>
      )}</>
    );
  }
  const Comp = mod[as] as ComponentType<Record<string, unknown>>;
  return <Comp {...(props as Record<string, unknown>)} />;
}
