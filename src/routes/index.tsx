import { useEffect, useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BadgeDollarSign,
  Building2,
  Car,
  FileCheck2,
  Gauge,
  MapPin,
  Quote,
  Radio,
  ReceiptText,
  ShieldCheck,
  Signature,
} from "lucide-react";
import { BrandWordmark } from "@/components/Brand";

// RedArt logo palette — red leads, the rest are quiet accents.
const BRAND = {
  red: "#C8354E",
  yellow: "#F4C430",
  blue: "#1E6FB8",
  green: "#1F9D6A",
} as const;

type BrandColor = keyof typeof BRAND;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RedArt — Automated NEMT dispatch, drivers & Medicaid billing" },
      {
        name: "description",
        content:
          "RedArt automates non-emergency medical transport end to end: live dispatch, a driver app with GPS-verified proof of service, and Medicaid claims prepared automatically for human review.",
      },
      { property: "og:title", content: "RedArt — Automated NEMT operations" },
      {
        property: "og:description",
        content:
          "Replace manual billing staff and protect against fraud risk with automated, GPS-verified documentation for every trip.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketingHome,
});

function MarketingHome() {
  const year = new Date().getFullYear();

  return (
    <div className="dark relative isolate min-h-screen overflow-x-hidden bg-[#07070a] text-foreground antialiased">
      <BackgroundFX />

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07070a]/75 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-5 py-4 sm:px-6">
          <BrandWordmark className="h-7 w-auto shrink-0 sm:h-8" />
          <nav className="ml-auto hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#why" className="transition hover:text-foreground">Why RedArt</a>
            <a href="#features" className="transition hover:text-foreground">Product</a>
            <a href="#trust" className="transition hover:text-foreground">Customers</a>
            <a href="#contact" className="transition hover:text-foreground">Contact</a>
          </nav>
          <a
            href="#contact"
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-[0_10px_30px_-12px_rgba(200,53,78,0.8)] transition hover:-translate-y-0.5 md:ml-0"
            style={{ background: `linear-gradient(135deg, ${BRAND.red} 0%, #8f1f36 100%)` }}
          >
            Request a demo
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-20 pt-20 text-center sm:px-6 sm:pt-28">
        <span
          className="animate-fade-in inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground backdrop-blur sm:text-[11px]"
          style={{ animationDelay: "0ms", animationFillMode: "both" }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: BRAND.red }} />
          NEMT operations platform
        </span>

        <h1
          className="animate-fade-in mx-auto mt-7 max-w-4xl font-display text-4xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.75rem]"
          style={{ animationDelay: "80ms", animationFillMode: "both" }}
        >
          Run your entire NEMT operation
          <br className="hidden sm:block" />{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: `linear-gradient(100deg, ${BRAND.red} 0%, #ff7a5c 55%, ${BRAND.yellow} 100%)` }}
          >
            on autopilot.
          </span>
        </h1>

        <p
          className="animate-fade-in mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          style={{ animationDelay: "170ms", animationFillMode: "both" }}
        >
          Dispatch, driver management, and Medicaid billing in one system. Replace
          manual billing staff and protect yourself from fraud risk with automated,
          GPS-verified documentation on every single trip.
        </p>

        <div
          className="animate-fade-in mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row"
          style={{ animationDelay: "250ms", animationFillMode: "both" }}
        >
          <a
            href="#contact"
            className="group inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-white shadow-[0_14px_40px_-14px_rgba(200,53,78,0.9)] transition-all duration-300 hover:-translate-y-0.5"
            style={{ background: `linear-gradient(135deg, ${BRAND.red} 0%, #8f1f36 100%)` }}
          >
            Book a call
            <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
          <a
            href="#features"
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-7 py-3.5 text-sm font-semibold text-foreground backdrop-blur transition-all duration-300 hover:border-white/25 hover:bg-white/[0.06]"
          >
            See how it works
          </a>
        </div>

        <dl
          className="animate-fade-in mx-auto mt-16 grid w-full max-w-3xl grid-cols-1 divide-y divide-white/10 rounded-3xl border border-white/10 bg-white/[0.02] backdrop-blur sm:grid-cols-3 sm:divide-x sm:divide-y-0"
          style={{ animationDelay: "330ms", animationFillMode: "both" }}
        >
          <Stat label="Dispatch" value="Live & automatic" accent="blue" />
          <Stat label="Claims" value="Auto-prepared" accent="red" />
          <Stat label="Every trip" value="GPS-verified" accent="green" />
        </dl>
      </section>

      {/* Why choose us */}
      <section id="why" className="relative z-10 mx-auto w-full max-w-6xl px-5 py-20 sm:px-6">
        <Reveal>
          <SectionHeader
            kicker="Why choose us"
            title="The two problems that quietly cost you the most."
            copy="Most NEMT providers lose money twice: once on the payroll it takes to bill, and again on the trips they can't prove."
          />
        </Reveal>

        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          <Reveal delay={0}>
            <WhyCard
              icon={BadgeDollarSign}
              accent="yellow"
              title="Stop Paying for What Software Can Do Better"
              paragraphs={[
                "Billing staff, data-entry hours, and after-hours claim cleanup are recurring costs for work that never needed a human in the first place.",
                "RedArt pulls trip data straight from the ride itself — mileage, times, stops, and codes — and prepares the claim for you. Your team reviews and submits instead of typing, so headcount goes to growth rather than paperwork.",
              ]}
            />
          </Reveal>
          <Reveal delay={110}>
            <WhyCard
              icon={ShieldCheck}
              accent="green"
              title="Protect Yourself From What You Can't See"
              paragraphs={[
                "A trip you can't document is a trip you can't defend. Missing signatures, guessed mileage, and paper logs turn into clawbacks and fraud exposure long after the ride is over.",
                "Every RedArt trip carries GPS breadcrumbs, odometer photos, timestamps, and a signed trip report — captured automatically, stored permanently, and ready the day a claim is questioned.",
              ]}
            />
          </Reveal>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 mx-auto w-full max-w-6xl px-5 py-20 sm:px-6">
        <Reveal>
          <SectionHeader
            kicker="Product"
            title="Everything the ride touches, in one platform."
            copy="Built specifically for non-emergency medical transport — not a generic fleet tool with a Medicaid sticker on it."
          />
        </Reveal>

        <div className="mt-14 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Reveal delay={0}>
              <FeatureCard
                icon={Radio}
                accent="blue"
                title="Automated dispatch"
                desc="A live map of every driver, manual or automatic ride assignment, and multi-passenger route building with optimized stop ordering."
                bullets={["Live fleet map", "Auto or manual assign", "Optimized multi-stop routes"]}
              />
            </Reveal>
            <Reveal delay={110}>
              <FeatureCard
                icon={Car}
                accent="yellow"
                title="Driver app"
                desc="A guided, step-by-step trip flow: turn-by-turn navigation handoff, odometer capture by photo or manual entry, digital passenger signatures, and identity verification."
                bullets={["Navigation handoff", "Odometer photo capture", "Signature + ID verification"]}
              />
            </Reveal>
          </div>

          <Reveal delay={0}>
            <FeatureWide
              icon={ReceiptText}
              accent="red"
              title="Automated Medicaid billing"
              desc="Claims are filled and prepared automatically using your live billing rates, the correct procedure codes, and proper round-trip logic. A human reviews and submits — nothing goes out unverified."
              bullets={["Live billing rates", "Correct procedure codes", "Round-trip billing logic", "Human review before submit"]}
            />
          </Reveal>

          <div className="grid gap-6 md:grid-cols-2">
            <Reveal delay={0}>
              <FeatureCard
                icon={FileCheck2}
                accent="green"
                title="Proof-of-service documentation"
                desc="Every trip is backed by GPS logs, odometer photos, and a signed trip report — generated automatically and ready if a claim is ever questioned."
                bullets={["GPS trip logs", "Odometer photos", "Signed trip reports"]}
              />
            </Reveal>
            <Reveal delay={110}>
              <FeatureCard
                icon={Building2}
                accent="blue"
                title="Multi-tenant ready"
                desc="Built for NEMT companies of any size — each with their own drivers, billing settings, and state portal credentials, fully isolated from one another."
                bullets={["Isolated company data", "Per-company billing setup", "Own portal credentials"]}
              />
            </Reveal>
          </div>
        </div>
      </section>

      {/* Trust / social proof */}
      <section id="trust" className="relative z-10 mx-auto w-full max-w-6xl px-5 py-20 sm:px-6">
        <Reveal>
          <SectionHeader
            kicker="Customers"
            title="Built alongside real transport providers."
            copy="We're onboarding our first providers now. Customer stories will live here — real names, real numbers, once they're live."
          />
        </Reveal>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Reveal key={i} delay={i * 100}>
              <div className="flex h-full flex-col rounded-3xl border border-dashed border-white/12 bg-white/[0.02] p-7 backdrop-blur">
                <Quote className="h-5 w-5" style={{ color: `${BRAND.red}cc` }} />
                <div className="mt-5 space-y-2.5" aria-hidden>
                  <div className="h-2.5 w-full rounded-full bg-white/[0.07]" />
                  <div className="h-2.5 w-11/12 rounded-full bg-white/[0.06]" />
                  <div className="h-2.5 w-8/12 rounded-full bg-white/[0.05]" />
                </div>
                <p className="mt-6 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Customer story coming soon
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section id="contact" className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-24 sm:px-6">
        <Reveal>
          <div
            className="rounded-[2rem] border p-9 text-center sm:p-16"
            style={{
              borderColor: "rgba(255,255,255,0.08)",
              background: `
                radial-gradient(70% 120% at 20% 0%, ${BRAND.red}26, transparent 70%),
                radial-gradient(60% 110% at 85% 10%, ${BRAND.yellow}16, transparent 70%),
                radial-gradient(90% 130% at 50% 110%, ${BRAND.blue}1c, transparent 70%)
              `,
            }}
          >
            <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              See it run on your own trips.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              A 20-minute walkthrough of dispatch, the driver app, and a claim
              prepared end to end. Bring one of your real routes.
            </p>
            <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
              <a
                href="mailto:hello@redartdigital.com?subject=RedArt%20demo%20request"
                className="group inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-white shadow-[0_14px_40px_-14px_rgba(200,53,78,0.9)] transition-all duration-300 hover:-translate-y-0.5"
                style={{ background: `linear-gradient(135deg, ${BRAND.red} 0%, #8f1f36 100%)` }}
              >
                Request a demo
                <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
              <Link
                to="/auth"
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-7 py-3.5 text-sm font-semibold text-foreground backdrop-blur transition hover:border-white/25 hover:bg-white/[0.06]"
              >
                Sign in
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <BrandWordmark className="h-7 w-auto" />
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              The operating system for non-emergency medical transport —
              dispatch, drivers, and Medicaid billing in one place.
            </p>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">Contact</h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>
                <a className="transition hover:text-foreground" href="mailto:hello@redartdigital.com">
                  hello@redartdigital.com
                </a>
              </li>
              <li className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                Colorado, USA
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground">Platform</h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li><a href="#features" className="transition hover:text-foreground">Product</a></li>
              <li><a href="#why" className="transition hover:text-foreground">Why RedArt</a></li>
              <li><Link to="/auth" className="transition hover:text-foreground">Sign in</Link></li>
            </ul>
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 border-t border-white/10 px-5 py-6 text-[11px] text-muted-foreground sm:flex-row sm:px-6">
          <span>© {year} RedArt LLC · All rights reserved</span>
          <span className="uppercase tracking-widest">Colorado · NEMT</span>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- pieces ---------------- */

