export const COMPANY_APPS = [
  { key: "dashboard", label: "Admin dashboard", path: "/login", description: "Manage your company and team" },
  { key: "driver", label: "Driver app", path: "/driver/signin", description: "Trips, vehicle and driver tools" },
  { key: "passenger", label: "Passenger app", path: "/passenger/signin", description: "Book and track your rides" },
  { key: "billing", label: "Billing", path: "/billing/signin", description: "Review trips and prepare claims" },
  { key: "dispatch", label: "Dispatch", path: "/dispatch/signin", description: "Assign drivers and coordinate trips" },
] as const;
export type CompanyApp = typeof COMPANY_APPS[number]["key"];
export const RESERVED_COMPANY_CODES = new Set([
  "driver", "dispatch", "billing", "passenger", "dashboard", "live-ops", "planner", "trips",
  "medicaid-billing", "medicaid-trips", "schedules", "drivers", "payroll", "payroll-statement",
  "driver-pay", "salary", "compliance", "communications", "passengers", "reports", "incidents",
  "team", "events", "messages", "news-feed", "news", "games", "rewards-settings",
  "owner", "auth", "api", "track", "ride", "admin", "assets", "public", "mobile", "access",
]);
export function normalizeCompanyCode(value: string): string {
  const code = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) || code.length < 2 || code.length > 40 || RESERVED_COMPANY_CODES.has(code)) {
    throw new Error("Enter your company code using 2–40 letters, numbers or single hyphens.");
  }
  return code;
}
export function companyAppHref(code: string, app?: CompanyApp): string {
  const slug = normalizeCompanyCode(code);
  return `/${slug}${app ? COMPANY_APPS.find(item => item.key === app)!.path : ""}`;
}
