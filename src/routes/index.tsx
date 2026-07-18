import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandMark, BrandWordmark } from "@/components/Brand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RedArt — Coming soon" },
      {
        name: "description",
        content:
          "RedArt is building modern NEMT dispatch, driver, and passenger experiences. Our marketing site is coming soon.",
      },
      { property: "og:title", content: "RedArt — Coming soon" },
      {
        property: "og:description",
        content:
          "RedArt is building modern NEMT dispatch, driver, and passenger experiences. Our marketing site is coming soon.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-16 text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,theme(colors.primary/15),transparent_60%)]"
      />
      <main className="relative z-10 flex w-full max-w-xl flex-col items-center gap-8 text-center">
        <div className="flex items-center gap-3">
          <BrandMark className="h-14 w-14 rounded-2xl shadow-soft ring-1 ring-border/50" />
          <BrandWordmark className="h-8" />
        </div>

        <div className="space-y-3">
          <span className="inline-flex items-center rounded-full border border-border/60 bg-surface/60 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Coming soon
          </span>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Something new is on the road.
          </h1>
          <p className="mx-auto max-w-md text-sm text-muted-foreground sm:text-base">
            RedArt is building modern NEMT dispatch, driver, and passenger
            experiences. Our full site is on the way — check back soon.
          </p>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-2 text-xs">
          <Link
            to="/passenger"
            className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Passenger app
          </Link>
          <Link
            to="/driver/signin"
            className="rounded-full border border-border/70 bg-surface/60 px-4 py-2 font-semibold text-foreground transition hover:bg-accent"
          >
            Driver sign in
          </Link>
          <Link
            to="/auth"
            className="rounded-full border border-border/70 bg-surface/60 px-4 py-2 font-semibold text-foreground transition hover:bg-accent"
          >
            Dispatch sign in
          </Link>
        </nav>

        <p className="text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} RedArt LLC
        </p>
      </main>
    </div>
  );
}
