/**
 * MEDICAL-DESTINATION CLASSIFIER (review-only).
 *
 * Colorado HCPF covers NEMT to/from medically necessary medical and
 * behavioral-health services, plus trips to enrolled pharmacies (vaccines,
 * immunizations, preventive services, prescription pickup, DME).
 *
 * This module NEVER decides coverage. It only produces a review signal so a
 * biller can look at trips whose destination does not look medical. Bias is
 * deliberately toward NOT flagging: anything with credible medical evidence
 * becomes `medical_confident` / `medical_possible`, and anything we cannot
 * reason about becomes `unknown` — never "not covered".
 *
 * Pure and client-safe: no network, no database, no secrets. All Google/Places
 * evidence is passed in by the server layer.
 */

export const CLASSIFIER_VERSION = "dest-classifier-v1";

export type DestinationStatus =
  | "medical_confident"
  | "medical_possible"
  | "review_non_medical"
  | "unknown";

/** One business found at (or in the same building as) the destination. */
export type PlaceEvidence = {
  name?: string | null;
  types?: string[] | null;
  address?: string | null;
};

export type ClassifierInput = {
  /** Free-text destination as written on the bill / trip. */
  address?: string | null;
  /** Optional business name captured separately (paper form, place lookup). */
  name?: string | null;
  /** The resolved place for the destination itself, if a lookup succeeded. */
  place?: PlaceEvidence | null;
  /** Other businesses at the same street address (mixed-use buildings). */
  nearby?: PlaceEvidence[] | null;
  /** True when the place provider failed / was unavailable for this address. */
  providerFailed?: boolean;
};

export type ClassifierResult = {
  status: DestinationStatus;
  /** Confidence in the classification itself, 0..1. */
  confidence: number;
  /** Machine-readable reason codes, most important first. */
  reasons: string[];
  /** Human sentence for the review UI. Never says "not covered". */
  summary: string;
  /** The signals that drove the decision (audit trail). */
  matched: string[];
  version: string;
};

/* --------------------------- evidence vocabularies --------------------------- */

/** Unmistakable medical / behavioral-health / pharmacy evidence. */
const STRONG_MEDICAL = [
  "hospital",
  "medical center",
  "medical centre",
  "medical plaza",
  "medical group",
  "medical office",
  "medical clinic",
  "health center",
  "healthcare",
  "health care",
  "health system",
  "clinic",
  "physician",
  "doctors office",
  "doctor's office",
  "family medicine",
  "internal medicine",
  "primary care",
  "urgent care",
  "emergency room",
  "surgery center",
  "surgical center",
  "dental",
  "dentist",
  "orthodont",
  "endodont",
  "oral surgery",
  "optometr",
  "ophthalm",
  "eye care",
  "eye center",
  "vision center",
  "podiatr",
  "chiropract",
  "dialysis",
  "nephrology",
  "oncology",
  "cancer center",
  "cardiolog",
  "dermatolog",
  "neurolog",
  "orthopedic",
  "orthopaedic",
  "pediatric",
  "obstetric",
  "gynecolog",
  "ob/gyn",
  "radiolog",
  "imaging",
  "diagnostic",
  "laboratory",
  "labcorp",
  "quest diagnostics",
  "infusion",
  "physical therapy",
  "occupational therapy",
  "speech therapy",
  "respiratory",
  "pulmonolog",
  "wound care",
  "hospice",
  "skilled nursing",
  "nursing home",
  "nursing facility",
  "rehabilitation hospital",
  "va medical",
  "veterans affairs medical",
  "community health",
  "public health",
  "pharmacy",
  "pharmacies",
  "drugstore",
  "drug store",
  "apothecary",
  "medical supply",
  "medical equipment",
  "durable medical",
  "home medical",
  "oxygen supply",
  "prosthetic",
  "orthotic",
  // behavioral health / substance use
  "behavioral health",
  "mental health",
  "psychiatr",
  "psycholog",
  "counseling center",
  "counseling services",
  "therapy center",
  "substance use",
  "substance abuse",
  "detox",
  "methadone",
  "suboxone",
  "buprenorphine",
  "opioid treatment",
  "medication assisted treatment",
  "treatment center",
  "recovery center",
  "recovery clinic",
  "recovery services",
  "rehab center",
  "rehabilitation center",
  "sober living",
];

