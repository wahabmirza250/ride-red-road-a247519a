import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { BrandWordmark } from "@/components/Brand";
import { cn } from "@/lib/utils";
import { DeviceFrame } from "./DeviceFrame";
import { SHOTS } from "./shots";
import { SLIDES } from "./slides";

const ACCENT: Record<string, string> = {
  red: "surface-red",
  blue: "surface-blue",
  green: "surface-green",
  yellow: "surface-yellow",
  ink: "surface-red",
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function Deck({
  slideIndex,
  stepIndex,
  onGo,
}: {
  slideIndex: number;
  stepIndex: number;
  onGo: (slide: number, step: number) => void;
}) {
  const s = clamp(slideIndex, 0, SLIDES.length - 1);
  const slide = SLIDES[s];
  const stepCount = slide.steps.length;
  const step = clamp(stepIndex, 0, Math.max(0, stepCount - 1));
  const [isFull, setIsFull] = useState(false);
  const touchX = useRef<number | null>(null);

  const next = useCallback(() => {
    if (step < stepCount - 1) onGo(s, step + 1);
    else if (s < SLIDES.length - 1) onGo(s + 1, 0);
  }, [s, step, stepCount, onGo]);

  const prev = useCallback(() => {
    if (step > 0) onGo(s, step - 1);
    else if (s > 0) {
      const prevSlide = SLIDES[s - 1];
      onGo(s - 1, Math.max(0, prevSlide.steps.length - 1));
    }
  }, [s, step, onGo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        onGo(Math.min(SLIDES.length - 1, s + 1), 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        onGo(Math.max(0, s - 1), 0);
      } else if (e.key.toLowerCase() === "f") {
        void toggleFull();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onGo, s]);

  useEffect(() => {
    const onFs = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  async function toggleFull() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* fullscreen unavailable */
    }
  }

  const current = stepCount ? slide.steps[step] : null;
  const shot = current?.shot ? SHOTS[current.shot] : undefined;

  return (
    <div
      className={cn(
        "dark relative flex min-h-[100dvh] flex-col bg-background text-foreground",
        ACCENT[slide.accent],
      )}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX ?? null;
        if (start != null && end != null && Math.abs(end - start) > 60) {
          if (end < start) next();
          else prev();
        }
        touchX.current = null;
      }}
    >
      {/* ambient backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full bg-surface-accent/12 blur-3xl animate-aurora-slow" />
        <div className="absolute -bottom-56 -right-32 h-[38rem] w-[38rem] rounded-full bg-primary/10 blur-3xl animate-aurora-med" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklab,var(--foreground)_5%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--foreground)_5%,transparent)_1px,transparent_1px)] bg-[size:64px_64px] opacity-40" />
      </div>

      {/* top bar */}
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <BrandWordmark className="h-7 w-auto" />
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Slide {s + 1} / {SLIDES.length}
          </span>
          <button
            type="button"
            onClick={() => void toggleFull()}
            aria-label={isFull ? "Exit fullscreen" : "Enter fullscreen"}
            className="rounded-full border border-border bg-surface/60 p-2 text-muted-foreground transition hover:text-foreground"
          >
            {isFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* stage */}
      <main className="relative z-10 flex flex-1 items-center px-4 pb-24 sm:px-8">
        <div key={`${slide.id}-${step}`} className="mx-auto w-full max-w-6xl animate-rise-in">
          {slide.kind === "title" || slide.kind === "closing" ? (
            <TitleSlide name={slide.name} tagline={slide.tagline} closing={slide.kind === "closing"} />
          ) : slide.kind === "flow" ? (
            <FlowSlide
              eyebrow={slide.eyebrow}
              name={slide.name}
              tagline={slide.tagline}
              steps={slide.steps}
              active={step}
            />
          ) : slide.kind === "security" ? (
            <SecuritySlide
              eyebrow={slide.eyebrow}
              name={slide.name}
              tagline={slide.tagline}
              steps={slide.steps}
              active={step}
            />
          ) : (
            <AppSlide
              eyebrow={slide.eyebrow}
              name={slide.name}
              tagline={slide.tagline}
              device={slide.device ?? "laptop"}
              stepNumber={step + 1}
              stepTotal={stepCount}
              title={current?.title ?? ""}
              text={current?.text ?? ""}
              shot={shot}
              steps={slide.steps.map((x) => x.title)}
              active={step}
              onPickStep={(i) => onGo(s, i)}
            />
          )}
        </div>
      </main>

      {/* controls */}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-8">
          <button
            type="button"
            onClick={prev}
            className="rounded-full border border-border bg-surface/70 p-2 text-muted-foreground transition hover:text-foreground"
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={next}
            className="rounded-full bg-primary p-2 text-primary-foreground transition hover:opacity-90"
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <nav className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {SLIDES.map((sl, i) => (
              <button
                key={sl.id}
                type="button"
                onClick={() => onGo(i, 0)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition",
                  i === s
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {sl.name}
              </button>
            ))}
          </nav>

          {stepCount > 1 && (
            <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
              Step {step + 1}/{stepCount}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}

function TitleSlide({
  name,
  tagline,
  closing,
}: {
  name: string;
  tagline?: string;
  closing?: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <BrandWordmark className="mx-auto h-12 w-auto sm:h-16" />
      <h1 className="mt-8 font-display text-4xl font-semibold tracking-tight sm:text-6xl">{name}</h1>
      {tagline && <p className="mt-5 text-base text-muted-foreground sm:text-xl">{tagline}</p>}
      <p className="mt-10 text-xs uppercase tracking-[0.28em] text-muted-foreground">
        {closing ? "Thank you" : "Use → or swipe to begin"}
      </p>
    </div>
  );
}

function SlideHeading({
  eyebrow,
  name,
  tagline,
}: {
  eyebrow?: string;
  name: string;
  tagline?: string;
}) {
  return (
    <div>
      {eyebrow && (
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
          {eyebrow}
        </span>
      )}
      <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-5xl">{name}</h2>
      {tagline && <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-lg">{tagline}</p>}
    </div>
  );
}

function AppSlide({
  eyebrow,
  name,
  tagline,
  device,
  stepNumber,
  stepTotal,
  title,
  text,
  shot,
  steps,
  active,
  onPickStep,
}: {
  eyebrow?: string;
  name: string;
  tagline?: string;
  device: "phone" | "laptop";
  stepNumber: number;
  stepTotal: number;
  title: string;
  text: string;
  shot?: string;
  steps: string[];
  active: number;
  onPickStep: (i: number) => void;
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className="order-2 lg:order-1">
        <SlideHeading eyebrow={eyebrow} name={name} tagline={tagline} />

        <div className="mt-7 rounded-2xl border border-border bg-surface/60 p-5 shadow-soft backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {stepNumber}
            </span>
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Step {stepNumber} of {stepTotal}
            </span>
          </div>
          <h3 className="mt-4 text-xl font-semibold sm:text-2xl">{title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">{text}</p>
        </div>

        <ol className="mt-5 flex flex-wrap gap-2">
          {steps.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => onPickStep(i)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-medium transition",
                  i === active
                    ? "border-primary bg-primary/12 text-primary"
                    : i < active
                      ? "border-border text-muted-foreground"
                      : "border-border/60 text-muted-foreground/60 hover:text-foreground",
                )}
              >
                {i + 1}. {label}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="order-1 lg:order-2">
        <DeviceFrame device={device} src={shot} alt={`${name} — ${title}`} />
      </div>
    </div>
  );
}

function FlowSlide({
  eyebrow,
  name,
  tagline,
  steps,
  active,
}: {
  eyebrow?: string;
  name: string;
  tagline?: string;
  steps: { title: string; text: string }[];
  active: number;
}) {
  return (
    <div>
      <SlideHeading eyebrow={eyebrow} name={name} tagline={tagline} />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((st, i) => (
          <div
            key={st.title}
            className={cn(
              "relative rounded-2xl border p-5 transition-all duration-500",
              i <= active
                ? "border-primary/40 bg-surface/70 opacity-100 shadow-soft"
                : "border-border/50 bg-surface/30 opacity-40",
            )}
          >
            <span className="text-[11px] font-semibold uppercase tracking-widest text-primary">
              0{i + 1}
            </span>
            <h3 className="mt-2 text-base font-semibold">{st.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{st.text}</p>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute -right-2.5 top-1/2 hidden h-px w-5 -translate-y-1/2 transition-colors lg:block",
                  i < active ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SecuritySlide({
  eyebrow,
  name,
  tagline,
  steps,
  active,
}: {
  eyebrow?: string;
  name: string;
  tagline?: string;
  steps: { title: string; text: string }[];
  active: number;
}) {
  return (
    <div>
      <SlideHeading eyebrow={eyebrow} name={name} tagline={tagline} />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {steps.map((st, i) => (
          <div
            key={st.title}
            className={cn(
              "rounded-2xl border p-6 transition-all duration-500",
              i <= active
                ? "border-primary/40 bg-surface/70 opacity-100 shadow-soft"
                : "border-border/50 bg-surface/30 opacity-40",
            )}
          >
            <h3 className="text-lg font-semibold">{st.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{st.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