function BackgroundFX() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[75rem] animate-[drift_22s_ease-in-out_infinite_alternate]"
        style={{
          background: `
            radial-gradient(40% 32% at 20% 6%, ${BRAND.red}2e, transparent 70%),
            radial-gradient(42% 34% at 80% 2%, ${BRAND.blue}22, transparent 72%),
            radial-gradient(48% 40% at 50% 26%, ${BRAND.yellow}14, transparent 70%),
            radial-gradient(34% 30% at 88% 44%, ${BRAND.green}16, transparent 72%)
          `,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent_0%,#07070a_88%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.035] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(60%_50%_at_50%_18%,#000,transparent)]"
      />
      <style>{`
        @keyframes drift {
          0%   { transform: translate3d(0,0,0) scale(1); }
          100% { transform: translate3d(0,-2.5%,0) scale(1.06); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[drift_22s_ease-in-out_infinite_alternate\\] { animation: none; }
        }
      `}</style>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: BrandColor }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-5">
      <dt className="text-[10px] font-medium uppercase tracking-[0.22em]" style={{ color: BRAND[accent] }}>
        {label}
      </dt>
      <dd className="text-sm font-semibold text-foreground sm:text-base">{value}</dd>
    </div>
  );
}

function SectionHeader({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="text-[11px] font-medium uppercase tracking-[0.24em]" style={{ color: BRAND.red }}>
        {kicker}
      </span>
      <h2 className="mt-3 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl md:text-[2.75rem]">
        {title}
      </h2>
      <p className="mt-4 text-muted-foreground">{copy}</p>
    </div>
  );
}