/** Google place types that are credible medical evidence. */
const STRONG_MEDICAL_TYPES = new Set([
  "hospital",
  "doctor",
  "dentist",
  "dental_clinic",
  "pharmacy",
  "drugstore",
  "physiotherapist",
  "chiropractor",
  "medical_lab",
  "psychologist",
  "psychiatrist",
  "wellness_center",
  "health",
  "hospice",
  "nursing_home",
  "skilled_nursing_facility",
  "rehabilitation_center",
  "medical_clinic",
  "dialysis_center",
]);

/** Weaker medical-adjacent language: enough for `medical_possible`, never confident. */
const WEAK_MEDICAL = [
  "health",
  "medical",
  "wellness",
  "care center",
  "therapy",
  "therapist",
  "counsel",
  "recovery",
  "treatment",
  "clinic suite",
  "specialists",
  "associates in",
];

/** Recovery / 12-step meeting context — a behavioral-health purpose candidate. */
const RECOVERY_CONTEXT = [
  "alcoholics anonymous",
  "narcotics anonymous",
  "cocaine anonymous",
  "al-anon",
  "alanon",
  "nar-anon",
  "celebrate recovery",
  "12 step",
  "12-step",
  "twelve step",
  "aa meeting",
  "na meeting",
  "aa group",
  "na group",
  "recovery meeting",
  "recovery group",
  "support group",
  "smart recovery",
  "sober support",
  "peer support",
  "clubhouse recovery",
];

/** Pharmacy chains: the destination itself is a pharmacy. */
const PHARMACY_CHAINS = [
  "walgreens",
  "cvs",
  "rite aid",
  "duane reade",
  "good day pharmacy",
  "safeway pharmacy",
  "king soopers pharmacy",
];

/** General retail that only counts as medical with explicit pharmacy/clinic evidence. */
const RETAIL_CHAINS = [
  "walmart",
  "wal-mart",
  "sam's club",
  "sams club",
  "target",
  "costco",
  "king soopers",
  "safeway",
  "kroger",
  "albertsons",
  "dollar general",
  "dollar tree",
  "family dollar",
  "meijer",
  "publix",
  "heb",
  "grocery",
  "supermarket",
  "super center",
  "supercenter",
];

/** Language/types that clearly read as non-medical errands or leisure. */
const NON_MEDICAL = [
  "restaurant",
  "mcdonald",
  "burger king",
  "taco bell",
  "wendy's",
  "chick-fil-a",
  "starbucks",
  "dunkin",
  "pizza",
  "cafe",
  "diner",
  "bar & grill",
  "brewery",
  "liquor store",
  "casino",
  "nail salon",
  "hair salon",
  "barber",
  "tattoo",
  "movie theater",
  "cinema",
  "bowling",
  "shopping mall",
  "gas station",
  "car wash",
  "auto repair",
  "tire shop",
  "bank",
  "credit union",
  "post office",
  "storage",
  "hotel",
  "motel",
  "airport",
  "park",
  "library",
  "school",
  "university",
  "gym",
  "fitness",
];

const NON_MEDICAL_TYPES = new Set([
  "restaurant",
  "fast_food_restaurant",
  "cafe",
  "bar",
  "liquor_store",
  "casino",
  "beauty_salon",
  "hair_care",
  "movie_theater",
  "bowling_alley",
  "shopping_mall",
  "gas_station",
  "car_repair",
  "car_wash",
  "bank",
  "atm",
  "post_office",
  "storage",
  "lodging",
  "hotel",
  "airport",
  "gym",
  "fitness_center",
  "veterinary_care",
  "spa",
]);

/** Address-ish types that indicate a home, not a business. */
const RESIDENTIAL_TYPES = new Set([
  "premise",
  "subpremise",
  "street_address",
  "route",
  "apartment_complex",
  "housing_complex",
  "residential",
]);

