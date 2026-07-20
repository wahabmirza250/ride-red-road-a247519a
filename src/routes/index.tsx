import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { BrandWordmark } from "@/components/Brand";

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
  const year = new Date().getFullYear();

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-background text-foreground">
      {/* Atmospheric layers */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(80%_60%_at_50%_0%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent_65%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/3 -z-10 h-[36rem] bg-[radial-gradient(60%_50%_at_50%_50%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_70%)] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:56px_56px]"
      />

      {/* Top bar */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-6 sm:pt-10">
        <BrandWordmark className="h-8 w-auto sm:h-9" />
        <span className="hidden text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground sm:inline">
          NEMT · Colorado
        </span>
      </header>

      {/* Hero */}
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-16 pt-16 text-center sm:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground backdrop-blur">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          Coming soon
        </span>

        <h1 className="mt-6 max-w-4xl font-display text-[13vw] font-semibold leading-[0.95] tracking-tight sm:text-6xl md:text-7xl lg:text-[5.25rem]">
          Something new is
          <br />
          <span className="bg-gradient-to-r from-primary via-primary to-foreground bg-clip-text text-transparent">
            on the road.
          </span>
        </h1>

        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          RedArt is building modern non-emergency medical transport — dispatch,
          driver, and passenger experiences designed for the road ahead.
        </p>

        {/* Actions */}
        <nav className="mt-10 flex w-full max-w-2xl flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Link
            to="/passenger"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--primary)_60%,transparent)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-12px_color-mix(in_oklab,var(--primary)_65%,transparent)]"
          >
            Book a ride
            <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
          <Link
            to="/driver/signin"
            className="inline-flex items-center justify-center rounded-full border border-border/70 bg-surface/60 px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition hover:border-primary/40 hover:bg-surface"
          >
            Driver sign in
          </Link>
          <Link
            to="/auth"
            className="inline-flex items-center justify-center rounded-full border border-border/70 bg-surface/60 px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition hover:border-primary/40 hover:bg-surface"
          >
            Dispatch sign in
          </Link>
        </nav>

        {/* Signal strip */}
        <dl className="mt-16 grid w-full max-w-3xl grid-cols-3 divide-x divide-border/60 rounded-2xl border border-border/60 bg-surface/40 backdrop-blur">
          <Stat label="Dispatch" value="Realtime" />
          <Stat label="Drivers" value="On-demand" />
          <Stat label="Coverage" value="Statewide" />
        </dl>
      </main>

      {/* Footer */}
      <footer className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 pb-8 text-[11px] text-muted-foreground">
        <span>© {year} RedArt LLC</span>
        <span className="tracking-widest uppercase">v · Preview</span>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-5">
      <dt className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-semibold text-foreground sm:text-base">{value}</dd>
    </div>
  );
}
