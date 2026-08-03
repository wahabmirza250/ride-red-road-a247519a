import { Link } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { BrandMark } from "@/components/Brand";

/**
 * Neutral screen shown when an app route is opened with no company context —
 * e.g. a guest hitting a bare `/passenger` link. We deliberately do NOT fall
 * back to any default company: booking through the wrong provider's fleet is
 * a cross-tenant data problem.
 */
export function CompanyLinkRequired({
  title = "You need your provider's link",
  message = "This page is shared by multiple transportation providers. Open the booking link your provider gave you (it looks like redartdigital.com/your-provider/passenger) or sign in to your account.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <Building2 className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="font-display text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <Link
            to="/"
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Go to RedArt home
          </Link>
          <BrandMark className="h-7 w-7 opacity-60" />
        </div>
      </div>
    </div>
  );
}
