# RedArt Presentation Deck

A separate, standalone page at `/showcase` — not part of the existing marketing homepage or any app — that walks through every app in the platform step by step, with real screenshots of the live UI and smooth animated transitions. Built for presenting on a screen in a meeting.

## What it covers

RedArt-branded (dark, red accent, existing wordmark), one app per section, each broken into its actual numbered workflow steps:

1. **Title** — RedArt logo, "One platform. Six apps." tagline.
2. **Platform overview** — animated diagram of how Passenger → Dispatch → Driver → Billing → Admin → Owner connect.
3. **Passenger app** — steps: open link (no account needed) → enter pickup/dropoff with address autocomplete → pick vehicle & see live ETA → confirm → searching for driver → matched, live map tracking → chat/call → ride complete.
4. **Driver app** — steps: sign in → go online → receive offer → accept → in-app turn-by-turn navigation → arrive → start trip → mid-ride stops → complete → auto-filled HCPF trip form with odometer photo OCR → passenger signature → done. Plus clock in/out, earnings, gas receipts.
5. **Dispatch app** — steps: live fleet map → incoming requests → manual or auto-assign → multi-passenger route builder → schedule board → history → SMS notifications and SMS-based booking.
6. **Billing app** — steps: upload a handwritten paper bill → AI reads Medicaid ID, odometers, miles → review & edit the calculation in chat → confirm → Ready to submit → robot capture pass → in-app claim review with HCPF-style breakdown → submit → confirmation number → Claims History audit trail. Plus portal credentials and rate settings.
7. **Admin dashboard** — steps: trips overview → trip detail with state PDF → driver management → payroll and driver pay → earnings → reports → team and roles.
8. **Owner panel** — steps: create a company → set logo/branding → set seat limits per role → create admin/dispatch/driver/billing accounts → reset passwords → subscriptions → "View as company".
9. **Security & isolation** — per-company data isolation, role gates, what each role can and cannot see.
10. **Closing** — contact / call to action.

Each step is its own animated beat: a device mockup (phone for passenger/driver, laptop for dispatch/billing/admin/owner) holding the matching real screenshot, with the step number, a short title, and a one-line explanation that fades in.

## How it behaves

- Arrow keys, on-screen prev/next, swipe on touch, and a slide-number strip.
- URL carries the slide (`/showcase?slide=4`) so you can jump straight to one and refresh safely.
- `F` enters real fullscreen; `Esc` exits.
- Animated: slides cross-fade and slide in, bullets stagger, the flow diagram animates its connectors. All CSS/Tailwind driven — no new animation dependency.
- Fully responsive so it also reads well if you present from a phone.
- Public route (no login) so the link can be shared in the meeting.

## Screenshots

I capture real screenshots of the running app myself, using the Demo Transit Co tenant, at both phone and desktop sizes:
passenger home + booking + tracking, driver home + active trip, dispatch board + route builder, billing workspace + paper-bill chat + claims history, admin dashboard + payroll, owner panel.

They get uploaded as CDN assets and referenced from the deck, so the page stays fast and no login is needed to view it. Any screen that can't be captured cleanly gets a labeled placeholder you can swap later.

## Technical notes

- New route `src/routes/showcase.tsx` (public, its own SEO `head()`), plus `src/components/showcase/` for `Deck.tsx`, `Slide.tsx`, `DeviceFrame.tsx`, and a `slides.ts` content file so text/screenshots are easy to edit later.
- Screenshots captured with Playwright against the local dev server, uploaded via `lovable-assets`, referenced through `.asset.json` pointers.
- Slide index in a search param via TanStack Router; keyboard handlers scoped to the deck.
- Styling reuses existing semantic tokens and animation utilities in `src/styles.css`; a few deck-specific keyframes added there.
- No changes to any existing app, route, or backend logic.