type IconType = React.ComponentType<{ className?: string }>;

function AccentIcon({ icon: Icon, accent, big }: { icon: IconType; accent: BrandColor; big?: boolean }) {
  const color = BRAND[accent];
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-2xl border ${big ? "h-14 w-14" : "h-11 w-11"}`}
      style={{ borderColor: `${color}55`, backgroundColor: `${color}1a`, color }}
    >
      <Icon className={big ? "h-6 w-6" : "h-5 w-5"} />
    </div>
  );
}

function WhyCard({
  icon,
  accent,
  title,
  paragraphs,
}: {
  icon: IconType;
  accent: BrandColor;
  title: string;
  paragraphs: string[];
}) {
  const color = BRAND[accent];
  return (
    <div className="group relative h-full overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur transition duration-300 hover:-translate-y-1 hover:bg-white/[0.05] sm:p-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full blur-3xl transition duration-500 group-hover:scale-125"
        style={{ backgroundColor: `${color}2e` }}
      />
      <div className="relative">
        <AccentIcon icon={icon} accent={accent} big />
        <h3 className="mt-6 font-display text-2xl font-semibold leading-snug tracking-tight">{title}</h3>
        {paragraphs.map((p) => (
          <p key={p} className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}

function Bullets({ items, accent }: { items: string[]; accent: BrandColor }) {
  return (
    <ul className="mt-5 flex flex-wrap gap-2">
      {items.map((b) => (
        <li
          key={b}
          className="rounded-full border px-3 py-1 text-[11px] font-medium text-muted-foreground"
          style={{ borderColor: `${BRAND[accent]}3d`, backgroundColor: `${BRAND[accent]}12` }}
        >
          {b}
        </li>
      ))}
    </ul>
  );
}

function FeatureCard({
  icon,
  accent,
  title,
  desc,
  bullets,
}: {
  icon: IconType;
  accent: BrandColor;
  title: string;
  desc: string;
  bullets: string[];
}) {
  return (
    <div className="group h-full rounded-3xl border border-white/10 bg-white/[0.03] p-7 backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.05]">
      <AccentIcon icon={icon} accent={accent} />
      <h3 className="mt-5 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{desc}</p>
      <Bullets items={bullets} accent={accent} />
    </div>
  );
}

function FeatureWide({
  icon,
  accent,
  title,
  desc,
  bullets,
}: {
  icon: IconType;
  accent: BrandColor;
  title: string;
  desc: string;
  bullets: string[];
}) {
  const color = BRAND[accent];
  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-white/10 p-8 backdrop-blur transition duration-300 hover:-translate-y-1 sm:p-10"
      style={{ background: `linear-gradient(120deg, ${color}1c 0%, rgba(255,255,255,0.03) 55%)` }}
    >
      <div className="grid gap-7 md:grid-cols-[auto_1fr] md:items-start">
        <AccentIcon icon={icon} accent={accent} big />
        <div className="min-w-0">
          <h3 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h3>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">{desc}</p>
          <Bullets items={bullets} accent={accent} />
          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" /> Mileage pulled from the trip</span>
            <span className="inline-flex items-center gap-1.5"><Signature className="h-3.5 w-3.5" /> Signed report attached</span>
          </div>
        </div>
      </div>
    </div>
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
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} h-full transition-all duration-700 ease-out will-change-transform ${
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
