/**
 * BILLING ONBOARDING READINESS (pure, shared by server + UI).
 *
 * A brand-new company has no rates, no portal login and no chosen provider.
 * Provider discovery used to be derived from `billing_rate_settings.provider_id`,
 * so a company with no rates had no discoverable provider — and could not enter
 * Billing to create rates. That circular dead end is why provider identity now
 * lives on `billing_settings.default_provider_id`, independent of rate rows.
 *
 * Nothing in here invents financial values. Suggestions are labels only; the
 * user must type and confirm every amount.
 */

export type BillingSetupInput = {
  /** billing_settings.default_provider_id */
  providerId: string | null;
  /** billing_settings.default_portal_id */
  portalId: string | null;
  /** Company-owned portal credentials that exist (portal ids). */
  credentialPortalIds: string[];
  /** Rate rows for the company: vehicle_type + unit_type pairs that exist. */
  rates: { vehicle_type: string; unit_type: string }[];
};

export type SetupStepKey = "provider" | "portal" | "rates";

export type SetupStep = {
  key: SetupStepKey;
  title: string;
  done: boolean;
  /** Plain-language explanation of what is still missing. */
  detail: string;
};

export type BillingSetupStatus = {
  steps: SetupStep[];
  /** True only when provider + a real portal credential + required rates exist. */
  ready: boolean;
  missing: SetupStepKey[];
};

/** Minimum rates a company needs before any claim can be priced. */
export const REQUIRED_RATE_UNITS = ["trip", "mile"] as const;
export const REQUIRED_RATE_VEHICLE = "ambulatory";

/** Supported suggestions — shown as hints, never saved without confirmation. */
export const RATE_SUGGESTIONS = {
  trip_procedure_code: "A0120",
  mile_procedure_code: "S0215",
  trip_place_of_service: "99",
  mile_place_of_service: "99",
  diagnosis_code: "R688",
} as const;

export function evaluateBillingSetup(input: BillingSetupInput): BillingSetupStatus {
  const providerDone = Boolean(input.providerId);

  const hasCredential = input.credentialPortalIds.length > 0;
  const portalDone = Boolean(
    input.portalId && hasCredential && input.credentialPortalIds.includes(input.portalId),
  );

  const have = new Set(input.rates.map((r) => `${r.vehicle_type}:${r.unit_type}`));
  const missingUnits = REQUIRED_RATE_UNITS.filter(
    (u) => !have.has(`${REQUIRED_RATE_VEHICLE}:${u}`),
  );
  const ratesDone = missingUnits.length === 0;

  const steps: SetupStep[] = [
    {
      key: "provider",
      title: "Billing provider",
      done: providerDone,
      detail: providerDone
        ? "A provider is linked to this company."
        : "Choose which admin or billing user this company bills under.",
    },
    {
      key: "portal",
      title: "State portal login",
      done: portalDone,
      detail: !hasCredential
        ? "Add this company's own Colorado HCPF login. Passwords are stored securely and never shown again."
        : !input.portalId
          ? "Pick which saved portal login is the default for submissions."
          : !portalDone
            ? "The chosen default portal has no saved login for this company yet."
            : "A company-owned portal login is saved and set as default.",
    },
    {
      key: "rates",
      title: "Trip and mileage rates",
      done: ratesDone,
      detail: ratesDone
        ? "Ambulatory trip and mileage rates are configured."
        : `Enter your own ${missingUnits.join(" and ")} rate${missingUnits.length > 1 ? "s" : ""} for ambulatory trips. Amounts are never copied from another company.`,
    },
  ];

  const missing = steps.filter((s) => !s.done).map((s) => s.key);
  return { steps, ready: missing.length === 0, missing };
}

/** One-line reason submission stays disabled, or null when it is allowed. */
export function submissionBlockedReason(status: BillingSetupStatus): string | null {
  if (status.ready) return null;
  const names: Record<SetupStepKey, string> = {
    provider: "a billing provider",
    portal: "a state portal login",
    rates: "trip and mileage rates",
  };
  const list = status.missing.map((m) => names[m]);
  const human =
    list.length === 1
      ? list[0]
      : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `Submitting is off until billing setup is finished — this company still needs ${human}.`;
}

export type ProviderCandidate = {
  id: string;
  name: string;
  email: string | null;
  roles: string[];
};

export const ELIGIBLE_PROVIDER_ROLES = ["admin", "billing", "admin_biller"] as const;

/**
 * Eligible providers come from company membership + roles, NEVER from rate
 * rows. A single eligible user is preselected so a one-person company does not
 * have to make a meaningless choice.
 */
export function pickDefaultProvider(
  candidates: ProviderCandidate[],
  current: string | null,
): string | null {
  if (current && candidates.some((c) => c.id === current)) return current;
  return candidates.length === 1 ? candidates[0]!.id : null;
}
