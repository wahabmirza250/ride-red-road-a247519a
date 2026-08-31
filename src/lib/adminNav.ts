import {
  LayoutDashboard,
  Route as RouteIcon,
  Users,
  UserRound,
  MessageSquare,
  BarChart3,
  AlertTriangle,
  CalendarClock,
  Newspaper,
  Gamepad2,
  Trophy,
  FileSignature,
  Radio,
  Megaphone,
  Shield,
  LayoutGrid,
  Sparkles,
  Banknote,
} from "lucide-react";
import { withSlug } from "@/lib/appLink";

/**
 * Admin dashboard rail configuration.
 *
 * The Compliance shield is the INTERNAL company compliance dashboard
 * (`/{companySlug}/compliance`). It must never point at the public passenger
 * compliance/booking surface, and it must never drop the tenant slug — see
 * `complianceShieldTarget` below, which is what the rail (and the tests) use.
 */
export const ADMIN_NAV_GROUPS = [
  [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/live-ops", label: "Dispatch", icon: Radio },
  ],
  [
    { to: "/trips", label: "Trips", icon: RouteIcon },
    { to: "/medicaid-billing", label: "Medicaid Billing", icon: FileSignature },
    { to: "/schedules", label: "Schedules", icon: CalendarClock },
  ],
  [
    { to: "/drivers", label: "Drivers", icon: Users },
    { to: "/salary", label: "Salary", icon: Banknote },
    { to: COMPLIANCE_PATH(), label: "Compliance", icon: Shield },
    { to: "/passengers", label: "Passengers", icon: UserRound },
  ],
  [
    { to: "/reports", label: "Reports", icon: BarChart3 },
    { to: "/incidents", label: "Incidents", icon: AlertTriangle },
  ],
  [
    // Distinct icon: the shield belongs to Compliance only, so the two entries
    // can't be mistaken for each other in the rail.
    { to: "/team", label: "Team & apps", icon: LayoutGrid },
    { to: "/events", label: "Events", icon: Sparkles },
  ],
  [
    { to: "/messages", label: "Messages", icon: MessageSquare },
    { to: "/communications", label: "Communications", icon: MessageSquare },
    { to: "/news-feed", label: "News Feed", icon: Megaphone },
    { to: "/news", label: "News", icon: Newspaper },
  ],
  [
    { to: "/games", label: "Games", icon: Gamepad2 },
    { to: "/rewards-settings", label: "Rewards", icon: Trophy },
  ],
] as const;

export const ADMIN_NAV = ADMIN_NAV_GROUPS.flat();

/** Internal (staff) compliance home, before tenant prefixing. */
function COMPLIANCE_PATH(): "/compliance" {
  return "/compliance";
}

export const INTERNAL_COMPLIANCE_PATH = COMPLIANCE_PATH();

/** Tenant-scoped destination for the admin Compliance shield. */
export function complianceShieldTarget(slug: string | null): string {
  return withSlug(slug, INTERNAL_COMPLIANCE_PATH);
}