const RESIDENTIAL_WORDS = [
  "apartment",
  " apt ",
  " apt.",
  "residence",
  "mobile home",
  "trailer park",
  "home address",
];

/* -------------------------------- matching -------------------------------- */

function norm(s: string | null | undefined): string {
  return ` ${String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9&'/.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function typeSet(p: PlaceEvidence | null | undefined): string[] {
  return (p?.types ?? []).map((t) => String(t).toLowerCase());
}

function hits(hay: string, needles: string[]): string[] {
  return needles.filter((n) => hay.includes(n.toLowerCase()));
}

function typeHits(types: string[], set: Set<string>): string[] {
  return types.filter((t) => set.has(t));
}

/** Normalized cache key for a destination string. */
export function normalizeDestinationKey(address: string | null | undefined): string {
  return String(address ?? "")
    .toLowerCase()
    .replace(/[.,#]+/g, " ")
    .replace(/\b(suite|ste|unit|apt|apartment|#)\s*[a-z0-9\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function result(
  status: DestinationStatus,
  confidence: number,
  reasons: string[],
  matched: string[],
  summary: string,
): ClassifierResult {
  return { status, confidence, reasons, matched, summary, version: CLASSIFIER_VERSION };
}

/**
 * Classify one destination from text + optional place evidence.
 *
 * Never returns a coverage decision. `review_non_medical` means "seems
 * non-medical — review required", nothing more.
 */
export function classifyDestination(input: ClassifierInput): ClassifierResult {
  const addr = String(input.address ?? "").trim();
  const name = String(input.name ?? "").trim();
  const place = input.place ?? null;
  const nearby = (input.nearby ?? []).filter(Boolean);

  if (!addr && !name && !place) {
    return result(
      "unknown",
      0.2,
      ["no_destination_text"],
      [],
      "No destination recorded — nothing to review yet.",
    );
  }

  if (input.providerFailed) {
    // Provider outage must never look like a non-medical finding.
    const selfText = norm(`${name} ${place?.name ?? ""} ${addr}`);
    const strong = hits(selfText, STRONG_MEDICAL);
    if (strong.length) {
      return result(
        "medical_confident",
        0.85,
        ["destination_text_medical", "place_lookup_unavailable"],
        strong,
        `Destination text indicates a medical facility (${strong[0]}).`,
      );
    }
    return result(
      "unknown",
      0.2,
      ["place_lookup_unavailable"],
      [],
      "Place details were unavailable, so this destination could not be classified. Recheck later.",
    );
  }

  const selfText = norm(`${name} ${place?.name ?? ""} ${addr} ${place?.address ?? ""}`);
  const selfTypes = typeSet(place);
  const nearbyText = norm(nearby.map((p) => `${p.name ?? ""} ${(p.types ?? []).join(" ")}`).join(" | "));
  const nearbyTypes = nearby.flatMap((p) => typeSet(p));

  const strongSelf = [...hits(selfText, STRONG_MEDICAL), ...typeHits(selfTypes, STRONG_MEDICAL_TYPES)];
  const strongNearby = [
    ...hits(nearbyText, STRONG_MEDICAL),
    ...typeHits(nearbyTypes, STRONG_MEDICAL_TYPES),
  ];
  const pharmacyEvidence = [
    ...hits(selfText, ["pharmacy", "drugstore", "drug store", "clinic", "health center", "care clinic"]),
    ...typeHits(selfTypes, new Set(["pharmacy", "drugstore", "medical_clinic", "doctor"])),
    ...hits(nearbyText, ["pharmacy", "drugstore", "drug store", "clinic", "health clinic"]),
    ...typeHits(nearbyTypes, new Set(["pharmacy", "drugstore", "medical_clinic", "doctor"])),
  ];
  const pharmacyChain = hits(selfText, PHARMACY_CHAINS);
  const retailChain = hits(selfText, RETAIL_CHAINS);
  const recovery = [...hits(selfText, RECOVERY_CONTEXT), ...hits(nearbyText, RECOVERY_CONTEXT)];

  // 1) Pharmacy chains are pharmacies — covered destination category.
  if (pharmacyChain.length) {
    return result(
      "medical_confident",
      0.92,
      ["pharmacy_chain"],
      pharmacyChain,
      `${pharmacyChain[0]} is a pharmacy destination (prescriptions, vaccines, DME).`,
    );
  }

  // 2) General retail: medical ONLY with explicit pharmacy/clinic evidence.
  if (retailChain.length) {
    if (pharmacyEvidence.length) {
      return result(
        "medical_confident",
        0.8,
        ["retail_with_pharmacy_evidence"],
        [...retailChain, ...pharmacyEvidence],
        `Retail location with pharmacy/health-service evidence (${pharmacyEvidence[0]}).`,
      );
    }
    if (strongNearby.length) {
      return result(
        "medical_possible",
        0.55,
        ["retail_with_medical_tenant"],
        [...retailChain, ...strongNearby],
        `Retail address that also lists a medical service (${strongNearby[0]}) — confirm the appointment.`,
      );
    }
    return result(
      "review_non_medical",
      0.6,
      ["retail_no_medical_evidence"],
      retailChain,
      `Seems non-medical — review required: ${retailChain[0]} with no pharmacy, clinic or health-service evidence at this destination.`,
    );
  }

  // 3) Unmistakable medical evidence on the destination itself.
  if (strongSelf.length) {
    return result(
      "medical_confident",
      0.9,
      ["destination_medical_evidence"],
      strongSelf,
      `Medical/behavioral destination evidence: ${strongSelf.slice(0, 3).join(", ")}.`,
    );
  }

  // 4) Mixed-use building: a credible medical tenant at the same address is
  //    enough. We never need to know which suite the appointment was in.
  if (strongNearby.length) {
    return result(
      "medical_confident",
      0.75,
      ["mixed_use_medical_tenant"],
      strongNearby,
      `Medical facility present at this address (${strongNearby.slice(0, 3).join(", ")}) — treated as medical even though the building name is generic.`,
    );
  }

  // 5) Recovery / 12-step meeting context (church halls, community rooms).
  if (recovery.length) {
    return result(
      "medical_possible",
      0.65,
      ["recovery_context"],
      recovery,
      `Recovery / behavioral-health meeting context (${recovery[0]}) — treated as a behavioral-health purpose candidate.`,
    );
  }

  const weak = hits(selfText, WEAK_MEDICAL);
  if (weak.length) {
    return result(
      "medical_possible",
      0.5,
      ["weak_medical_language"],
      weak,
      `Possible medical destination (${weak[0]}) — light evidence only.`,
    );
  }

  const nonMedical = [...hits(selfText, NON_MEDICAL), ...typeHits(selfTypes, NON_MEDICAL_TYPES)];
  if (nonMedical.length) {
    return result(
      "review_non_medical",
      0.7,
      ["non_medical_signals"],
      nonMedical,
      `Seems non-medical — review required: destination reads as ${nonMedical[0]}.`,
    );
  }

  const residential = [
    ...hits(selfText, RESIDENTIAL_WORDS),
    ...typeHits(selfTypes, RESIDENTIAL_TYPES),
  ];
  const looksBareAddress = !name && !place?.name && /^\d+\s/.test(addr);
  if (residential.length || (looksBareAddress && !selfTypes.length)) {
    return result(
      "review_non_medical",
      0.5,
      residential.length ? ["residential_destination"] : ["bare_street_address"],
      residential,
      "Seems non-medical — review required: destination looks like a residence or plain street address with no medical facility found.",
    );
  }

  return result(
    "unknown",
    0.3,
    ["no_medical_or_non_medical_signals"],
    [],
    "Not enough evidence to classify this destination.",
  );
}

/** Statuses the review tab surfaces. */
export const REVIEW_STATUSES: DestinationStatus[] = ["review_non_medical", "unknown"];

export const STATUS_LABEL: Record<DestinationStatus, string> = {
  medical_confident: "Medical",
  medical_possible: "Possibly medical",
  review_non_medical: "Seems non-medical — review",
  unknown: "Unknown",
};
