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

// RedArt logo palette — mixed across the page for a branded, non-monochrome feel.
const BRAND = {
  yellow: "#F4C430",
  red: "#C8354E",
  blue: "#1E6FB8",
  green: "#1F9D6A",
} as const;

type BrandColor = keyof typeof BRAND;

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
      {/* Atmospheric layers — mixed logo colors, deep and minimal */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70rem]"
        style={{
          background: `
            radial-gradient(38% 32% at 18% 8%, ${BRAND.yellow}22, transparent 70%),
            radial-gradient(42% 34% at 82% 4%, ${BRAND.blue}2b, transparent 72%),
            radial-gradient(46% 38% at 50% 22%, ${BRAND.red}26, transparent 70%),
            radial-gradient(34% 30% at 88% 42%, ${BRAND.green}22, transparent 72%)
          `,
        }}
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
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07070a]/80 backdrop-blur">
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
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_24px_-10px_rgba(200,53,78,0.6)] transition hover:-translate-y-0.5"
            style={{
              background: `linear-gradient(135deg, ${BRAND.red} 0%, ${BRAND.yellow} 100%)`,
            }}
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
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full"
            style={{ backgroundColor: BRAND.red }}
          />
          NEMT · Colorado
        </span>

        <h1
          className="animate-fade-in mt-6 max-w-4xl font-display text-[12vw] font-semibold leading-[0.95] tracking-tight sm:text-6xl md:text-7xl lg:text-[5.25rem]"
          style={{ animationDelay: "80ms", animationFillMode: "both" }}
        >
          Non-emergency transport,
          <br />
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: `linear-gradient(100deg, ${BRAND.yellow} 0%, ${BRAND.red} 38%, ${BRAND.blue} 72%, ${BRAND.green} 100%)`,
            }}
          >
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
            className="group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(200,53,78,0.6)] transition-all duration-300 hover:-translate-y-0.5"
            style={{
              background: `linear-gradient(135deg, ${BRAND.red} 0%, ${BRAND.yellow} 100%)`,
            }}
          >
            See the product
            <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
          <a
            href="#contact"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition-all duration-300 hover:border-white/20 hover:bg-white/[0.06]"
          >
            Talk to us
          </a>
        </div>

        <dl
          className="animate-fade-in mt-16 grid w-full max-w-3xl grid-cols-3 divide-x divide-white/10 rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur"
          style={{ animationDelay: "340ms", animationFillMode: "both" }}
        >
          <Stat label="Dispatch" value="Realtime" accent="blue" />
          <Stat label="Drivers" value="On-demand" accent="yellow" />
          <Stat label="Coverage" value="Statewide" accent="green" />
        </dl>
      </section>

      {/* What we do */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <Reveal>
          <SectionHeader
            kicker="What we do"
            title="One platform. Every side of the ride."
            copy="We replace the patchwork of scheduling spreadsheets, driver texts, and paper trip logs with a single system your team, drivers, and riders can actually use."
            accent="blue"
          />
        </Reveal>
      </section>

      {/* Product */}
      <section id="product" className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20">
        <div className="grid gap-5 md:grid-cols-3">
          <Reveal delay={0}>
            <ProductCard
              icon={Radio}
              name="Dispatch Console"
              desc="Live map of every driver and ride, auto-matching by proximity and vehicle type, with instant fallback to a human dispatcher."
              accent="blue"
            />
          </Reveal>
          <Reveal delay={80}>
            <ProductCard
              icon={Car}
              name="Driver App"
              desc="Go online with one tap, accept offers, navigate turn-by-turn, log stops and cabin-clips, and submit gas receipts from the phone."
              accent="yellow"
            />
          </Reveal>
          <Reveal delay={160}>
            <ProductCard
              icon={Users}
              name="Rider App"
              desc="Rideshare-quality booking with address autocomplete, live ETA, driver tracking, and guest-friendly flows for family members."
              accent="green"
            />
          </Reveal>
          <Reveal delay={0} className="md:col-span-3">
            <ProductCard
              icon={FileCheck2}
              name="Medicaid Billing"
              desc="Trip data auto-fills the HCPF portal. Review, submit, and track claims from Pending Review through Submitted in one queue."
              accent="red"
            />
          </Reveal>
          <Reveal delay={80} className="md:col-span-3">
            <ProductCard
              icon={HeartPulse}
              name="Compliance & Proof"
              desc="Vehicle inspections, driver documents, and per-trip proof (odometer, signatures, photos) captured and stored automatically."
              accent="green"
            />
          </Reveal>
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <Reveal>
          <SectionHeader
            kicker="Benefits"
            title="Built to save hours and unlock revenue."
            copy="Every feature exists to remove a step that used to require a phone call, a spreadsheet, or a stack of paper."
            accent="yellow"
          />
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Clock, title: "Hours back weekly", desc: "Auto-dispatch and auto-billing eliminate manual matching and claim entry.", accent: "yellow" as BrandColor },
            { icon: BadgeDollarSign, title: "More clean claims", desc: "Structured trip data means fewer rejections and faster reimbursement.", accent: "green" as BrandColor },
            { icon: MapPin, title: "Real visibility", desc: "One live map of drivers, rides, and status — no more group texts.", accent: "blue" as BrandColor },
            { icon: ShieldCheck, title: "Audit-ready", desc: "Every trip carries proof: GPS, signatures, photos, and documents.", accent: "red" as BrandColor },
          ].map((b, i) => (
            <Reveal key={b.title} delay={i * 90}>
              <Benefit {...b} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* Why choose us */}
      <section id="why-choose-us" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <Reveal>
          <SectionHeader
            kicker="Why choose us"
            title="Stop Paying for What Software Can Do Better"
            copy="The average NEMT billing team costs you more than you think."
            accent="red"
          />
        </Reveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur sm:p-10">
              <p className="text-muted-foreground">
                Five billers on payroll runs close to{" "}
                <CountUpMoney value={20000} className="align-baseline" /> a month —
                salaries, benefits, training, turnover, and the mistakes that come with
                manual data entry. RedArt replaces that entire workload with one automated
                system that never calls in sick, never mistypes a diagnosis code, and never
                misses a deadline.
              </p>
              <p className="mt-6 text-muted-foreground">
                Save up to <CountUpMoney value={240000} /> a year. Redirect it into more
                drivers, better vehicles, or your own pocket.
              </p>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <div className="h-full rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur sm:p-10">
              <h3 className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
                Protect Yourself From What You Can't See
              </h3>
              <p className="mt-4 text-muted-foreground">
                When drivers earn on commission, the incentive to pad mileage is real — and
                every padded mile is a claim that doesn't match reality. One audit, one
                flagged pattern, and your Medicaid provider account can be suspended
                overnight.
              </p>
              <p className="mt-4 text-muted-foreground">
                RedArt closes that gap automatically. Every trip is backed by GPS-verified
                routes, timestamped odometer photos, and digitally signed proof of service —
                captured the moment the trip happens, not typed in from memory afterward.
                Your billing isn't just fast. It's defensible.
              </p>
            </div>
          </Reveal>
        </div>
      </section>


      {/* Why join */}
      <section id="why-join" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <Reveal>
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur sm:p-14">
            <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr]">
              <div>
                <span
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em]"
                  style={{
                    borderColor: `${BRAND.red}55`,
                    backgroundColor: `${BRAND.red}18`,
                    color: BRAND.red,
                  }}
                >
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
                    className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(30,111,184,0.6)] transition hover:-translate-y-0.5"
                    style={{
                      background: `linear-gradient(135deg, ${BRAND.blue} 0%, ${BRAND.green} 100%)`,
                    }}
                  >
                    Drive with us
                  </Link>
                  <Link
                    to="/auth"
                    className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.02] px-5 py-2.5 text-sm font-semibold text-foreground transition hover:border-white/20"
                  >
                    Dispatch sign in
                  </Link>
                </div>
              </div>
              <ul className="space-y-4">
                <Reason accent="yellow" title="Steady, predictable work" desc="Recurring Medicaid trips with clear pay — not surge-price roulette." />
                <Reason accent="red" title="Tools that actually work" desc="A driver app built by people who ride along, not from a slide deck." />
                <Reason accent="blue" title="Fast onboarding" desc="Upload documents once, get dispatched the same week you're approved." />
                <Reason accent="green" title="Human support" desc="Real dispatch phone number. Real people. No infinite chatbots." />
              </ul>
            </div>
          </div>
        </Reveal>
      </section>

      {/* CTA / contact */}
      <section id="contact" className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-4">
        <Reveal>
          <div
            className="rounded-3xl border p-10 text-center sm:p-16"
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              background: `
                radial-gradient(60% 100% at 15% 0%, ${BRAND.yellow}1f, transparent 70%),
                radial-gradient(60% 100% at 85% 0%, ${BRAND.blue}22, transparent 70%),
                radial-gradient(80% 120% at 50% 100%, ${BRAND.red}22, transparent 70%)
              `,
            }}
          >
            <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Ready to{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage: `linear-gradient(100deg, ${BRAND.yellow}, ${BRAND.red}, ${BRAND.blue}, ${BRAND.green})`,
                }}
              >
                move
              </span>
              .
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Book a ride, apply to drive, or sign in to dispatch. Everything you
              need lives on one platform.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                to="/passenger"
                className="group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(200,53,78,0.6)] transition-all duration-300 hover:-translate-y-0.5"
                style={{
                  background: `linear-gradient(135deg, ${BRAND.red} 0%, ${BRAND.yellow} 100%)`,
                }}
              >
                Book a ride
                <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </Link>
              <Link
                to="/driver/signin"
                className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(30,111,184,0.55)] transition hover:-translate-y-0.5"
                style={{
                  background: `linear-gradient(135deg, ${BRAND.blue} 0%, ${BRAND.green} 100%)`,
                }}
              >
                Driver sign in
              </Link>
              <Link
                to="/auth"
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-foreground backdrop-blur transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                Dispatch sign in
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 border-t border-white/10 px-6 py-8 text-[11px] text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND.yellow }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND.red }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND.blue }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: BRAND.green }} />
          </span>
          <span>© {year} RedArt LLC · All rights reserved</span>
        </div>
        <span className="tracking-widest uppercase">Colorado · NEMT</span>
      </footer>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: BrandColor }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-5">
      <dt
        className="text-[10px] font-medium uppercase tracking-[0.22em]"
        style={{ color: BRAND[accent] }}
      >
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
  accent = "red",
}: {
  kicker: string;
  title: string;
  copy: string;
  accent?: BrandColor;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span
        className="text-[11px] font-medium uppercase tracking-[0.24em]"
        style={{ color: BRAND[accent] }}
      >
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
  accent,
}: {
  icon: IconType;
  name: string;
  desc: string;
  accent: BrandColor;
}) {
  const color = BRAND[accent];
  return (
    <div
      className="group relative h-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur transition hover:bg-white/[0.05]"
      style={{
        // subtle accent border tint on hover via box-shadow inset ring
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = `${color}66`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "";
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl transition group-hover:opacity-80"
        style={{ backgroundColor: `${color}33` }}
      />
      <div className="relative flex items-start gap-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
          style={{
            borderColor: `${color}55`,
            backgroundColor: `${color}1a`,
            color,
          }}
        >
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
  accent,
}: {
  icon: IconType;
  title: string;
  desc: string;
  accent: BrandColor;
}) {
  const color = BRAND[accent];
  return (
    <div
      className="h-full rounded-2xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur transition"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = `${color}55`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "";
      }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl border"
        style={{
          borderColor: `${color}55`,
          backgroundColor: `${color}1a`,
          color,
        }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

function Reason({
  title,
  desc,
  accent,
}: {
  title: string;
  desc: string;
  accent: BrandColor;
}) {
  return (
    <li className="flex gap-3">
      <span
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: BRAND[accent] }}
      />
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
      </div>
    </li>
  );
}

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} transition-all duration-700 ease-out will-change-transform ${
        shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** Large red count-up figure — animates from $0 to the target when scrolled into view. */
function CountUpMoney({
  value,
  duration = 1300,
  className = "",
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplay(Math.round(value * eased));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            run();
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  return (
    <span
      ref={ref}
      className={`font-display text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl ${className}`}
      style={{ color: BRAND.red }}
    >
      ${display.toLocaleString("en-US")}
    </span>
  );
}
