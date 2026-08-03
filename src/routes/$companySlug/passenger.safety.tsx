import { createFileRoute } from "@tanstack/react-router";
import { AppLink } from "@/lib/appLink";
import {
  Shield,
  Phone,
  AlertTriangle,
  UserCheck,
  MapPin,
  ChevronLeft,
} from "lucide-react";

export const Route = createFileRoute("/$companySlug/passenger/safety")({
  component: SafetyHub,
});

function SafetyHub() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <AppLink
          to="/passenger/profile"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-surface text-muted-foreground transition hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft className="h-4 w-4" />
        </AppLink>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Safety Hub</h1>
          <p className="text-xs text-muted-foreground">
            Tools and info to keep every ride safe.
          </p>
        </div>
      </div>

      <a
        href="tel:911"
        className="flex items-center gap-4 rounded-3xl border border-red-500/40 bg-red-500/10 p-5 shadow-soft transition hover:bg-red-500/15"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500 text-white">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="text-base font-semibold text-red-700 dark:text-red-300">
            Emergency — call 911
          </div>
          <div className="text-xs text-red-700/80 dark:text-red-300/80">
            Use only for immediate danger or medical emergencies.
          </div>
        </div>
        <Phone className="h-5 w-5 text-red-600" />
      </a>

      <a
        href="tel:+18005551234"
        className="flex items-center gap-4 rounded-3xl border border-border/60 bg-surface p-5 shadow-soft transition hover:bg-surface-muted"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Phone className="h-6 w-6" />
        </div>
        <div className="flex-1">
          <div className="text-base font-semibold">RedArt 24/7 Support</div>
          <div className="text-xs text-muted-foreground">
            Talk to a live dispatcher any time.
          </div>
        </div>
      </a>

      <div className="rounded-3xl border border-border/60 bg-surface p-5 shadow-soft">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Shield className="h-4 w-4 text-primary" />
          Every RedArt ride includes
        </div>
        <ul className="mt-3 space-y-3 text-sm">
          <SafetyRow
            icon={<UserCheck className="h-4 w-4" />}
            title="Vetted, credentialed drivers"
            body="Background-checked and trained on NEMT protocols and passenger assistance."
          />
          <SafetyRow
            icon={<MapPin className="h-4 w-4" />}
            title="Live trip tracking"
            body="Your ride is tracked in real time. Share your trip with a caregiver any time."
          />
          <SafetyRow
            icon={<Phone className="h-4 w-4" />}
            title="Two-way contact"
            body="Reach your driver or our team with one tap from your ride screen."
          />
        </ul>
      </div>

      <div className="rounded-3xl border border-border/60 bg-surface-muted p-5 text-xs text-muted-foreground">
        In a life-threatening emergency always call 911 first. Then let RedArt
        know so we can coordinate with responders and your care team.
      </div>
    </div>
  );
}

function SafetyRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3 rounded-2xl border border-border/50 bg-background/40 p-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{body}</div>
      </div>
    </li>
  );
}
