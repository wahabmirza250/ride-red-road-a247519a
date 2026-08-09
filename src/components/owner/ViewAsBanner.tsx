import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Eye, Loader2, LogOut } from "lucide-react";
import { getViewAsState, stopViewAsCompany } from "@/lib/owner.functions";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

/**
 * Shown only to a platform owner who is currently "viewing as" a company.
 * Makes it unmistakable that this is the owner console impersonating a tenant,
 * not that tenant's own admin account.
 */
export function ViewAsBanner() {
  const { user, loading } = useAuth();
  const state = useServerFn(getViewAsState);
  const stop = useServerFn(stopViewAsCompany);
  const [info, setInfo] = useState<{ name: string; slug: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await state({});
        if (!cancelled && r.viewing) setInfo({ name: r.name, slug: r.slug });
      } catch {
        /* not an owner — nothing to show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, state]);

  if (!info) return null;

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-xs font-medium text-amber-800 backdrop-blur dark:text-amber-300">
      <span className="inline-flex items-center gap-2">
        <Eye className="h-3.5 w-3.5" />
        Owner mode — viewing as <strong>{info.name}</strong> (/{info.slug})
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 rounded-full border-amber-500/50 bg-background/60 text-xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await stop({});
            window.location.replace("/owner");
          } catch {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <LogOut className="mr-1 h-3 w-3" />}
        Back to Owner Panel
      </Button>
    </div>
  );
}
