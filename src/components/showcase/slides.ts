export type Device = "phone" | "laptop";

export type Step = {
  title: string;
  text: string;
  /** key into SHOTS (src/components/showcase/shots.ts) */
  shot?: string;
};

export type Slide = {
  id: string;
  kind: "title" | "flow" | "app" | "security" | "closing";
  eyebrow?: string;
  name: string;
  tagline?: string;
  accent: "red" | "blue" | "yellow" | "green" | "ink";
  device?: Device;
  steps: Step[];
};

export const SLIDES: Slide[] = [
  {
    id: "intro",
    kind: "title",
    name: "RedArt NEMT Platform",
    tagline: "One platform. Six apps. From the booking tap to the paid Medicaid claim.",
    accent: "red",
    steps: [],
  },
  {
    id: "overview",
    kind: "flow",
    eyebrow: "How it fits together",
    name: "The whole journey",
    tagline:
      "A single ride flows through every app — nobody re-types anything, and the state form writes itself.",
    accent: "ink",
    steps: [
      { title: "Passenger books", text: "A rider books in seconds — no account required." },
      { title: "Dispatch assigns", text: "Auto-match or hand-pick a driver on the live fleet map." },
      { title: "Driver completes", text: "Uber-style flow with in-app navigation and signature capture." },
      { title: "Billing submits", text: "The HCPF trip log is generated and filed to the state portal." },
      { title: "Admin & Owner oversee", text: "Payroll, earnings, reports — per company, fully isolated." },
    ],
  },

  {
    id: "passenger",
    kind: "app",
    eyebrow: "App 1",
    name: "Passenger app",
    tagline: "Book a medical ride in under a minute — no download, no account.",
    accent: "green",
    device: "phone",
    steps: [
      {
        title: "Open the company link",
        text: "Every company gets its own branded URL. The rider lands straight on the booking screen — no sign-up wall.",
        shot: "passenger-home",
      },
      {
        title: "Enter pickup & drop-off",
        text: "Google-powered address autocomplete, saved home address, and manual override for rural or unlisted locations.",
        shot: "passenger-book",
      },
      {
        title: "Pick a vehicle, see the ETA",
        text: "Ambulatory or wheelchair van, with a live estimated arrival time and trip distance before confirming.",
        shot: "passenger-book",
      },
      {
        title: "Searching for a driver",
        text: "A live map shows nearby drivers being offered the ride. If nobody accepts, the rider gets a one-tap Call Dispatch fallback.",
        shot: "passenger-home",
      },
      {
        title: "Matched — track in real time",
        text: "Driver photo, vehicle, live GPS position on the map, and in-app chat with the driver and with support.",
        shot: "passenger-track",
      },
      {
        title: "Profile, rewards & safety",
        text: "Returning riders are recognised automatically. Ride history, rewards, and a safety screen are one tap away.",
        shot: "passenger-signup",
      },
    ],
  },

  {
    id: "driver",
    kind: "app",
    eyebrow: "App 2",
    name: "Driver app",
    tagline: "Everything happens inside the app — offer to signature, no external links.",
    accent: "yellow",
    device: "phone",
    steps: [
      {
        title: "Sign in and go online",
        text: "Drivers are created by the company only. Going online starts the shift clock and begins GPS heartbeats.",
        shot: "driver-home",
      },
      {
        title: "Receive and accept an offer",
        text: "Offers arrive with pickup, drop-off, distance and pay. Unanswered offers expire and roll to the next driver.",
        shot: "driver-home",
      },
      {
        title: "Navigate in-app",
        text: "Turn-by-turn navigation on a branded live map — the driver never leaves the app to get there.",
        shot: "driver-home",
      },
      {
        title: "Arrive, start, add stops",
        text: "A strict linear flow: Arrive → Start trip → optional mid-ride stops (pharmacy, second appointment) → Complete.",
        shot: "driver-home",
      },
      {
        title: "Auto-filled state trip form",
        text: "The HCPF trip log is pre-populated from the ride. Odometer photos are read automatically by OCR, with manual override.",
        shot: "driver-history",
      },
      {
        title: "Passenger signature — done",
        text: "The rider signs on the phone. The signed PDF is stored against the trip and is instantly available to billing.",
        shot: "driver-history",
      },
      {
        title: "Earnings and expenses",
        text: "Automatic clock in/out, hours, per-trip pay, and gas receipt submission — all visible to the driver in real time.",
        shot: "driver-earnings",
      },
    ],
  },

  {
    id: "dispatch",
    kind: "app",
    eyebrow: "App 3",
    name: "Dispatch app",
    tagline: "The control room: live fleet, assignment, and multi-passenger routing.",
    accent: "blue",
    device: "laptop",
    steps: [
      {
        title: "Live fleet board",
        text: "Every online driver on one map with status, current trip and last GPS ping, next to the queue of incoming requests.",
        shot: "dispatch-board",
      },
      {
        title: "Assign — auto or by hand",
        text: "Auto-match picks the nearest available driver; dispatch can override, re-assign mid-trip, or call the driver directly.",
        shot: "dispatch-board",
      },
      {
        title: "Build multi-passenger routes",
        text: "Chain several riders into one route with ordered stops, then push the whole route to a driver as a single job.",
        shot: "dispatch-routes",
      },
      {
        title: "Schedule ahead",
        text: "Standing appointments and future bookings on a day board, ready to release to drivers automatically.",
        shot: "dispatch-schedule",
      },
      {
        title: "History and SMS",
        text: "Full searchable trip history. Dispatch is alerted by SMS, and riders can even book by text — the message is parsed into a real trip.",
        shot: "dispatch-history",
      },
    ],
  },

  {
    id: "billing",
    kind: "app",
    eyebrow: "App 4",
    name: "Billing app",
    tagline: "Handwritten paper bill in, paid Medicaid claim out.",
    accent: "red",
    device: "laptop",
    steps: [
      {
        title: "Upload the paper bill",
        text: "Drop in a photo, scan or PDF of the driver's handwritten trip sheet — no template or special form needed.",
        shot: "billing-chat",
      },
      {
        title: "AI reads it",
        text: "Handwriting OCR extracts the Medicaid ID, date, addresses and start/end odometer readings, then matches the rider on file.",
        shot: "billing-chat",
      },
      {
        title: "Review the calculation",
        text: "Miles, units and dollar total are shown in a chat-style breakdown using your own rate table. Edit anything, or cancel.",
        shot: "billing-chat",
      },
      {
        title: "Confirm → ready to submit",
        text: "Confirming turns it into a real trip in the workflow queue, already approved and waiting for the portal.",
        shot: "billing-workspace",
      },
      {
        title: "Capture pass, then human review",
        text: "The robot logs into the state portal and fills the claim without submitting. You review an HCPF-style breakdown in-app first.",
        shot: "billing-workspace",
      },
      {
        title: "Submit and keep the receipt",
        text: "One click submits for real and stores the confirmation number. Claims History is a full audit trail of every submission.",
        shot: "billing-workspace",
      },
      {
        title: "Portals and rates under your control",
        text: "Billing staff manage portal logins and per-procedure rates themselves — add, edit or remove a portal at any time.",
        shot: "billing-settings",
      },
    ],
  },

  {
    id: "admin",
    kind: "app",
    eyebrow: "App 5",
    name: "Admin dashboard",
    tagline: "The company's single source of truth.",
    accent: "red",
    device: "laptop",
    steps: [
      {
        title: "Dashboard at a glance",
        text: "Today's trips, active drivers, revenue and outstanding claims in one view.",
        shot: "admin-dashboard",
      },
      {
        title: "Trips and state PDFs",
        text: "Open any trip to see the route, proof photos, signature and the generated HCPF trip log — editable by staff.",
        shot: "admin-trips",
      },
      {
        title: "Drivers and compliance",
        text: "Driver records, documents, activity, and the ability to reset access at any time.",
        shot: "admin-drivers",
      },
      {
        title: "Payroll and driver pay",
        text: "Hours from the shift clock, per-trip pay and gas receipts roll up into a per-driver payroll view.",
        shot: "admin-payroll",
      },
      {
        title: "Billing overview",
        text: "A read-only status board of the claim pipeline: pending review, ready to submit, robot running, submitted, needs fix.",
        shot: "admin-billing",
      },
      {
        title: "Reports",
        text: "Exportable trip, mileage and revenue reporting for the period you choose.",
        shot: "admin-reports",
      },
    ],
  },

  {
    id: "owner",
    kind: "app",
    eyebrow: "App 6",
    name: "Owner panel",
    tagline: "Run many transport companies from one place.",
    accent: "ink",
    device: "laptop",
    steps: [
      {
        title: "Create a company",
        text: "Spin up a new tenant with its own URL slug, phone number and completely separate data.",
        shot: "owner-panel",
      },
      {
        title: "Add their branding",
        text: "Upload the company's own logo — it appears next to RedArt across their apps and on their documents.",
        shot: "owner-panel",
      },
      {
        title: "Set seat limits by subscription",
        text: "Cap how many admins, dispatchers, drivers and billers a company gets. The limits are enforced server-side.",
        shot: "owner-panel",
      },
      {
        title: "Create and manage staff",
        text: "Create admin, dispatch, driver and billing accounts for any company, and reset passwords on request.",
        shot: "owner-panel",
      },
      {
        title: "View as company",
        text: "Step into any tenant to see exactly what they see — for support and demos — with a persistent banner showing you're impersonating.",
        shot: "owner-panel",
      },
    ],
  },

  {
    id: "security",
    kind: "security",
    eyebrow: "Trust",
    name: "Security & isolation",
    tagline: "Every company's data is walled off at the database, not just in the UI.",
    accent: "ink",
    steps: [
      {
        title: "Per-company isolation",
        text: "Row-level security scopes every table to the signed-in user's company. A Walla admin visiting another company's URL is redirected out — no data is ever returned.",
      },
      {
        title: "Role gates",
        text: "Passenger, driver, dispatch, billing, admin and owner each see only their own app. A driver session cannot reach the admin dashboard.",
      },
      {
        title: "Staff accounts are invite-only",
        text: "There is no public sign-up for staff. Driver, dispatch and billing accounts can only be created by an admin or the platform owner.",
      },
      {
        title: "Sensitive data encrypted",
        text: "Medicaid IDs and SSNs are stored encrypted, and portal credentials are never exposed to the browser.",
      },
    ],
  },

  {
    id: "closing",
    kind: "closing",
    name: "Let's get you running",
    tagline: "Booking, dispatch, driver, billing and oversight — live, today.",
    accent: "red",
    steps: [],
  },
];
