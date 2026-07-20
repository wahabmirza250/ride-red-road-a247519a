import { useEffect, useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { BrandWordmark } from "@/components/Brand";
import {
  Car,
  Users,
  Radio,
  ShieldCheck,
  Clock,
  MapPin,
  FileCheck2,
  Sparkles,
  BadgeDollarSign,
  HeartPulse,
} from "lucide-react";



export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RedArt — Modern NEMT dispatch, drivers, and rider experience" },
      {
        name: "description",
        content:
          "RedArt builds a modern non-emergency medical transport platform: realtime dispatch, a driver app, and a rider experience — all in one system built for Medicaid providers in Colorado.",
      },
      { property: "og:title", content: "RedArt — Modern NEMT platform" },
      {
        property: "og:description",
        content:
          "One platform for dispatch, drivers, and riders. Purpose-built for NEMT and Medicaid billing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const year = new Date().getFullYear();

  return (
    <div className="dark relative isolate min-h-screen overflow-hidden bg-[#07070a] text-foreground antialiased">
      {/* Atmospheric layers — deep, minimal */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70rem] bg-[radial-gradient(70%_55%_at_50%_0%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent_0%,#07070a_85%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.035] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(60%_50%_at_50%_20%,#000,transparent)]"
      />


      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-background/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <BrandWordmark className="h-8 w-auto" />
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#product" className="transition hover:text-foreground">
              Product
            </a>
            <a href="#benefits" className="transition hover:text-foreground">
              Benefits
            </a>
            <a href="#why-join" className="transition hover:text-foreground">
              Why join
            </a>
            <a href="#contact" className="transition hover:text-foreground">
              Contact
            </a>
          </nav>
          <Link
            to="/passenger"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-[0_8px_24px_-10px_color-mix(in_oklab,var(--primary)_60%,transparent)] transition hover:-translate-y-0.5"
          >
            Book a ride
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-24 pt-24 text-center sm:pt-32">
        <span
          className="animate-fade-in inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground backdrop-blur"
          style={{ animationDelay: "0ms", animationFillMode: "both" }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          NEMT · Colorado
        </span>

        <h1
          className="animate-fade-in mt-6 max-w-4xl font-display text-[12vw] font-semibold leading-[0.95] tracking-tight sm:text-6xl md:text-7xl lg:text-[5.25rem]"
          style={{ animationDelay: "80ms", animationFillMode: "both" }}
        >
          Non-emergency transport,
          <br />
          <span className="bg-gradient-to-r from-primary via-primary/90 to-white/80 bg-clip-text text-transparent">
            reimagined for the road.
          </span>
        </h1>

        <p
          className="animate-fade-in mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          style={{ animationDelay: "180ms", animationFillMode: "both" }}
        >
          RedArt is one platform for dispatch, drivers, and riders — purpose-built
          for Medicaid transport. Ride requests in, clean claims out, everything
          tracked in between.
        </p>

        <div
          className="animate-fade-in mt-10 flex w-full max-w-md flex-col items-stretch gap-3 sm:flex-row sm:justify-center"
          style={{ animationDelay: "260ms", animationFillMode: "both" }}
        >
          <a
            href="#product"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--primary)_60%,transparent)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-12px_color-mix(in_oklab,var(--primary)_70%,transparent)]"
          >
            See the product
            <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
          <a
            href="#contact"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition-all duration-300 hover:border-primary/40 hover:bg-white/[0.06]"
          >
            Talk to us
          </a>
        </div>


        <dl className="mt-16 grid w-full max-w-3xl grid-cols-3 divide-x divide-border/60 rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur">
          <Stat label="Dispatch" value="Realtime" />
          <Stat label="Drivers" value="On-demand" />
          <Stat label="Coverage" value="Statewide" />
        </dl>
      </section>

      {/* What we do */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <SectionHeader
          kicker="What we do"
          title="One platform. Every side of the ride."
          copy="We replace the patchwork of scheduling spreadsheets, driver texts, and paper trip logs with a single system your team, drivers, and riders can actually use."
        />
      </section>

      {/* Product */}
      <section id="product" className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20">
        <div className="grid gap-5 md:grid-cols-3">
          <ProductCard
            icon={Radio}
            name="Dispatch Console"
            desc="Live map of every driver and ride, auto-matching by proximity and vehicle type, with instant fallback to a human dispatcher."
          />
          <ProductCard
            icon={Car}
            name="Driver App"
            desc="Go online with one tap, accept offers, navigate turn-by-turn, log stops and cabin-clips, and submit gas receipts from the phone."
          />
          <ProductCard
            icon={Users}
            name="Rider App"
            desc="Rideshare-quality booking with address autocomplete, live ETA, driver tracking, and guest-friendly flows for family members."
          />
          <ProductCard
            icon={FileCheck2}
            name="Medicaid Billing"
            desc="Trip data auto-fills the HCPF portal. Review, submit, and track claims from Pending Review through Submitted in one queue."
            wide
          />
          <ProductCard
            icon={HeartPulse}
            name="Compliance & Proof"
            desc="Vehicle inspections, driver documents, and per-trip proof (odometer, signatures, photos) captured and stored automatically."
            wide
          />
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <SectionHeader
          kicker="Benefits"
          title="Built to save hours and unlock revenue."
          copy="Every feature exists to remove a step that used to require a phone call, a spreadsheet, or a stack of paper."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <Benefit
            icon={Clock}
            title="Hours back weekly"
            desc="Auto-dispatch and auto-billing eliminate manual matching and claim entry."
          />
          <Benefit
            icon={BadgeDollarSign}
            title="More clean claims"
            desc="Structured trip data means fewer rejections and faster reimbursement."
          />
          <Benefit
            icon={MapPin}
            title="Real visibility"
            desc="One live map of drivers, rides, and status — no more group texts."
          />
          <Benefit
            icon={ShieldCheck}
            title="Audit-ready"
            desc="Every trip carries proof: GPS, signatures, photos, and documents."
          />
        </div>
      </section>

      {/* Why join */}
      <section id="why-join" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur sm:p-14">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
                <Sparkles className="h-3 w-3" />
                Why join RedArt
              </span>
              <h2 className="mt-5 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                We're building the operating system for NEMT.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Whether you drive, dispatch, or run a transport provider, RedArt
                gives you the tools bigger rideshare platforms have — tuned for
                the reality of medical transport and Medicaid billing.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/driver/signin"
                  className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--primary)_60%,transparent)] transition hover:-translate-y-0.5"
                >
                  Drive with us
                </Link>
                <Link
                  to="/auth"
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.02] px-5 py-2.5 text-sm font-semibold text-foreground transition hover:border-primary/40"
                >
                  Dispatch sign in
                </Link>
              </div>
            </div>
            <ul className="space-y-4">
              <Reason title="Steady, predictable work" desc="Recurring Medicaid trips with clear pay — not surge-price roulette." />
              <Reason title="Tools that actually work" desc="A driver app built by people who ride along, not from a slide deck." />
              <Reason title="Fast onboarding" desc="Upload documents once, get dispatched the same week you're approved." />
              <Reason title="Human support" desc="Real dispatch phone number. Real people. No infinite chatbots." />
            </ul>
          </div>
        </div>
      </section>

      {/* CTA / contact */}
      <section id="contact" className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-4">
        <div className="rounded-3xl border border-primary/30 bg-[radial-gradient(80%_120%_at_50%_0%,color-mix(in_oklab,var(--primary)_20%,transparent),transparent_70%)] p-10 text-center sm:p-16">
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Ready to move.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Book a ride, apply to drive, or sign in to dispatch. Everything you
            need lives on one platform.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/passenger"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--primary)_60%,transparent)] transition hover:-translate-y-0.5"
            >
              Book a ride
              <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link
              to="/driver/signin"
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition hover:border-primary/40"
            >
              Driver sign in
            </Link>
            <Link
              to="/auth"
              className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition hover:border-primary/40"
            >
              Dispatch sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 border-t border-white/10 px-6 py-8 text-[11px] text-muted-foreground sm:flex-row">
        <span>© {year} RedArt LLC · All rights reserved</span>
        <span className="tracking-widest uppercase">Colorado · NEMT</span>
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

function SectionHeader({
  kicker,
  title,
  copy,
}: {
  kicker: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-primary">
        {kicker}
      </span>
      <h2 className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl md:text-5xl">
        {title}
      </h2>
      <p className="mt-4 text-muted-foreground">{copy}</p>
    </div>
  );
}

type IconType = React.ComponentType<{ className?: string }>;

function ProductCard({
  icon: Icon,
  name,
  desc,
  wide,
}: {
  icon: IconType;
  name: string;
  desc: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur transition hover:border-primary/40 hover:bg-white/[0.05] ${
        wide ? "md:col-span-3 lg:col-span-3" : ""
      }`}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl transition group-hover:bg-primary/20" />
      <div className="relative flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">{name}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {desc}
          </p>
        </div>
      </div>
    </div>
  );
}

function Benefit({
  icon: Icon,
  title,
  desc,
}: {
  icon: IconType;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur transition hover:border-primary/40">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

function Reason({ title, desc }: { title: string; desc: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
      </div>
    </li>
  );
}
